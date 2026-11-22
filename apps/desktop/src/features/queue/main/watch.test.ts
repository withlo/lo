// Reading a merge queue's tab: only while it's on screen and its account is there, the queue every
// 20 s backing off to every 2 minutes while reads fail, those waiting to join and the other
// branches' counts every 2 minutes backing off to every 10, nothing of a branch it no longer shows,
// and why each entry Lo saw leave left, read once.

import type {
  OpenPullRequestList,
  QueueEntryFacts,
  QueueRemoval,
  QueueView,
  QueueWaiting,
  TrunkRuleList,
} from '@lo/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QUEUE_EVERY, type QueueState } from '../contract.ts';
import {
  LEFT_AGAIN,
  LEFT_MOST,
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
  const state = { failing: false, total: 3, delay: 0 };
  const source: QueueSource = {
    async view(branch) {
      asked.push(`view ${branch}`);
      if (state.delay > 0) await new Promise((resolve) => setTimeout(resolve, state.delay));
      if (state.failing) throw new Error('GitHub couldn’t be reached.');
      return viewOf(branch, branch === 'main' ? state.total : 1);
    },
    async waiting(branch) {
      asked.push(`waiting ${branch}`);
      if (state.delay > 0) await new Promise((resolve) => setTimeout(resolve, state.delay));
      if (state.failing) throw new Error('GitHub couldn’t be reached.');
      return waitingOf(branch);
    },
    removal: (number) => Promise.reject(new Error(`#${number} never left the queue.`)),
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

/** When the entries the tests read joined their queue. */
const JOINED = '2026-11-16T11:40:00Z';

/** Pull request `number`'s entry at `position`. */
function entryOf(number: number, position: number): QueueEntryFacts {
  return {
    id: `MQE_${number}`,
    position,
    state: 'AWAITING_CHECKS',
    enqueuedAt: JOINED,
    estimate: undefined,
    jump: false,
    solo: false,
    enqueuer: 'tess-okafor',
    base: undefined,
    tested: undefined,
    checks: [],
    pullRequest: {
      id: `PR_${number}`,
      number,
      title: `Pull request ${number}`,
      url: `https://github.com/o/r/pull/${number}`,
      head: 'a'.repeat(40),
      author: 'mira-chen',
      viewerDidAuthor: false,
    },
  };
}

/** `main`'s queue holding `numbers`, in order, read whole unless `total` says it holds more. */
function queueOf(
  numbers: readonly number[],
  extra: Partial<QueueView> = {},
  total = numbers.length,
): QueueView {
  const view = viewOf('main', total);
  if (view.queue) view.queue.entries = numbers.map((number, at) => entryOf(number, at + 1));
  return { ...view, ...extra };
}

/** Why `number` left: its checks failed in the queue, as GitHub's queue removed it at `at`. */
function failedIn(number: number, at: string): QueueRemoval {
  return {
    number,
    state: 'OPEN',
    inQueue: false,
    removal: {
      at,
      reason: 'failed_checks',
      by: 'github-merge-queue',
      tested: 'b'.repeat(40),
      checks: [
        {
          kind: 'checkRun',
          name: 'ci',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          url: 'https://github.com/o/r/actions/runs/1',
        },
      ],
    },
    leftOut: [],
  };
}

/** A source whose queue reads answer `reads` in turn, the last again, and why each left `removals`. */
function leavingSource(
  reads: readonly QueueView[],
  removals: (number: number) => Promise<QueueRemoval>,
) {
  const asked: string[] = [];
  let at = 0;
  const source: QueueSource = {
    async view(branch) {
      asked.push(`view ${branch}`);
      const read = reads[Math.min(at, reads.length - 1)];
      at += 1;
      if (!read) throw new Error('nothing to read');
      return read;
    },
    async waiting(branch) {
      return waitingOf(branch);
    },
    removal(number) {
      asked.push(`removal ${number}`);
      return removals(number);
    },
    repository: () => ({ list: undefined, rules: undefined }),
  };
  return { source, asked };
}

/** The pull requests the tab lists as having left, the latest first, with why. */
function leftIn(state: QueueState | undefined): [number, string][] {
  return state?.read.kind === 'queue'
    ? state.read.left.map(({ number, why }) => [number, why.kind])
    : [];
}

describe('those that left the queue', () => {
  it('are read once each, as a later read no longer lists them, and listed with why, the latest first', async () => {
    const { source, asked } = leavingSource(
      [queueOf([1, 2, 3]), queueOf([2, 3]), queueOf([3])],
      async (number) => failedIn(number, '2026-11-16T12:00:00Z'),
    );
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(leftIn(published.at(-1))).toEqual([]);
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(leftIn(published.at(-1))).toEqual([[1, 'failedChecks']]);
    const read = published.at(-1)?.read;
    const [first] = read?.kind === 'queue' ? read.left : [];
    expect(first).toEqual({
      number: 1,
      title: 'Pull request 1',
      url: 'https://github.com/o/r/pull/1',
      at: Date.parse('2026-11-16T12:00:00Z'),
      enqueuedAt: Date.parse(JOINED),
      why: {
        kind: 'failedChecks',
        checks: [{ name: 'ci', url: 'https://github.com/o/r/actions/runs/1' }],
      },
      partial: false,
    });
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY * 3);
    expect(leftIn(published.at(-1))).toEqual([
      [2, 'failedChecks'],
      [1, 'failedChecks'],
    ]);
    expect(asked.filter((each) => each.startsWith('removal'))).toEqual(['removal 1', 'removal 2']);
  });

  it('are none when a read may not list every entry: GitHub left part of it out, or it holds more than Lo reads', async () => {
    const { source, asked } = leavingSource(
      [
        queueOf([1, 2]),
        queueOf([2], { leftOut: ['mergeQueue.entries.nodes.0'] }),
        queueOf([2], {}, 150),
      ],
      async (number) => failedIn(number, '2026-11-16T12:00:00Z'),
    );
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY * 3);
    expect(asked.filter((each) => each.startsWith('removal'))).toEqual([]);
    expect(leftIn(published.at(-1))).toEqual([]);
  });

  it('are listed as Lo can’t tell why when the read of why fails, and not at all when GitHub says one is queued after all', async () => {
    const { source } = leavingSource([queueOf([1, 2, 3]), queueOf([3])], async (number) => {
      if (number === 1) throw new Error('GitHub couldn’t be reached.');
      return { number, state: 'OPEN', inQueue: true, removal: undefined, leftOut: [] };
    });
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(leftIn(published.at(-1))).toEqual([[1, 'unknown']]);
  });

  it('drop one in the queue again', async () => {
    const { source } = leavingSource(
      [queueOf([1, 2]), queueOf([2]), queueOf([2, 1])],
      async (number) => failedIn(number, '2026-11-16T12:00:00Z'),
    );
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(leftIn(published.at(-1))).toEqual([[1, 'failedChecks']]);
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(leftIn(published.at(-1))).toEqual([]);
  });

  it('keep no more than the latest few, and read why only for those', async () => {
    const many = Array.from({ length: LEFT_MOST + 2 }, (_, at) => at + 10);
    const { source, asked } = leavingSource([queueOf(many), queueOf([])], async (number) =>
      failedIn(number, '2026-11-16T12:00:00Z'),
    );
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(leftIn(published.at(-1))).toHaveLength(LEFT_MOST);
    expect(asked.filter((each) => each.startsWith('removal'))).toHaveLength(LEFT_MOST);
    // Those nearest the front.
    expect(leftIn(published.at(-1)).map(([number]) => number)).not.toContain(many.at(-1));
  });

  it('read why once more when GitHub’s last removal is from before it joined, then say Lo can’t tell', async () => {
    let reads = 0;
    const { source, asked } = leavingSource([queueOf([1, 2]), queueOf([2])], async (number) => {
      reads += 1;
      // An earlier entry's removal, then still none since it joined.
      return failedIn(number, '2026-11-16T11:00:00Z');
    });
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY);
    expect(leftIn(published.at(-1))).toEqual([]);
    await vi.advanceTimersByTimeAsync(LEFT_AGAIN);
    expect(reads).toBe(2);
    expect(asked.filter((each) => each.startsWith('removal'))).toEqual(['removal 1', 'removal 1']);
    expect(leftIn(published.at(-1))).toEqual([[1, 'unknown']]);
  });

  it('take a removal that came once the timeline caught up', async () => {
    let reads = 0;
    const { source } = leavingSource([queueOf([1, 2]), queueOf([2])], async (number) => {
      reads += 1;
      return reads === 1
        ? { number, state: 'OPEN', inQueue: true, removal: undefined, leftOut: [] }
        : failedIn(number, '2026-11-16T12:00:00Z');
    });
    const { watch, published } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(QUEUE_EVERY + LEFT_AGAIN);
    expect(leftIn(published.at(-1))).toEqual([[1, 'failedChecks']]);
  });
});

describe('what a change to the queue acts on', () => {
  it('is the last read while it’s no older than asked and made since, else a read made now', async () => {
    const { source, asked } = fakeSource();
    const { watch } = watchOf(source);
    watch.show();
    await vi.advanceTimersByTimeAsync(0);
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await watch.fresh(40_000)).toMatchObject({ branch: 'main' });
    expect(asked).toEqual([]);
    // Made before the change it follows ended: read again.
    expect(await watch.fresh(40_000, 1_005_000)).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['view main']);
    // Older than asked: read again.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await watch.fresh(1_000)).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['view main', 'view main']);
  });

  it('reads now while the tab is off screen, and says why when that read fails', async () => {
    const { source, asked, state } = fakeSource();
    const { watch } = watchOf(source);
    state.failing = true;
    expect(await watch.fresh(40_000)).toBe('GitHub couldn’t be reached.');
    expect(asked).toEqual(['view main']);
    // A failed read is never acted on: read again.
    state.failing = false;
    expect(await watch.fresh(40_000)).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['view main', 'view main']);
    // Off screen, nothing more is read on its own.
    await vi.advanceTimersByTimeAsync(QUEUE_MOST * 2);
    expect(asked).toHaveLength(2);
  });

  it('shares the read under way, and reads nothing while its account is away', async () => {
    const { source, asked } = fakeSource();
    const { watch } = watchOf(source);
    const [one, two] = await Promise.all([watch.fresh(0), watch.fresh(0)]);
    expect(one).toBe(two);
    expect(asked).toEqual(['view main']);
    watch.hold('rozed-bot is signed out.');
    expect(await watch.fresh(0)).toBe('rozed-bot is signed out.');
    expect(await watch.freshWaiting(0)).toBe('rozed-bot is signed out.');
    expect(asked).toEqual(['view main']);
  });

  it('reads those waiting to join afresh the same way', async () => {
    const { source, asked } = fakeSource();
    const { watch } = watchOf(source);
    expect(await watch.freshWaiting(40_000)).toMatchObject({ branch: 'main' });
    expect(await watch.freshWaiting(40_000)).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['waiting main']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await watch.freshWaiting(40_000, 1_000_500)).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['waiting main', 'waiting main']);
  });

  it('takes the one read it waited for, however long it took, and reads again only after an older one', async () => {
    const { source, asked, state } = fakeSource();
    const { watch } = watchOf(source);
    state.delay = 2_000;
    const queue = watch.fresh(0, 999_000);
    const waiting = watch.freshWaiting(0, 999_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await queue).toMatchObject({ branch: 'main' });
    expect(await waiting).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['view main', 'waiting main']);
    // One under way, asked for before the change it follows ended: waited for, then one more.
    asked.length = 0;
    const first = watch.fresh(0);
    await vi.advanceTimersByTimeAsync(1_000);
    const second = watch.fresh(0, 1_005_500);
    await vi.advanceTimersByTimeAsync(5_000);
    await first;
    expect(await second).toMatchObject({ branch: 'main' });
    expect(asked).toEqual(['view main', 'view main']);
  });

  it('says so when the tab shows another branch by the time the read answers', async () => {
    const { source } = fakeSource();
    const { watch } = watchOf(source);
    const read = watch.fresh(0);
    watch.setBranch('release/2.8');
    expect(await read).toBe('The tab shows release/2.8’s queue now.');
  });

  it('tells who listens of each read that answered, and when it was asked for', async () => {
    const { source } = fakeSource();
    const heard: unknown[] = [];
    const watch = new QueueWatch({
      id: 'q',
      login: 'tess-okafor',
      branch: 'main',
      source,
      publish: () => undefined,
      heard: (read) => heard.push([read.kind, read.from]),
    });
    await watch.fresh(0);
    await watch.freshWaiting(0);
    expect(heard).toEqual([
      ['queue', 1_000_000],
      ['waiting', 1_000_000],
    ]);
  });
});
