// Reading a merge queue's tab: only while it's on screen and its account is there, the queue every
// 20 s backing off to every 2 minutes while reads fail, those waiting to join and the other
// branches' counts every 2 minutes backing off to every 10, and nothing of a branch it no longer
// shows.

import type { OpenPullRequestList, QueueView, QueueWaiting, TrunkRuleList } from '@lo/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueueState } from '../contract.ts';
import {
  QUEUE_EVERY,
  QUEUE_MOST,
  QueueWatch,
  WAITING_EVERY,
  WAITING_MOST,
  type QueueSource,
} from './watch.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A queue on `branch` holding `total` entries, none read. */
function viewOf(branch: string, total: number): QueueView {
  return {
    branch,
    viewerPermission: 'WRITE',
    queue: {
      url: `https://github.com/o/r/queue/${branch}`,
      nextEstimate: undefined,
      settings: undefined,
      entries: [],
      total,
    },
    leftOut: [],
  };
}

/** An open pull request into `baseRefName`, of which only its base is read. */
function openInto(baseRefName: string): OpenPullRequestList['pullRequests'][number] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only its base is read.
  return { baseRefName } as OpenPullRequestList['pullRequests'][number];
}

function waitingOf(branch: string): QueueWaiting {
  return { branch, pullRequests: [], total: 0, leftOut: [] };
}

/** A source that answers at once, counting what it's asked, and fails while `failing` is set. */
function fakeSource(options: { list?: OpenPullRequestList; rules?: TrunkRuleList } = {}) {
  const asked: string[] = [];
  const state = { failing: false, total: 3 };
  const source: QueueSource = {
    async view(branch) {
      asked.push(`view ${branch}`);
      if (state.failing) throw new Error('GitHub couldn’t be reached.');
      return viewOf(branch, branch === 'main' ? state.total : 1);
    },
    async waiting(branch) {
      asked.push(`waiting ${branch}`);
      if (state.failing) throw new Error('GitHub couldn’t be reached.');
      return waitingOf(branch);
    },
    repository: () => ({ list: options.list, rules: options.rules }),
  };
  return { source, asked, state };
}

/** A repository whose open pull request into release/2.8 has a merge queue, as main does. */
const WITH_RELEASE = {
  list: {
    pullRequests: [openInto('release/2.8')],
    totalCount: 1,
    truncated: false,
    defaultBranch: 'main',
    merged: [],
    lookups: [],
    mergedTruncated: false,
  },
  rules: {
    rulesets: [{ include: ['refs/heads/release/*'], exclude: [], gatesMerging: true, queue: true }],
    unavailable: undefined,
    leftOut: false,
  },
} satisfies { list: OpenPullRequestList; rules: TrunkRuleList };

function watchOf(source: QueueSource, branch = 'main') {
  const published: QueueState[] = [];
  const watch = new QueueWatch({
    id: 'q',
    login: 'tess-okafor',
    branch,
    source,
    publish: (state) => published.push(state),
  });
  return { watch, published };
}

describe('a merge queue’s tab', () => {
  it('reads nothing until it’s on screen, then its queue and those waiting at once', async () => {
    const { source, asked } = fakeSource();
    const { watch, published } = watchOf(source);
    expect(watch.state()).toMatchObject({
      branch: 'main',
      read: { kind: 'reading' },
      readAt: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([]);

    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['view main', 'waiting main']);
    expect(published.at(-1)).toMatchObject({
      read: { kind: 'queue', entries: [] },
      readAt: 1_060_000,
      branches: [{ name: 'main', count: 3 }],
      failure: null,
    });
  });

  it('reads the queue every 20 s and those waiting every 2 minutes while it’s on screen', async () => {
    const { source, asked } = fakeSource();
    const { watch } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(WAITING_EVERY);
    expect(asked.filter((each) => each === 'view main')).toHaveLength(
      1 + WAITING_EVERY / QUEUE_EVERY,
    );
    expect(asked.filter((each) => each === 'waiting main')).toHaveLength(2);
  });

  it('stops reading off screen, keeps what it read, and reads again when it’s back once due', async () => {
    const { source, asked, state } = fakeSource();
    const { watch } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(5_000);
    watch.hide();
    asked.length = 0;
    state.total = 7;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);
    expect(watch.state().branches).toEqual([{ name: 'main', count: 3 }]);

    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['view main', 'waiting main']);
    expect(watch.state().branches).toEqual([{ name: 'main', count: 7 }]);

    // Back again before the next read is due, it waits for it.
    watch.hide();
    asked.length = 0;
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY - 1);
    expect(asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual(['view main']);
  });

  it('backs off to every 2 minutes while reads fail, saying why and when it reads again', async () => {
    const { source, asked, state } = fakeSource();
    const { watch } = watchOf(source);
    state.failing = true;
    watch.show();
    const waits: number[] = [];
    for (let read = 0; read < 5; read++) {
      await vi.advanceTimersByTimeAsync(0);
      const { failure } = watch.state();
      if (!failure) throw new Error('expected a failure');
      expect(failure.message).toBe('GitHub couldn’t be reached.');
      const wait = (failure.retryAt ?? 0) - Date.now();
      waits.push(wait);
      await vi.advanceTimersByTimeAsync(wait);
    }
    expect(waits).toEqual([QUEUE_EVERY, 2 * QUEUE_EVERY, 4 * QUEUE_EVERY, QUEUE_MOST, QUEUE_MOST]);

    // Once a read succeeds, it's every 20 s again, and the failure goes.
    state.failing = false;
    await vi.advanceTimersByTimeAsync(QUEUE_MOST);
    expect(watch.state().failure).toBeNull();
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(asked).toContain('view main');
  });

  it('backs off reading those waiting and the other branches’ counts on their own while they fail', async () => {
    const { source, asked, state } = fakeSource(WITH_RELEASE);
    const { watch } = watchOf(source);
    state.failing = true;
    watch.show();
    // Ten minutes of GitHub out of reach.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const times = (read: string) => asked.filter((each) => each === read).length;
    // The queue at 0, 20, 60, 140, 260, 380 and 500 s; the others at 0, 2 and 6 minutes.
    expect(times('view main')).toBe(7);
    expect(times('waiting main')).toBe(3);
    expect(times('view release/2.8')).toBe(3);

    // Their waits double up to 10 minutes, and go back to 2 once a read succeeds.
    for (let read = 0; read < 3; read++) await vi.advanceTimersByTimeAsync(WAITING_MOST);
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(WAITING_MOST);
    expect(times('waiting main')).toBe(1);
    state.failing = false;
    await vi.advanceTimersByTimeAsync(WAITING_MOST);
    expect(watch.state().read).toMatchObject({ kind: 'queue', waitingCutShort: false });
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(WAITING_EVERY);
    expect(times('waiting main')).toBe(1);
    expect(times('view release/2.8')).toBe(1);
  });

  it('drops the branch it showed for the one asked for, reads it at once, and keeps offering both', async () => {
    let answer: ((view: QueueView) => void) | undefined;
    let held = false;
    const { source, asked } = fakeSource();
    // The first read of main's queue answers only when the test says.
    const slow: QueueSource = {
      ...source,
      view(branch, signal) {
        if (branch !== 'main' || held) return source.view(branch, signal);
        held = true;
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    };
    const { watch } = watchOf(slow);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    watch.setBranch('release/2.8');
    expect(watch.state()).toMatchObject({ branch: 'release/2.8', read: { kind: 'reading' } });
    await vi.advanceTimersByTimeAsync(0);
    // main's answer, coming after, is dropped.
    answer?.(viewOf('main', 9));
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toContain('view release/2.8');
    // main is still offered, and counted when the other branches next are.
    expect(watch.state()).toMatchObject({
      branch: 'release/2.8',
      read: { kind: 'queue' },
      branches: [
        { name: 'main', count: null },
        { name: 'release/2.8', count: 1 },
      ],
    });
    await vi.advanceTimersByTimeAsync(WAITING_EVERY);
    expect(watch.state().branches).toEqual([
      { name: 'main', count: 3 },
      { name: 'release/2.8', count: 1 },
    ]);
  });

  it('counts the other branches’ queues every 2 minutes', async () => {
    const { source, asked } = fakeSource(WITH_RELEASE);
    const { watch } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['view main', 'waiting main', 'view release/2.8']);
    expect(watch.state().branches).toEqual([
      { name: 'main', count: 3 },
      { name: 'release/2.8', count: 1 },
    ]);
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(WAITING_EVERY);
    expect(asked.filter((each) => each === 'view release/2.8')).toHaveLength(1);
  });

  it('stops counting the other branches as it goes off screen', async () => {
    let answer: ((view: QueueView) => void) | undefined;
    const { source, asked } = fakeSource({
      ...WITH_RELEASE,
      list: {
        ...WITH_RELEASE.list,
        pullRequests: [openInto('release/2.8'), openInto('release/2.9')],
      },
    });
    // The count of release/2.8 answers only when the test says.
    const slow: QueueSource = {
      ...source,
      view(branch, signal) {
        if (branch !== 'release/2.8') return source.view(branch, signal);
        asked.push(`view ${branch}`);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    };
    const { watch } = watchOf(slow);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    watch.hide();
    answer?.(viewOf('release/2.8', 4));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(asked).toEqual(['view main', 'waiting main', 'view release/2.8']);
    // What it was reading when it went still counts.
    expect(watch.state().branches).toContainEqual({ name: 'release/2.8', count: 4 });

    // Back on screen, it counts the one it left out, and not the one just counted.
    asked.length = 0;
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['view main', 'view release/2.9']);
  });

  it('reads nothing while its account is away, saying why, and everything at once once it’s back', async () => {
    const { source, asked } = fakeSource(WITH_RELEASE);
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    watch.hold('tess-okafor is signed out.');
    expect(published.at(-1)?.failure).toEqual({
      message: 'tess-okafor is signed out.',
      retryAt: null,
    });
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    watch.hide();
    watch.show();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);

    watch.release();
    expect(watch.state().failure).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['view main', 'waiting main', 'view release/2.8']);
  });

  it('reads nothing more once its tab closes', async () => {
    const { source, asked } = fakeSource();
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    watch.stop();
    asked.length = 0;
    const heard = published.length;
    watch.show();
    watch.setBranch('dev');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);
    expect(published).toHaveLength(heard);
  });
});
