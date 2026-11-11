// Reads the poller keeps current and in its cache, on a fake clock: a made-up read whose requests
// send nothing, each counting itself and answering what the test set, and the stack trees' read
// of their layers, replaying `stacks_playground`'s answer.

import { cassette, type Interaction, type Json } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  array,
  at,
  comment,
  commentOn,
  object,
  log,
  Polling,
  postComment,
  postCommentOn,
  pr,
  recorded,
  repoAnswers,
  useFakeClock,
  wall,
  withBody,
  type Logged,
} from './support/polling.ts';
import { GithubError } from '../src/errors.ts';
import { PUSH_HISTORY_WATCHED } from '../src/push-history.ts';
import { readPullSummary } from '../src/pulls.ts';
import { STACK_LAYERS, type ReadKind, type ReadMark } from '../src/poll/reads.ts';
import type { PullRef } from '../src/refs.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

/**
 * What the made-up read reads: the value the test set. It watches what a push history watches, and
 * zero stands for a value one of whose parts couldn't be read.
 */
const COUNTED: ReadKind<number> = {
  name: 'Counted',
  watched: PUSH_HISTORY_WATCHED,
  complete: (value) => value !== 0,
};

/** How many times the read ran, and what it answers next: a value, or an error. */
class Answers {
  runs = 0;
  #next: { ok: true; value: number } | { ok: false; message: string } = { ok: true, value: 1 };

  answer(next: number | { error: string }): void {
    this.#next =
      typeof next === 'number' ? { ok: true, value: next } : { ok: false, message: next.error };
  }

  /** The read's request: counts itself and answers what was set. */
  readonly request = (): Promise<number> => {
    this.runs += 1;
    const next = this.#next;
    return next.ok
      ? Promise.resolve(next.value)
      : Promise.reject(new GithubError({ kind: 'decode', message: next.message }));
  };
}

/** Keeps a {@link COUNTED} read for `pull`: resolves with what the poller has once the cache answers. */
async function counted(t: Polling, pull: PullRef, answers: Answers): Promise<number | undefined> {
  return (await t.poller.readCached(pull, COUNTED, answers.request))?.value;
}

function cachedCount(t: Polling): number | undefined {
  return t.poller.cachedRead(pr(1), COUNTED)?.value;
}

/** PR #1's recorded check with `edit` made to it. */
function checkWith(
  r: readonly Interaction[],
  edit: (pull: Record<string, Json>) => void,
): Interaction {
  return withBody(at(r, 1), (body) => {
    edit(object(body, 'data', 'repository', 'pullRequest'));
  });
}

test('a cached read runs after the open prs poll and again when a field it watches changes', async () => {
  const r = recorded();
  const rollup = checkWith(r, (pull) => {
    pull['statusCheckRollup'] = { state: 'PENDING' };
  });
  const commented = checkWith(r, (pull) => {
    pull['statusCheckRollup'] = { state: 'PENDING' };
    object(pull, 'timelineItems')['updatedAt'] = '2026-11-06T12:00:00Z';
    object(pull, 'comments')['totalCount'] = 1;
  });
  const forcePushed = checkWith(r, (pull) => {
    pull['statusCheckRollup'] = { state: 'PENDING' };
    object(pull, 'timelineItems')['updatedAt'] = '2026-11-06T12:01:00Z';
    object(pull, 'comments')['totalCount'] = 1;
    object(pull, 'revisionEvents')['filteredCount'] = 1;
  });
  // You submit the review you had pending: the count of every review, which held it already, stays
  // as it was.
  const submitted = checkWith(r, (pull) => {
    pull['statusCheckRollup'] = { state: 'PENDING' };
    object(pull, 'timelineItems')['updatedAt'] = '2026-11-06T12:02:00Z';
    object(pull, 'comments')['totalCount'] = 1;
    object(pull, 'revisionEvents')['filteredCount'] = 1;
    const reviews = object(pull, 'submittedReviews');
    reviews['totalCount'] = Number(reviews['totalCount']) + 1;
  });
  const interactions = [
    at(r, 0),
    at(r, 6),
    at(r, 1),
    at(r, 1),
    rollup,
    commented,
    forcePushed,
    submitted,
    at(r, 2),
    ...repoAnswers(r),
  ];
  const t = await Polling.start('cached_read', interactions);
  const answers = new Answers();
  answers.answer(1);
  void t.poller.setOpen(pr(1));
  const atOnce = counted(t, pr(1), answers);
  await t.run();
  expect(await atOnce).toBeUndefined();
  expect(answers.runs).toBe(1);
  expect(cachedCount(t)).toBe(1);
  expect(t.events()).toContain('read Counted #1');

  // The checks' state isn't a field it watches, and a comment, which moves the timeline, changes
  // none.
  await t.runUntil(40);
  expect(answers.runs).toBe(1);
  expect(t.events()).toEqual(['check #1']);
  await t.runUntil(60);
  expect(answers.runs).toBe(1);
  expect(t.events()).toEqual(['check #1']);

  // A force-push: it's read again, after the poll. An unchanged answer says only that it was
  // confirmed.
  await t.runUntil(80);
  expect(answers.runs).toBe(2);
  expect(t.events()).toEqual(['check #1', 'confirmed Counted #1']);
  expect(cachedCount(t)).toBe(1);
  // A submitted review: it's read again.
  await t.runUntil(100);
  expect(answers.runs).toBe(3);
  await t.runUntil(120);
  expect(answers.runs).toBe(3);

  // The cache took the new stamp, so after a restart it isn't read again.
  await t.restart();
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  await t.runUntil(125);
  expect(answers.runs).toBe(3);
});

test('a cached read is refreshed every five minutes and kept across restarts', async () => {
  const t = await Polling.start('cached_read_refresh', recorded());
  const answers = new Answers();
  answers.answer(1);
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  t.events();

  // Like the details, every 5 minutes in the foreground. A new answer is sent.
  answers.answer(2);
  await t.runUntil(299);
  expect(answers.runs).toBe(1);
  await t.runUntil(300);
  expect(answers.runs).toBe(2);
  expect(t.events()).toEqual(['read Counted #1']);
  const refreshed = t.poller.cachedRead(pr(1), COUNTED);
  expect([refreshed?.value, refreshed?.fetchedAt]).toEqual([2, wall(300)]);
  // Not in the background.
  t.poller.setForeground(false);
  await t.run();
  await t.runUntil(1000);
  expect(answers.runs).toBe(2);
  t.poller.setForeground(true);
  await t.run();
  await t.runUntil(1001);
  expect(answers.runs).toBe(3);

  // After a restart, it's there at once, and since the check hasn't moved, it isn't read again.
  await t.restart();
  void t.poller.setOpen(pr(1));
  const atOnce = counted(t, pr(1), answers);
  await t.run();
  expect(await atOnce).toBe(2);
  await t.runUntil(1010);
  expect(answers.runs).toBe(3);
});

/**
 * A refresh that gives the same value says so, with when GitHub confirmed it: so does a read that
 * works again after one failed, though its value hasn't changed.
 */
test('a cached read that gives the same value says it was confirmed', async () => {
  const t = await Polling.start('cached_read_confirmed', recorded());
  const answers = new Answers();
  answers.answer(1);
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(t.events()).toContain('read Counted #1');

  // The 5-minute refresh gives the same value.
  await t.runUntil(300);
  expect(answers.runs).toBe(2);
  expect(t.events()).toEqual(['confirmed Counted #1']);
  let confirmed = t.poller.cachedRead(pr(1), COUNTED);
  expect([confirmed?.value, confirmed?.fetchedAt]).toEqual([1, wall(300)]);

  // The next refresh fails, and the one after it gives the same value again.
  answers.answer({ error: 'bad gateway' });
  await t.runUntil(600);
  expect(answers.runs).toBe(3);
  expect(t.events()).toEqual([
    "failed to read Counted #1: couldn't read GitHub's answer: bad gateway",
  ]);
  answers.answer(1);
  await t.runUntil(620);
  expect(answers.runs).toBe(4);
  expect(t.events()).toEqual(['confirmed Counted #1']);
  confirmed = t.poller.cachedRead(pr(1), COUNTED);
  expect([confirmed?.value, confirmed?.fetchedAt]).toEqual([1, wall(620)]);
});

/**
 * A read loads what the cache holds without holding anything up: it has nothing at once, then the
 * cached value arrives with an event, and GitHub isn't asked meanwhile, nor after while the check
 * hasn't moved.
 */
test('a cached read can load the cache in the background', async () => {
  const t = await Polling.start('cached_read_background', recorded());
  const answers = new Answers();
  answers.answer(2);
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(answers.runs).toBe(1);
  t.events();

  await t.restart();
  void t.poller.setOpen(pr(1));
  void t.poller.readCached(pr(1), COUNTED, answers.request);
  expect(cachedCount(t)).toBeUndefined();
  await t.run();
  await t.runUntil(10);
  expect(cachedCount(t)).toBe(2);
  expect(t.events(), 'the cached value arrives with an event').toContain('read Counted #1');
  expect(answers.runs).toBe(1);
});

/**
 * What a read that started after a mark finishes with is past the mark; what one that was under
 * way when it was taken reads isn't, as after a write whose answer was lost: that one may have read
 * before the write was done. The mark makes the read run again at once.
 */
test('only a read that started after a mark is past it', async () => {
  const t = await Polling.start('read_after_mark', recorded());
  let runs = 0;
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const held = [second.promise, first.promise];
  void t.poller.setOpen(pr(1));
  void t.poller.readCached(pr(1), COUNTED, async () => {
    runs += 1;
    const run = runs;
    await held.pop();
    return run;
  });
  await t.run();
  expect(runs, 'the first run is under way').toBe(1);

  const mark = t.poller.readAfresh(pr(1), COUNTED);
  await t.run();
  if (!mark) throw new Error('the read is kept');
  const after = (taken: ReadMark) => t.poller.readAfter(pr(1), COUNTED, taken)?.value;
  expect(after(mark)).toBeUndefined();
  first.resolve();
  await t.run();
  expect(cachedCount(t), "the first run's value is kept").toBe(1);
  expect(after(mark), 'but it started before the mark').toBeUndefined();
  expect(runs, 'the mark made it run again').toBe(2);

  second.resolve();
  await t.run();
  expect(after(mark)).toBe(2);
  // A mark before nothing runs: the next run is past it.
  const next = t.poller.readAfresh(pr(1), COUNTED);
  await t.run();
  if (!next) throw new Error('the read is kept');
  expect(after(next)).toBe(3);
});

/**
 * A mark makes a read that failed run at once, not after the wait its failure set: what waits on
 * it, such as a comment whose answer was lost, waits no longer than the read takes.
 */
test('a mark reads at once whatever wait a failure set', async () => {
  const t = await Polling.start('read_after_mark_failed', recorded());
  const answers = new Answers();
  answers.answer({ error: 'bad gateway' });
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(answers.runs).toBe(1);

  // Its failure waits the open pull request's 20 s.
  answers.answer(5);
  const mark = t.poller.readAfresh(pr(1), COUNTED);
  await t.run();
  if (!mark) throw new Error('the read is kept');
  expect(answers.runs, 'the mark reads at once').toBe(2);
  expect(t.poller.readAfter(pr(1), COUNTED, mark)?.value).toBe(5);
});

/**
 * A run after a mark that brings only part of the value says so, and the mark passes once a later
 * run brings all of it. A mark is its read's only: a poller made again, whose runs count from the
 * start, or another pull request's read, call it stale rather than wait on it.
 */
test('a mark hears of a partial read and is stale on another read', async () => {
  const t = await Polling.start('read_since_mark', recorded());
  const answers = new Answers();
  answers.answer(1);
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  const since = (pull: PullRef, taken: ReadMark) => {
    const where = t.poller.readSince(pull, COUNTED, taken);
    return where.kind === 'read' ? { kind: 'read', read: where.read.value } : where;
  };

  // Zero is a value one of whose parts couldn't be read. The mark's run starts at once.
  answers.answer(0);
  const mark = t.poller.readAfresh(pr(1), COUNTED);
  await t.run();
  if (!mark) throw new Error('the read is kept');
  expect(since(pr(1), mark)).toEqual({ kind: 'partial' });
  expect(t.poller.readAfter(pr(1), COUNTED, mark)).toBeUndefined();
  // It's read again after the open pull request's wait, whole.
  answers.answer(7);
  await t.runUntil(30);
  expect(since(pr(1), mark)).toEqual({ kind: 'read', read: 7 });

  expect(since(pr(2), mark), "another's read").toEqual({ kind: 'stale' });
  await t.restart();
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(since(pr(1), mark), 'a poller made again').toEqual({ kind: 'stale' });
});

test('a cached read that fails says so and is tried again at the open prs interval', async () => {
  const t = await Polling.start('cached_read_fails', recorded());
  const answers = new Answers();
  answers.answer({ error: 'no good' });
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(answers.runs).toBe(1);
  expect(t.events()).toContain("failed to read Counted #1: couldn't read GitHub's answer: no good");
  // The pull request itself is fine, and polled as ever.
  expect(t.poller.check(pr(1))).toBeDefined();

  answers.answer(7);
  await t.runUntil(19);
  expect(answers.runs).toBe(1);
  await t.runUntil(20);
  expect(answers.runs).toBe(2);
  expect(t.events()).toEqual(['read Counted #1']);
  expect(cachedCount(t)).toBe(7);
});

test('a cached read whose refresh keeps failing waits longer each time', async () => {
  const t = await Polling.start('cached_read_refresh_fails', recorded());
  const answers = new Answers();
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(answers.runs).toBe(1);

  // GitHub starts failing it, from its 5-minute refresh on.
  answers.answer({ error: 'bad gateway' });
  await t.runUntil(300);
  expect(answers.runs).toBe(2);
  await t.runUntil(319);
  expect(answers.runs).toBe(2);
  // It waits the open PR's 20 s, then 40, 80 and 160, then the 5-minute refresh's 300 each time:
  // tries at 320, 360, 440, 600, 900, 1200, 1500, 1800 and 2100 s.
  await t.runUntil(300 + 30 * 60);
  expect(answers.runs).toBe(11);
  expect(cachedCount(t)).toBe(1);

  // One that works again is read as before.
  answers.answer(5);
  await t.runUntil(2400);
  expect(answers.runs).toBe(12);
  expect(cachedCount(t)).toBe(5);
  await t.runUntil(2690);
  expect(answers.runs).toBe(12);
});

test('a cached read that isnt complete is kept and read again after a wait', async () => {
  const t = await Polling.start('cached_read_incomplete', recorded());
  const answers = new Answers();
  answers.answer(0);
  void t.poller.setOpen(pr(1));
  void counted(t, pr(1), answers);
  await t.run();
  expect(answers.runs).toBe(1);
  expect(cachedCount(t)).toBe(0);
  expect(t.events()).toContain('read Counted #1');

  // Nothing it watches changed, but it's read again after the open PR's interval, then waiting
  // longer each time, as a read that failed is.
  await t.runUntil(19);
  expect(answers.runs).toBe(1);
  await t.runUntil(20);
  expect(answers.runs).toBe(2);
  await t.runUntil(59);
  expect(answers.runs).toBe(2);
  answers.answer(4);
  await t.runUntil(60);
  expect(answers.runs).toBe(3);
  expect(cachedCount(t)).toBe(4);
  // Complete, it waits for its watched fields or the 5-minute refresh.
  await t.runUntil(359);
  expect(answers.runs).toBe(3);
});

test('a cached read waits while its pull request isnt open', async () => {
  const t = await Polling.start('cached_read_watched', recorded());
  const answers = new Answers();
  answers.answer(1);
  void counted(t, pr(1), answers);
  await t.run();
  await t.runUntil(200);
  expect(answers.runs).toBe(0);

  void t.poller.setOpen(pr(1));
  await t.run();
  await t.runUntil(201);
  expect(answers.runs).toBe(1);
});

test('a write goes between the requests of a long cached read', async () => {
  const r = recorded();
  const t = await Polling.start('read_yields', [...recorded(), comment(r)], { delay: 1000 });
  let runs = 0;
  void t.poller.setOpen(pr(1));
  // A read of three requests, a second each.
  void t.poller.readCached(pr(1), COUNTED, async (client) => {
    runs += 1;
    for (let request = 0; request < 3; request++) {
      await client.get(pr(1).restPath(), readPullSummary);
    }
    return 1;
  });
  await t.run();
  // The open PR's poll and the repository's, with its rulesets, take the first six seconds; the
  // read starts at 6.
  await t.runUntil(7);
  expect(runs).toBe(1);
  const write = postComment(t.poller);
  await t.run();
  await t.runUntil(13);
  await t.finish(write);

  const requests = t.requests().filter(([secs]) => secs >= 6 && secs <= 9);
  expect(requests).toEqual(
    log(
      [6, 'GET /pulls/1'],
      [7, 'GET /pulls/1'],
      [8, 'POST /issues/1/comments'],
      [9, 'GET /pulls/1'],
    ),
  );
});

/** `stacks_playground`'s recorded StackLayers answer, for PR #1 and #2, and the IDs it asked for. */
function stackLayersAnswer(): { both: Interaction; ids: string[] } {
  const found = cassette('stacks_playground').interactions.find(
    ({ interaction }) => interaction.request.operation === 'StackLayers',
  );
  if (!found) throw new Error('no StackLayers answer');
  const ids = array(found.interaction.request.variables, 'ids').map(String);
  return { both: found.interaction, ids };
}

/** The recorded `StackLayers` answer about PR #2 alone, and the one about both, with their IDs. */
function topAndBoth(): { top: Interaction; both: Interaction; ids: string[] } {
  const { both, ids } = stackLayersAnswer();
  const top = withBody(both, (body) => {
    array(body, 'data', 'nodes').splice(0, 1);
  });
  object(top.request.variables)['ids'] = [ids[1] ?? ''];
  return { top, both, ids };
}

/** When each `StackLayers` request in `requests` was sent. */
function stackLayerReads(requests: readonly Logged[]): number[] {
  return requests.filter(([, what]) => what === 'StackLayers').map(([secs]) => secs);
}

function layerNumbers(t: Polling): number[] | undefined {
  return t.poller.cachedRead(pr(1), STACK_LAYERS)?.value.layers.map((layer) => layer.number);
}

test('stack layers are read after the open prs poll and at once for other layers', async () => {
  const r = recorded();
  const { top, both, ids } = topAndBoth();
  const [, second = ''] = ids;
  const interactions = [at(r, 0), at(r, 6), at(r, 1), at(r, 2), both, top, ...repoAnswers(r)];
  const t = await Polling.start('stack_layers', interactions);
  void t.poller.setOpen(pr(1));
  const atOnce = t.poller.stackLayers(pr(1), [second]);
  await t.run();
  expect(await atOnce).toBeUndefined();
  expect(stackLayerReads(t.requests())).toEqual([0]);
  expect(t.events()).toContain('read StackLayers #1');
  expect(layerNumbers(t)).toEqual([2]);

  // Asking about the same layer again reads nothing new, while the open PR's check doesn't change.
  let held = t.poller.stackLayers(pr(1), [second]);
  await t.run();
  expect((await held)?.value.layers.map((layer) => layer.number)).toEqual([2]);
  await t.runUntil(60);
  expect(stackLayerReads(t.requests())).toEqual([]);

  // Asking about a layer it doesn't read gives what it holds, and reads both at once.
  held = t.poller.stackLayers(pr(1), ids);
  await t.run();
  expect((await held)?.value.ids).toEqual(ids.slice(1));
  expect(stackLayerReads(t.requests())).toEqual([60]);
  const layers = t.poller.cachedRead(pr(1), STACK_LAYERS)?.value;
  expect([layers?.ids, layerNumbers(t)]).toEqual([ids, [1, 2]]);

  // Another tree asking about one of them, or both in another order, shares that read.
  void t.poller.stackLayers(pr(1), [second]);
  await t.run();
  void t.poller.stackLayers(pr(1), ids.toReversed());
  await t.run();
  await t.runUntil(120);
  expect(stackLayerReads(t.requests())).toEqual([]);
});

test('asking about other layers while they are read reads them again', async () => {
  const { top, both, ids } = topAndBoth();
  const [, second = ''] = ids;
  const t = await Polling.start('stack_layers_in_flight', [...recorded(), both, top], {
    delay: 1000,
  });
  void t.poller.setOpen(pr(1));
  void t.poller.stackLayers(pr(1), [second]);
  await t.run();
  // The open PR's poll and the repository's, with its rulesets, take the first six seconds; PR
  // #2's layer is read from 6 to 7.
  await t.runUntil(6);
  expect(stackLayerReads(t.requests())).toEqual([6]);
  void t.poller.stackLayers(pr(1), ids);
  await t.run();
  await t.runUntil(10);
  // The answer about PR #2 alone isn't taken as the answer about both.
  expect(stackLayerReads(t.requests())).toEqual([7]);
  expect(t.poller.cachedRead(pr(1), STACK_LAYERS)?.value.ids).toEqual(ids);
  await t.runUntil(60);
  expect(stackLayerReads(t.requests())).toEqual([]);
});

test('writes to another layer read the layers again once a burst is over', async () => {
  const r = recorded();
  const { both, ids } = stackLayersAnswer();
  const t = await Polling.start('stack_layers_written', [
    ...recorded(),
    both,
    comment(r),
    commentOn(r, 2),
  ]);
  void t.poller.setOpen(pr(1));
  void t.poller.stackLayers(pr(1), ids);
  await t.run();
  await t.runUntil(30);
  expect(stackLayerReads(t.requests())).toEqual([0]);

  // Writes to the open PR, such as viewed marks, aren't read back: its tab holds them.
  const write = postComment(t.poller);
  await t.run();
  await t.runUntil(40);
  await t.finish(write);
  expect(stackLayerReads(t.requests())).toEqual([]);

  // Three comments on PR #2, the layer above, a second apart: one read, two seconds after the
  // last.
  for (let n = 0; n < 3; n++) {
    const onTwo = postCommentOn(t.poller, 2);
    await t.run();
    await t.runUntil(t.now() + 1);
    await t.finish(onTwo);
  }
  await t.runUntil(50);
  expect(stackLayerReads(t.requests())).toEqual([44]);
});
