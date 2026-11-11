/**
 * Revisions and comparisons for whole pull requests, from push records as GitHub's APIs and Lo's
 * poller report them, modeled on real pull requests. SHAs are shortened to 8 characters.
 */

import { expect, test } from 'vitest';

import { buildRevisions } from '../src/revisions/build.ts';
import { defaultComparison, type Comparison } from '../src/revisions/compare.ts';
import { viewedFileComparison } from '../src/revisions/viewed.ts';
import type { PushRecord, Revisions } from '../src/revisions.ts';

/** GitHub's SHA for "no commit", the `before` of a push that creates a branch. */
const NO_COMMIT = '0000000000000000000000000000000000000000';

/** A UTC time as GitHub writes it, such as `2026-10-19T09:30:40Z`. */
function time(iso: string): number {
  return Date.parse(iso);
}

function activity(before: string, after: string, at: string, forced: boolean): PushRecord {
  return { kind: 'activity', before, after, at: time(at), forced };
}

function forcePush(before: string, after: string, at: string): PushRecord {
  return { kind: 'forcePush', before, after, at: time(at) };
}

function checkSuite(previous: string, next: string, at: string): PushRecord {
  return { kind: 'checkSuite', previous, next, at: time(at) };
}

function review(commit: string, at: string): PushRecord {
  return { kind: 'review', commit, at: time(at) };
}

function polled(head: string, at: string): PushRecord {
  return { kind: 'polled', head, at: time(at) };
}

function heads(revisions: Revisions): string[] {
  return [...revisions].map((revision) => revision.head);
}

function previousOf(revisions: Revisions): (string | undefined)[] {
  return [...revisions].map((revision) => revision.previous);
}

function forcedOf(revisions: Revisions): (boolean | undefined)[] {
  return [...revisions].map((revision) => revision.forced);
}

function between(from: string, to: string): Comparison {
  return { kind: 'between', from, to };
}

// Normal pushes only: six pushes to a branch in the base repository, each starting CI. The current
// commits hold every head.

const NORMAL_OPENED = '2026-10-02T15:06:30Z';

const NORMAL_HEADS = ['3f2a9c1e', '8b7d4e20', 'c41f6a93', '1e9b0d57', 'a6c3e8f1', '57d2b4c0'];
const [N1 = '', N2 = '', N3 = '', N4 = '', N5 = '', N6 = ''] = NORMAL_HEADS;

function normalCommits(): string[] {
  return ['0a1b2c3d', N1, '4e5f6a7b', N2, N3, '9c8d7e6f', '2b3c4d5e', N4, '6f7a8b9c', N5, N6];
}

test('normal pushes from the activity api', () => {
  const records = [
    activity(NO_COMMIT, N1, '2026-10-02T15:04:11Z', false),
    checkSuite(NO_COMMIT, N1, '2026-10-02T15:04:19Z'),
    activity(N1, N2, '2026-10-02T17:40:52Z', false),
    checkSuite(N1, N2, '2026-10-02T17:41:03Z'),
    activity(N2, N3, '2026-10-03T09:12:30Z', false),
    checkSuite(N2, N3, '2026-10-03T09:12:37Z'),
    activity(N3, N4, '2026-10-05T11:58:02Z', false),
    checkSuite(N3, N4, '2026-10-05T11:58:44Z'),
    activity(N4, N5, '2026-10-06T08:21:45Z', false),
    checkSuite(N4, N5, '2026-10-06T08:21:51Z'),
    polled(N5, '2026-10-06T08:22:30Z'),
    activity(N5, N6, '2026-10-06T14:07:19Z', false),
    checkSuite(N5, N6, '2026-10-06T14:07:26Z'),
    polled(N6, '2026-10-06T14:08:00Z'),
  ];
  const revisions = buildRevisions(records, normalCommits(), N6, time(NORMAL_OPENED));

  expect(heads(revisions)).toEqual(NORMAL_HEADS);
  expect(previousOf(revisions)).toEqual([undefined, N1, N2, N3, N4, N5]);
  expect(forcedOf(revisions)).toEqual([undefined, false, false, false, false, false]);
  expect(revisions.list()[3]?.pushedAt).toEqual({
    kind: 'exact',
    at: time('2026-10-05T11:58:02Z'),
  });
  expect(revisions.latest()?.sources).toEqual(['activity', 'checkSuite', 'poller', 'head']);
  expect(revisions.label(N4)).toBe('r4');
});

test('normal pushes from check suites when the activity api is unavailable', () => {
  // Listed in the order GitHub returns them: by commit, not by time.
  const records = [
    checkSuite(N5, N6, '2026-10-06T14:07:26Z'),
    checkSuite(N3, N4, '2026-10-05T11:58:44Z'),
    checkSuite(NO_COMMIT, N1, '2026-10-02T15:04:19Z'),
    checkSuite(N4, N5, '2026-10-06T08:21:51Z'),
    checkSuite(N1, N2, '2026-10-02T17:41:03Z'),
    checkSuite(N2, N3, '2026-10-03T09:12:37Z'),
  ];
  const revisions = buildRevisions(records, normalCommits(), N6, time(NORMAL_OPENED));

  expect(heads(revisions)).toEqual(NORMAL_HEADS);
  expect(previousOf(revisions)).toEqual([undefined, N1, N2, N3, N4, N5]);
  expect(forcedOf(revisions)).toEqual([undefined, false, false, false, false, false]);
  expect(revisions.get(N4)?.pushedAt).toEqual({ kind: 'by', at: time('2026-10-05T11:58:44Z') });
});

// Force-pushes: a branch opened, force-pushed, pushed once normally, then force-pushed twice; the
// last is GitHub rebasing the branch after retargeting the pull request. Modeled on cli/cli#14745.

const FORCE_PUSH_OPENED = '2026-10-19T09:35:48Z';

const R1 = 'ca3cb242';
const R2 = 'a842bc7a';
const R3 = 'aae5f981';
const R4 = '17e9abeb';
const R5 = '21660dd7';

/** The current commits: the rebase replaced every earlier head. */
function rebasedCommits(): string[] {
  return ['9e1b2c3d', '4f5a6b7c', R5];
}

function forcePushActivity(): PushRecord[] {
  return [
    activity(NO_COMMIT, R1, '2026-10-19T09:30:40Z', false),
    activity(R1, R2, '2026-10-19T12:37:13Z', true),
    activity(R2, R3, '2026-10-19T12:52:34Z', false),
    activity(R3, R4, '2026-10-21T09:34:20Z', true),
    activity(R4, R5, '2026-10-21T11:45:24Z', true),
  ];
}

/**
 * The timeline and check suites: force-push events a few seconds after each force-push, reviews
 * on r1, r2 and r3, and the one check suite whose push the head repository started.
 */
function forcePushTimeline(): PushRecord[] {
  return [
    review(R1, '2026-10-19T10:12:05Z'),
    forcePush(R1, R2, '2026-10-19T12:37:15Z'),
    review(R2, '2026-10-19T12:45:30Z'),
    checkSuite(R2, R3, '2026-10-19T12:52:51Z'),
    review(R3, '2026-10-19T13:05:47Z'),
    forcePush(R3, R4, '2026-10-21T09:34:22Z'),
    forcePush(R4, R5, '2026-10-21T11:45:26Z'),
    polled(R5, '2026-11-06T10:00:00Z'),
  ];
}

function forcePushRevisions(records: PushRecord[]): Revisions {
  return buildRevisions(records, rebasedCommits(), R5, time(FORCE_PUSH_OPENED));
}

test('force pushes from every source', () => {
  const revisions = forcePushRevisions([...forcePushActivity(), ...forcePushTimeline()]);

  expect(heads(revisions)).toEqual([R1, R2, R3, R4, R5]);
  expect(previousOf(revisions)).toEqual([undefined, R1, R2, R3, R4]);
  expect(forcedOf(revisions)).toEqual([undefined, true, false, true, true]);
  expect(revisions.get(R2)?.pushedAt).toEqual({ kind: 'exact', at: time('2026-10-19T12:37:13Z') });
  expect(revisions.get(R3)?.sources).toEqual(['activity', 'forcePush', 'review', 'checkSuite']);
});

test('force pushes without the activity api', () => {
  const revisions = forcePushRevisions(forcePushTimeline());

  expect(heads(revisions)).toEqual([R1, R2, R3, R4, R5]);
  expect(previousOf(revisions)).toEqual([undefined, R1, R2, R3, R4]);
  // Nothing says r1 and r3 weren't forced, and the rebase took both out of the current commits.
  expect(forcedOf(revisions)).toEqual([undefined, true, undefined, true, true]);
  expect(revisions.get(R1)?.pushedAt).toEqual({ kind: 'by', at: time('2026-10-19T10:12:05Z') });
  expect(revisions.get(R3)?.pushedAt).toEqual({ kind: 'by', at: time('2026-10-19T12:52:51Z') });
});

test('a normal push only a force push event saw', () => {
  // Without the review or the check suite, r3 is only the head the second force-push replaced.
  const revisions = forcePushRevisions([
    forcePush(R1, R2, '2026-10-19T12:37:15Z'),
    forcePush(R3, R4, '2026-10-21T09:34:22Z'),
    forcePush(R4, R5, '2026-10-21T11:45:26Z'),
    polled(R5, '2026-11-06T10:00:00Z'),
  ]);

  expect(heads(revisions)).toEqual([R1, R2, R3, R4, R5]);
  const r3 = revisions.get(R3);
  expect(r3?.pushedAt).toEqual({ kind: 'by', at: time('2026-10-21T09:34:22Z') });
  expect(r3?.sources).toEqual(['forcePush']);
  expect(r3?.previous).toBe(R2);
});

test('a review on a commit since force pushed away', () => {
  const revisions = forcePushRevisions([...forcePushActivity(), ...forcePushTimeline()]);

  // You approved r3; the author has force-pushed twice since.
  expect(defaultComparison(revisions, R3, undefined)).toEqual(between(R3, R5));
  // You've seen r5 here since, without reviewing it again.
  expect(defaultComparison(revisions, R3, R5)).toEqual({ kind: 'full', nothingNewSince: R5 });
  // A file you marked viewed at r2 on this computer, and one marked viewed elsewhere.
  expect(viewedFileComparison(revisions, 'DISMISSED', R2, R3)).toEqual({
    kind: 'sinceViewed',
    from: R2,
    to: R5,
  });
  expect(viewedFileComparison(revisions, 'DISMISSED', undefined, R3)).toEqual({
    kind: 'sinceLastReview',
    from: R3,
    to: R5,
  });
  expect(viewedFileComparison(revisions, 'VIEWED', undefined, R3)).toBeUndefined();

  // GitHub no longer has r3, and Lo never fetched it.
  expect(revisions.markUnavailable(R3)).toBe(true);
  expect(heads(revisions)).toEqual([R1, R2, R3, R4, R5]);
  expect(defaultComparison(revisions, R3, undefined)).toEqual(between(R2, R5));
});

// Pushes before the pull request opened: the author pushed a branch three times, each starting CI,
// then opened the pull request and pushed twice more. The check suites on the current commits
// include the three pushes from before the pull request existed.

const EARLY = ['2c4e6a8b', '3d5f7b9c', '4e6a8c0d', '5f7b9d1e', '6a8c0e2f'];

test('pushes before the pull request opened', () => {
  const [E1 = '', E2 = '', E3 = '', P1 = '', P2 = ''] = EARLY;
  const records = [
    checkSuite(NO_COMMIT, E1, '2026-11-02T09:01:12Z'),
    checkSuite(E1, E2, '2026-11-02T09:40:31Z'),
    checkSuite(E2, E3, '2026-11-02T10:15:09Z'),
    polled(E3, '2026-11-02T10:20:00Z'),
    checkSuite(E3, P1, '2026-11-02T14:03:44Z'),
    checkSuite(P1, P2, '2026-11-03T08:47:20Z'),
  ];
  const revisions = buildRevisions(records, EARLY, P2, time('2026-11-02T10:18:02Z'));

  expect(heads(revisions)).toEqual([E3, P1, P2]);
  expect(previousOf(revisions)).toEqual([E2, E3, P1]);
  expect(forcedOf(revisions)).toEqual([false, false, false]);
});

// A review submitted after a force-push, on a head that push replaced, on a fork pull request with
// no activity log and no check suites. The author pushed X and then Y, both unseen, then
// force-pushed Z over Y; Lo first saw the pull request at Z. A review started on X was submitted
// after that.

const X = '5e4d3c2b';
const Y = '9a8b7c6d';
const Z = 'c0ffee12';

test('a review submitted after a force push on a head it replaced', () => {
  const records = [
    forcePush(Y, Z, '2026-10-30T16:02:41Z'),
    polled(Z, '2026-10-30T16:10:00Z'),
    review(X, '2026-10-30T16:25:18Z'),
  ];
  const revisions = buildRevisions(records, ['7b6a5948', Z], Z, time('2026-10-29T11:00:00Z'));

  expect(revisions.latest()?.head).toBe(Z);
  expect(defaultComparison(revisions, X, undefined)).toEqual(between(X, Z));
  expect(viewedFileComparison(revisions, 'DISMISSED', Y, X)).toEqual({
    kind: 'sinceViewed',
    from: Y,
    to: Z,
  });
});

// A rebase on a fork pull request from before the activity API's history: no activity log and no
// check suites. The author pushed a fix, rebased onto the moved base branch adding a commit, then
// pushed once more.

const OPENED = 'b7e4d2a1';
const FIXED = 'c81f09e3';
const REBASED = 'f4a7b3c2';
const LATEST = '0d9e8f7a';

test('a rebase', () => {
  const records = [
    polled(OPENED, '2022-11-14T16:20:05Z'),
    polled(FIXED, '2022-11-15T10:03:41Z'),
    review(FIXED, '2022-11-15T11:30:12Z'),
    forcePush(FIXED, REBASED, '2022-11-17T09:15:58Z'),
    polled(LATEST, '2022-11-17T14:47:20Z'),
  ];
  const current = ['e1d2c3b4', 'a5b6c7d8', '9f8e7d6c', REBASED, LATEST];
  const revisions = buildRevisions(records, current, LATEST, time('2022-11-14T16:19:40Z'));

  expect(heads(revisions)).toEqual([OPENED, FIXED, REBASED, LATEST]);
  expect(previousOf(revisions)).toEqual([undefined, OPENED, FIXED, REBASED]);
  expect(forcedOf(revisions)).toEqual([undefined, undefined, true, false]);

  // Your review was on the fix, before the rebase.
  expect(defaultComparison(revisions, FIXED, undefined)).toEqual(between(FIXED, LATEST));
  expect(defaultComparison(revisions, FIXED, REBASED)).toEqual(between(REBASED, LATEST));
});

// Pushes only the poller saw: a fork pull request whose fork was deleted and that has no CI and no
// reviews yet, open in Lo throughout.

const POLLED_OPENED = '2026-09-08T08:00:00Z';

const P1 = 'd3c2b1a0';
const P2 = '7a6b5c4d';
const P3 = 'e9f8a7b6';
const P4 = '5c4b3a29';

function polledRecords(): PushRecord[] {
  return [
    polled(P1, '2026-09-08T08:01:30Z'),
    polled(P2, '2026-09-08T09:46:00Z'),
    polled(P3, '2026-09-09T13:12:30Z'),
  ];
}

test('pushes only the poller saw', () => {
  const current = ['1a2b3c4d', P1, '5e6f7a8b', P2, P3];
  const revisions = buildRevisions(polledRecords(), current, P3, time(POLLED_OPENED));

  expect(heads(revisions)).toEqual([P1, P2, P3]);
  expect(previousOf(revisions)).toEqual([undefined, P1, P2]);
  expect(forcedOf(revisions)).toEqual([undefined, false, false]);
  expect(revisions.get(P2)?.pushedAt).toEqual({ kind: 'by', at: time('2026-09-08T09:46:00Z') });
  expect(defaultComparison(revisions, undefined, P2)).toEqual(between(P2, P3));
});

test('a force push only the poller saw', () => {
  const records = [...polledRecords(), polled(P4, '2026-09-10T07:30:00Z')];
  // The author squashed everything into one commit.
  const revisions = buildRevisions(records, [P4], P4, time(POLLED_OPENED));

  expect(heads(revisions)).toEqual([P1, P2, P3, P4]);
  expect(forcedOf(revisions)).toEqual([undefined, undefined, undefined, true]);
});

// Conflicting sources, on a fork pull request without the activity API: a review started on the
// first head and submitted after the force-push, a force-push event three seconds after the push,
// and a check suite for the same commit pushed to a backport branch, which names another previous
// head.

const BEFORE = '6b5a4938';
const AFTER = 'f0e1d2c3';

function conflictingRecords(): PushRecord[] {
  return [
    polled(BEFORE, '2026-10-27T13:40:55Z'),
    review(BEFORE, '2026-10-27T14:05:31Z'),
    forcePush(BEFORE, AFTER, '2026-10-27T14:02:13Z'),
    polled(AFTER, '2026-10-27T14:03:00Z'),
    checkSuite('e5f6a7b8', AFTER, '2026-10-27T14:20:42Z'),
  ];
}

function buildConflicting(records: PushRecord[]): Revisions {
  return buildRevisions(records, ['0f1e2d3c', AFTER], AFTER, time('2026-10-27T13:40:40Z'));
}

test('conflicting sources', () => {
  const revisions = buildConflicting(conflictingRecords());

  expect(heads(revisions)).toEqual([BEFORE, AFTER]);
  const after = revisions.latest();
  expect(after?.previous).toBe(BEFORE);
  expect(after?.forced).toBe(true);
  expect(after?.pushedAt).toEqual({ kind: 'exact', at: time('2026-10-27T14:02:13Z') });
  expect(revisions.get(BEFORE)?.pushedAt).toEqual({
    kind: 'by',
    at: time('2026-10-27T13:40:55Z'),
  });
});

test('conflicting sources place a review submitted after the next push', () => {
  // Without the poller's sighting, the review alone would put the first head after the second.
  const records = conflictingRecords().filter(
    (record) => !(record.kind === 'polled' && record.head === BEFORE),
  );
  const revisions = buildConflicting(records);

  expect(heads(revisions)).toEqual([BEFORE, AFTER]);
  expect(revisions.get(BEFORE)?.pushedAt).toEqual({
    kind: 'by',
    at: time('2026-10-27T14:02:13Z'),
  });
});

test('conflicting sources trust the activity api first', () => {
  const records = [
    ...conflictingRecords(),
    activity(NO_COMMIT, BEFORE, '2026-10-27T13:40:30Z', false),
    activity(BEFORE, AFTER, '2026-10-27T14:02:10Z', true),
  ];
  const revisions = buildConflicting(records);

  expect(heads(revisions)).toEqual([BEFORE, AFTER]);
  expect(revisions.latest()?.pushedAt).toEqual({ kind: 'exact', at: time('2026-10-27T14:02:10Z') });
  expect(revisions.get(BEFORE)?.pushedAt).toEqual({
    kind: 'exact',
    at: time('2026-10-27T13:40:30Z'),
  });
});
