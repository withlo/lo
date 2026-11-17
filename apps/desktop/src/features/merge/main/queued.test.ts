// A view's pull request in a merge queue, from the merge queue's recordings on rozed-dev/e2e as
// rozed-bot: e4/queued's queue as GitHub tested a merge fixture generation's four pull requests,
// read every 20 s while the queued view is on screen, and why one left, read once its status no
// longer says queued. Nothing is read off screen, or for one that merged.

import { GithubClient, Token, type PullRef } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { MergeState, MergeView, Queued } from '../contract.ts';
import { PLACE_EVERY, PLACE_MOST, QueueReads, type QueuePoller } from './queued.ts';

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

/** A merge status: queued into e4/queued, or as `verdict` says. */
function known(verdict: MergeState['verdict'] = 'queued'): MergeView {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
  const state = {
    verdict,
    base: 'e4/queued',
    position: verdict === 'queued' ? 4 : null,
  } as MergeState;
  return { kind: 'known', state };
}

/**
 * A poller answering from the recordings: e4/queued's queue from `queue_view_e2e`, in the order
 * GitHub gave it, the last again, and why each left from `queue_removal_e2e`. While `failing`, every
 * read fails.
 */
function fakePoller() {
  const views = replayFetch('queue_view_e2e');
  const removals = replayFetch('queue_removal_e2e');
  const asked: string[] = [];
  const state = { failing: false };
  const client = new GithubClient({
    fetch: async (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      const removal = body.includes('QueueRemoval');
      asked.push(removal ? 'removal' : 'queue');
      return (removal ? removals : views)(input, init);
    },
    token: new Token('x'),
  });
  const again: string[] = [];
  const poller: QueuePoller = {
    async readOnce(request) {
      if (state.failing) throw new Error('GitHub can’t be reached.');
      return request(client);
    },
    readMergeFactsAgain(pull: PullRef) {
      again.push(pull.key);
    },
  };
  return { poller, asked, again, state };
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
        place: { kind: 'listed', position: 4, state: 'QUEUED', timeToMerge: null, failed: [] },
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
      failed: [
        {
          name: 'ci',
          state: 'failed',
          url: expect.stringMatching(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//),
        },
      ],
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

  it('asks for the merge status again, once, when a read no longer lists it', async () => {
    const { poller, again } = fakePoller();
    const { reads } = readsOf(poller, { view: () => viewOf(4821) });
    reads.heard({ id: 't1', view: known() });
    await vi.advanceTimersByTimeAsync(PLACE_EVERY * 2);
    expect(reads.current('t1').place).toEqual({ kind: 'unlisted', partial: false });
    expect(again).toEqual(['rozed-dev/e2e#4821']);
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
