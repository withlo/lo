// A view's pull request in a merge queue, from the merge queue's recordings on rozed-dev/e2e as
// rozed-bot: e4/queued's queue as GitHub tested a merge fixture generation's four pull requests,
// read every 20 s while the queued view is on screen, and why one left, read once its status no
// longer says queued. Once the queue stops listing it, the place it had is never said again, and
// the pull request is read again, once. Nothing is read off screen, for one that merged, or while
// its account is signed out.

import { GithubClient, Token, type PollStatus, type QueueView } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { MergeState, MergeView, Queued } from '../contract.ts';
import { PLACE_EVERY, PLACE_MOST, QueueReads, REMOVAL_AGAIN, type QueuePoller } from './queued.ts';

beforeEach(() => {
  vi.useFakeTimers({
    now: Date.parse('2026-11-16T19:15:00Z'),
    toFake: ['setTimeout', 'clearTimeout', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** #134, queued-fail, which failed in e4/queued's queue, viewed in `t1` as rozed-bot. */
function viewOf(
  number = 134,
  login = 'rozed-bot',
): Pick<PullTabInfo, 'repository' | 'number' | 'acting'> {
  return {
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number,
    acting: { kind: 'account', login },
  };
}

/** A merge status: queued into e4/queued, or as `verdict` says, as GitHub said it at `readAt`. */
function known(verdict: MergeState['verdict'] = 'queued', readAt = Date.now()): MergeView {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
  const state = {
    verdict,
    base: 'e4/queued',
    position: verdict === 'queued' ? 4 : null,
    readAt,
  } as MergeState;
  return { kind: 'known', state };
}

/** Whether `value` is a read of a queue, which a test may change. */
function isQueueView(value: unknown): value is QueueView {
  return typeof value === 'object' && value !== null && 'branch' in value && 'queue' in value;
}

/**
 * A poller answering from the recordings: e4/queued's queue from `queue_view_e2e`, in the order
 * GitHub gave it, the last again, changed by `state.view` when set, and why each left from
 * `queue_removal_e2e`. While `failing`, every read fails; `signedOut` is its account's state, which
 * `signIn` and `signOut` change, telling those who listen.
 */
function fakePoller() {
  const views = replayFetch('queue_view_e2e');
  const removals = replayFetch('queue_removal_e2e');
  const asked: string[] = [];
  const again: string[] = [];
  const state: { failing: boolean; view?: (view: QueueView) => QueueView } = { failing: false };
  const status: PollStatus = {
    rateLimit: { kind: 'normal' },
    offline: undefined,
    signedOut: false,
  };
  const listeners = new Set<() => void>();
  const client = new GithubClient({
    fetch: async (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      const removal = body.includes('QueueRemoval');
      asked.push(removal ? 'removal' : 'queue');
      return (removal ? removals : views)(input, init);
    },
    token: new Token('x'),
  });
  const poller: QueuePoller = {
    async readOnce(request) {
      if (state.failing) throw new Error('GitHub can’t be reached.');
      const read = await request(client);
      const change = state.view;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the read it changes.
      return change && isQueueView(read) ? (change(read) as typeof read) : read;
    },
    async changed(target) {
      again.push(target.key);
    },
    status: () => status,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const tell = (signedOut: boolean) => {
    status.signedOut = signedOut;
    for (const listener of listeners) listener();
  };
  return {
    poller,
    asked,
    again,
    state,
    signOut: () => tell(true),
    signIn: () => tell(false),
  };
}

/** `view` without pull request `number`'s entry, as once it's out of the queue. */
function without(number: number): (view: QueueView) => QueueView {
  return (view) => {
    if (!view.queue) return view;
    const entries = view.queue.entries.filter((entry) => entry.pullRequest?.number !== number);
    return { ...view, queue: { ...view.queue, entries, total: entries.length } };
  };
}

/** `view` with pull request `number`'s entry joined at `at`. */
function joinedAt(number: number, at: string): (view: QueueView) => QueueView {
  return (view) => {
    if (!view.queue) return view;
    const entries = view.queue.entries.map((entry) =>
      entry.pullRequest?.number === number ? { ...entry, enqueuedAt: at } : entry,
    );
    return { ...view, queue: { ...view.queue, entries } };
  };
}

function readsOf(
  poller: QueuePoller,
  options: { onScreen?: () => string | undefined; view?: typeof viewOf } = {},
) {
  const sent: Queued[] = [];
  const logged: string[] = [];
  const views = new Map([['t1', (options.view ?? viewOf)()]]);
  const reads = new QueueReads({
    poller: async () => poller,
    view: (id) => views.get(id),
    onScreen: options.onScreen ?? (() => 't1'),
    publish: (queued) => sent.push(queued),
    log: (line) => logged.push(line),
  });
  return { reads, sent, views, logged };
}

const FAILED_CI = {
  name: 'ci',
  state: 'failed',
  url: expect.stringMatching(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//),
};

describe('a queued pull request on screen', () => {
  it('reads its queue at once, then every 20 s, for its place, how it stands and what failed', async () => {
    const { poller, asked } = fakePoller();
    const { reads, sent } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['queue']);
    expect(sent.at(-1)).toEqual({
      id: 't1',
      queue: {
        place: {
          kind: 'listed',
          position: 4,
          state: 'QUEUED',
          timeToMerge: null,
          failed: [],
          partial: false,
        },
        left: null,
      },
    });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 3);
    expect(asked).toEqual(['queue', 'queue', 'queue', 'queue']);
    expect(reads.current('t1').place).toEqual({
      kind: 'listed',
      position: 4,
      state: 'UNMERGEABLE',
      timeToMerge: null,
      failed: [FAILED_CI],
      partial: false,
    });
    // Its failed check's run is a page the merge status may open.
    const place = reads.current('t1').place;
    const run = place?.kind === 'listed' ? place.failed[0]?.url : undefined;
    expect(reads.links('t1', run ?? '')).toBe(true);
    expect(reads.links('t1', 'https://example.com/')).toBe(false);
  });

  it('reads nothing off screen, and again when it’s back', async () => {
    const { poller, asked } = fakePoller();
    let onScreen: string | undefined = 't2';
    const { reads } = readsOf(poller, { onScreen: () => onScreen });
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 3);
    expect(asked).toEqual([]);
    onScreen = 't1';
    reads.shown('t1');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['queue']);
    onScreen = 't2';
    reads.shown('t2');
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 3);
    expect(asked).toEqual(['queue']);
  });

  it('backs off to every 2 minutes while reads fail, keeping its last place', async () => {
    const { poller, asked, state } = fakePoller();
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    const first = reads.current('t1').place;
    state.failing = true;
    // 20 s, then 40, 80 and 120, as reads fail.
    await vi.advanceTimersByTimeAsync(PLACE_EVERY + 40_000 + 80_000 + PLACE_MOST);
    expect(reads.current('t1').place).toEqual(first);
    state.failing = false;
    await vi.advanceTimersByTimeAsync(PLACE_MOST - 1);
    expect(asked).toEqual(['queue']);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual(['queue', 'queue']);
  });

  it('says its checks may be missing some when GitHub left part of the queue out', async () => {
    const { poller, state } = fakePoller();
    state.view = (view) => ({ ...view, leftOut: ['mergeQueue.entries.nodes.3.checks'] });
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1').place).toMatchObject({ kind: 'listed', partial: true });
  });

  it('holds its reads while its account is signed out, and reads again once it’s back', async () => {
    const { poller, asked, signOut, signIn } = fakePoller();
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    const first = reads.current('t1').place;
    signOut();
    await vi.advanceTimersByTimeAsync(PLACE_MOST * 3);
    expect(asked).toEqual(['queue']);
    expect(reads.current('t1').place).toEqual(first);
    // Why it left waits for the account too.
    reads.heard({ id: 't1', view: known('ready') });
    await vi.advanceTimersByTimeAsync(PLACE_MOST);
    expect(asked).toEqual(['queue']);
    signIn();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['queue', 'removal']);
    expect(reads.current('t1').left?.why.kind).toBe('failedChecks');
  });
});

describe('a pull request the queue stops listing', () => {
  it('will be removed, then left the queue, never its old place, and is read again once', async () => {
    const { poller, again, state } = fakePoller();
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 3);
    expect(reads.current('t1').place).toMatchObject({ state: 'UNMERGEABLE' });
    state.view = without(134);
    await vi.advanceTimersByTimeAsync(PLACE_EVERY);
    expect(reads.current('t1').place).toEqual({ kind: 'unlisted', partial: false });
    expect(again).toEqual(['rozed-dev/e2e#134']);
    // Its status still says queued, and the queue still doesn't list it: asked once.
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 2);
    expect(again).toEqual(['rozed-dev/e2e#134']);
    expect(reads.current('t1').place).toEqual({ kind: 'unlisted', partial: false });
    // The read says it left without merging: why is read.
    reads.heard({ id: 't1', view: known('ready') });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1')).toEqual({
      place: null,
      left: {
        at: Date.parse('2026-11-16T19:24:30Z'),
        why: { kind: 'failedChecks', checks: [FAILED_CI] },
        partial: false,
      },
    });
  });

  it('merged, says nothing of it, and reads no removal', async () => {
    const { poller, asked, again, state } = fakePoller();
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    state.view = without(134);
    await vi.advanceTimersByTimeAsync(PLACE_EVERY);
    expect(reads.current('t1').place).toEqual({ kind: 'unlisted', partial: false });
    expect(again).toEqual(['rozed-dev/e2e#134']);
    reads.heard({ id: 't1', view: known('merged') });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY);
    expect(asked).toEqual(['queue', 'queue']);
    expect(reads.current('t1')).toEqual({ place: null, left: null });
  });

  it('is read again when GitHub left part of the queue out, and says nothing of where it went', async () => {
    const { poller, again, state } = fakePoller();
    state.view = (view) => ({ ...without(134)(view), leftOut: ['mergeQueue.entries.nodes.3'] });
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1').place).toEqual({ kind: 'unlisted', partial: true });
    expect(again).toEqual([]);
  });
});

describe('a pull request that leaves the queue', () => {
  it('reads why once, and says so with the checks that failed, until it’s queued again', async () => {
    const { poller, asked } = fakePoller();
    const { reads, sent } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    reads.heard({ id: 't1', view: known('blocked') });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 3);
    expect(asked).toEqual(['queue', 'removal']);
    const left = reads.current('t1');
    expect(left.place).toBeNull();
    expect(left.left).toMatchObject({
      at: Date.parse('2026-11-16T19:24:30Z'),
      why: { kind: 'failedChecks', checks: [{ name: 'ci', state: 'failed' }] },
      partial: false,
    });
    expect(sent.at(-1)?.queue).toEqual(left);
    // Read again, its status says the same: nothing more is read.
    reads.heard({ id: 't1', view: known('waiting') });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['queue', 'removal']);

    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1').left).toBeNull();
  });

  it('reads why once more when GitHub’s last removal is from before it joined, then can’t tell', async () => {
    const { poller, asked, state } = fakePoller();
    // It joined after the removal GitHub lists, which is an earlier entry's.
    state.view = joinedAt(134, '2026-11-16T19:30:00Z');
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    reads.heard({ id: 't1', view: known('ready') });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['queue', 'removal']);
    expect(reads.current('t1').left).toBeNull();
    await vi.advanceTimersByTimeAsync(REMOVAL_AGAIN);
    expect(asked).toEqual(['queue', 'removal', 'removal']);
    expect(reads.current('t1').left).toEqual({
      at: null,
      why: { kind: 'unknown', why: null },
      partial: false,
    });
  });

  it('takes why it left while Lo was closed, as its status kept from before still said queued', async () => {
    const { poller, asked } = fakePoller();
    const { reads } = readsOf(poller, { onScreen: () => undefined });
    // Kept from before the removal, the status is heard long after it, once Lo starts again.
    const kept = Date.now();
    vi.setSystemTime(Date.parse('2026-11-16T21:00:00Z'));
    reads.heard({ id: 't1', view: known('queued', kept) });
    reads.heard({ id: 't1', view: known('blocked') });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['removal']);
    expect(reads.current('t1').left).toMatchObject({
      at: Date.parse('2026-11-16T19:24:30Z'),
      why: { kind: 'failedChecks', checks: [{ name: 'ci', state: 'failed' }] },
    });
  });

  it('says nothing once it merged, nor for one Lo never saw queued', async () => {
    const { poller, asked } = fakePoller();
    const { reads, sent } = readsOf(poller);
    reads.heard({ id: 't1', view: known('ready') });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    reads.heard({ id: 't1', view: known('merged') });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY);
    expect(asked).toEqual(['queue']);
    expect(reads.current('t1')).toEqual({ place: null, left: null });
  });

  it('says Lo can’t tell why when the read of why fails', async () => {
    const { poller, state } = fakePoller();
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    state.failing = true;
    reads.heard({ id: 't1', view: known('blocked') });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1').left).toEqual({
      at: null,
      why: { kind: 'unknown', why: 'GitHub can’t be reached.' },
      partial: false,
    });
  });

  it('forgets why once the reader dismisses it', async () => {
    const { poller } = fakePoller();
    const { reads, sent } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    reads.heard({ id: 't1', view: known('closed') });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1').left).not.toBeNull();
    reads.forgetLeft('t1');
    expect(sent.at(-1)).toEqual({ id: 't1', queue: { place: null, left: null } });
  });
});

describe('a view that changes', () => {
  it('starts afresh for another account, and shows nothing acting as nobody', async () => {
    const { poller } = fakePoller();
    const { reads, sent, views } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.current('t1').place).not.toBeNull();
    views.set('t1', viewOf(134, 'tess-okafor'));
    reads.follow('t1');
    expect(sent.at(-1)).toEqual({ id: 't1', queue: { place: null, left: null } });
    expect(reads.current('t1')).toEqual({ place: null, left: null });
    views.set('t1', { ...viewOf(), acting: { kind: 'anonymous' } });
    reads.follow('t1');
    expect(reads.current('t1')).toEqual({ place: null, left: null });
  });

  it('reads what’s ahead once when asked, and refuses before the status is read', async () => {
    const { poller } = fakePoller();
    const { reads } = readsOf(poller, { view: () => viewOf(4821) });
    await expect(reads.ahead('t1')).rejects.toMatchObject({ code: 'unavailable' });
    reads.heard({ id: 't1', view: known('ready') });
    await expect(reads.ahead('t1')).resolves.toEqual({
      kind: 'queue',
      count: 4,
      atLeast: false,
      timeToMerge: null,
    });
  });

  it('reads nothing more once stopped', async () => {
    const { poller, asked } = fakePoller();
    const { reads } = readsOf(poller);
    reads.heard({ id: 't1', view: known() });
    reads.stop();
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 2);
    expect(asked).toEqual([]);
  });
});
