import { expect, test } from 'vitest';

import type { PushRecord, Revision, Revisions } from '../revisions.ts';
import { buildRevisions } from './build.ts';

const NO_COMMIT = '0000000000000000000000000000000000000000';

/** `minute` minutes into a day in 2026, in milliseconds since the Unix epoch. */
function at(minute: number): number {
  return (1_790_000_000 + minute * 60) * 1000;
}

function activity(
  before: string | undefined,
  after: string,
  minute: number,
  forced: boolean,
): PushRecord {
  return { kind: 'activity', before, after, at: at(minute), forced };
}

function forcePush(before: string, after: string, minute: number): PushRecord {
  return { kind: 'forcePush', before, after, at: at(minute) };
}

function checkSuite(previous: string, next: string, minute: number): PushRecord {
  return { kind: 'checkSuite', previous, next, at: at(minute) };
}

function review(commit: string, minute: number): PushRecord {
  return { kind: 'review', commit, at: at(minute) };
}

function polled(head: string, minute: number): PushRecord {
  return { kind: 'polled', head, at: at(minute) };
}

/**
 * The revisions `records` make, over the current commits `commits`, for a pull request whose head
 * is `head`, opened before any of them.
 */
function build(
  records: readonly PushRecord[],
  commits: readonly string[],
  head: string,
): Revisions {
  return opened(records, commits, head, 0);
}

/** The same, for a pull request opened at `minute`. */
function opened(
  records: readonly PushRecord[],
  commits: readonly string[],
  head: string,
  minute: number,
): Revisions {
  return buildRevisions(records, commits, head, at(minute));
}

function heads(revisions: Revisions): string[] {
  return [...revisions].map((revision) => revision.head);
}

function forcedOf(revisions: Revisions): (boolean | undefined)[] {
  return [...revisions].map((revision) => revision.forced);
}

function previousOf(revisions: Revisions, head: string): string | undefined {
  return revisions.get(head)?.previous;
}

test('a reviewed commit that was never pushed is a revision of its own source', () => {
  // a2 came in a3's push, and a review through the API was made on it.
  const revisions = build(
    [
      activity(undefined, 'a1', 10, false),
      activity('a1', 'a3', 30, false),
      { kind: 'reviewedCommit', commit: 'a2', at: at(40) },
    ],
    ['a1', 'a2', 'a3'],
    'a3',
  );

  expect(heads(revisions)).toEqual(['a1', 'a2', 'a3']);
  const a2 = revisions.get('a2');
  expect(a2?.sources).toEqual(['reviewedCommit']);
  expect(a2?.pushedAt).toEqual({ kind: 'by', at: at(30) });
});

test('with no records the head is the only revision', () => {
  const revisions = build([], [], 'a1');

  expect(heads(revisions)).toEqual(['a1']);
  const a1 = revisions.latest();
  expect(a1?.sources).toEqual(['head']);
  expect(a1?.pushedAt).toEqual({ kind: 'unknown' });
});

test('activity pushes become revisions in time order', () => {
  const revisions = build(
    [
      activity('a1', 'a2', 20, false),
      activity(undefined, 'a1', 10, false),
      activity('a2', 'b1', 30, true),
    ],
    [],
    'b1',
  );

  expect(revisions.list()).toEqual([
    {
      head: 'a1',
      previous: undefined,
      forced: undefined,
      pushedAt: { kind: 'exact', at: at(10) },
      sources: ['activity'],
      available: true,
    },
    {
      head: 'a2',
      previous: 'a1',
      forced: false,
      pushedAt: { kind: 'exact', at: at(20) },
      sources: ['activity'],
      available: true,
    },
    {
      head: 'b1',
      previous: 'a2',
      forced: true,
      pushedAt: { kind: 'exact', at: at(30) },
      sources: ['activity', 'head'],
      available: true,
    },
  ] satisfies Revision[]);
});

test('the all zero sha of a new branch is no previous head', () => {
  const revisions = build([activity(NO_COMMIT, 'a1', 10, false)], [], 'a1');

  expect(revisions.list()[0]?.previous).toBeUndefined();
});

test('a head every source saw is one revision', () => {
  const revisions = build(
    [
      polled('b1', 33),
      checkSuite('a1', 'b1', 31),
      forcePush('a1', 'b1', 30),
      review('b1', 50),
      activity('a1', 'b1', 29, true),
      activity(undefined, 'a1', 10, false),
    ],
    [],
    'b1',
  );

  expect(heads(revisions)).toEqual(['a1', 'b1']);
  expect(revisions.get('b1')).toEqual({
    head: 'b1',
    previous: 'a1',
    forced: true,
    pushedAt: { kind: 'exact', at: at(29) },
    sources: ['activity', 'forcePush', 'review', 'checkSuite', 'poller', 'head'],
    available: true,
  } satisfies Revision);
});

test('a force push event dates a head the activity api missed', () => {
  const revisions = build([forcePush('a1', 'b1', 30)], [], 'b1');

  expect(revisions.get('b1')).toEqual({
    head: 'b1',
    previous: 'a1',
    forced: true,
    pushedAt: { kind: 'exact', at: at(30) },
    sources: ['forcePush', 'head'],
    available: true,
  } satisfies Revision);
});

test('reviews check suites and the poller date a head by its first sighting', () => {
  const revisions = build(
    [review('a1', 40), polled('a1', 12), checkSuite(NO_COMMIT, 'a1', 11)],
    [],
    'a1',
  );

  const a1 = revisions.get('a1');
  expect(a1?.pushedAt).toEqual({ kind: 'by', at: at(11) });
  expect(a1?.previous).toBeUndefined();
  expect(a1?.forced).toBeUndefined();
});

test('the activity api names the previous head over other sources', () => {
  const revisions = build(
    [
      polled('x9', 1),
      checkSuite('x9', 'b1', 31),
      forcePush('y9', 'b1', 30),
      activity('a1', 'b1', 29, true),
    ],
    [],
    'b1',
  );

  expect(previousOf(revisions, 'b1')).toBe('a1');
});

test('a force push event names the previous head over a check suite', () => {
  const revisions = build(
    [polled('x9', 1), checkSuite('x9', 'b1', 31), forcePush('a1', 'b1', 30)],
    [],
    'b1',
  );

  expect(previousOf(revisions, 'b1')).toBe('a1');
});

test('a check suite names the previous head when nothing else does', () => {
  const revisions = build([polled('a1', 5), checkSuite('a1', 'a2', 21)], [], 'a2');

  expect(previousOf(revisions, 'a2')).toBe('a1');
});

test('a check suite from another branch names no previous head', () => {
  // a2 was later pushed to a backport branch whose head was e5f6.
  const revisions = build(
    [checkSuite(NO_COMMIT, 'a1', 10), checkSuite('a1', 'a2', 21), checkSuite('e5f6', 'a2', 50)],
    ['a1', 'a2'],
    'a2',
  );

  const a2 = revisions.get('a2');
  expect(a2?.previous).toBe('a1');
  expect(a2?.forced).toBe(false);
});

test('a check suite naming an unknown head leaves the revision before', () => {
  const revisions = build([polled('a1', 5), checkSuite('e5f6', 'a2', 20)], [], 'a2');

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  expect(previousOf(revisions, 'a2')).toBe('a1');
});

test('the earliest check suite naming a known head names the previous head', () => {
  const revisions = build(
    [polled('a0', 1), polled('a1', 5), checkSuite('a0', 'a2', 30), checkSuite('a1', 'a2', 21)],
    [],
    'a2',
  );

  expect(previousOf(revisions, 'a2')).toBe('a1');
});

test('a revision no source gives a previous head follows the one before it', () => {
  const revisions = build([polled('a1', 5), polled('a2', 25), polled('a3', 45)], [], 'a3');

  expect(heads(revisions)).toEqual(['a1', 'a2', 'a3']);
  expect([...revisions].map((revision) => revision.previous)).toEqual([undefined, 'a1', 'a2']);
  expect(forcedOf(revisions).every((push) => push === undefined)).toBe(true);
});

test('a reviews commit is a revision even between pushes', () => {
  // a2's push brought in c2 too; the API made a review on c2.
  const revisions = build(
    [activity(undefined, 'a1', 10, false), activity('a1', 'a2', 20, false), review('c2', 35)],
    ['a1', 'c2', 'a2'],
    'a2',
  );

  expect(heads(revisions)).toEqual(['a1', 'c2', 'a2']);
  expect(previousOf(revisions, 'a2')).toBe('a1');
});

test('a head pushed twice is one revision at its latest push', () => {
  const revisions = build(
    [
      activity(undefined, 'a1', 10, false),
      activity('a1', 'b1', 20, true),
      activity('b1', 'a1', 30, true),
    ],
    [],
    'a1',
  );

  expect(heads(revisions)).toEqual(['b1', 'a1']);
  const a1 = revisions.latest();
  expect(a1?.previous).toBe('b1');
  expect(a1?.forced).toBe(true);
  expect(a1?.pushedAt).toEqual({ kind: 'exact', at: at(30) });
});

test('a force pushed over head comes just before the force push', () => {
  const revisions = build(
    [polled('a1', 5), forcePush('a2', 'b1', 50), polled('a0', 1), polled('b2', 60)],
    [],
    'b2',
  );

  expect(heads(revisions)).toEqual(['a0', 'a1', 'a2', 'b1', 'b2']);
  const a2 = revisions.get('a2');
  expect(a2?.pushedAt).toEqual({ kind: 'by', at: at(50) });
  expect(a2?.sources).toEqual(['forcePush']);
  expect(a2?.previous).toBe('a1');
});

test('the push chain orders heads whose check suites started out of order', () => {
  // a1's suite started a minute after a2's: CI was slow to pick up the first push.
  const revisions = build([checkSuite('a1', 'a2', 11), checkSuite(NO_COMMIT, 'a1', 12)], [], 'a2');

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  expect(revisions.get('a1')?.pushedAt).toEqual({ kind: 'by', at: at(11) });
});

test('ancestry places a review submitted after the next push', () => {
  // A review started on a1 and submitted after a2 was pushed is on a1.
  const revisions = build([polled('a2', 20), review('a1', 30)], ['c0', 'a1', 'c2', 'a2'], 'a2');

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  expect(revisions.get('a1')?.pushedAt).toEqual({ kind: 'by', at: at(20) });
});

test('a head pushed back to stays at its latest push though it is an ancestor', () => {
  // a2 descends from a1, and a3 from a2. The author reset the branch to a1, then pushed a3.
  const revisions = build(
    [
      activity(undefined, 'a1', 10, false),
      activity('a1', 'a2', 20, false),
      activity('a2', 'a1', 30, true),
      activity('a1', 'a3', 40, false),
    ],
    ['a1', 'a2', 'a3'],
    'a3',
  );

  expect(heads(revisions)).toEqual(['a2', 'a1', 'a3']);
});

test('the head is a revision even when no source saw it', () => {
  const revisions = build([polled('a1', 5)], ['a1', 'a2'], 'a2');

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  const a2 = revisions.latest();
  expect(a2?.sources).toEqual(['head']);
  expect(a2?.pushedAt).toEqual({ kind: 'unknown' });
  expect(a2?.previous).toBe('a1');
});

test('the head joins the revision the poller saw', () => {
  const revisions = build([polled('a1', 5), polled('a2', 25)], ['a1', 'a2'], 'a2');

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  expect(revisions.latest()?.sources).toEqual(['poller', 'head']);
});

test('the head is latest though a review on a replaced head came later', () => {
  // x1 was pushed, then y1, which a force-push replaced with z1. A review on x1 was submitted
  // after the force-push.
  const revisions = build(
    [forcePush('y1', 'z1', 30), polled('z1', 31), review('x1', 40)],
    ['z0', 'z1'],
    'z1',
  );

  expect(heads(revisions)).toEqual(['y1', 'x1', 'z1']);
});

test('the head is latest after a revert only the poller saw', () => {
  // b1 descends from a1; the author reset the branch back to a1.
  const revisions = build(
    [polled('a1', 10), checkSuite('a1', 'b1', 20), polled('b1', 21), polled('a1', 30)],
    ['a0', 'a1'],
    'a1',
  );

  expect(heads(revisions)).toEqual(['b1', 'a1']);
});

test('the head is latest when the pollers clock runs ahead', () => {
  // This computer's clock is ten minutes fast: a1 and a2 were pushed at 5 and 6.
  const revisions = build(
    [polled('a1', 15), polled('a2', 16), forcePush('a2', 'b1', 7)],
    ['b0', 'b1'],
    'b1',
  );

  expect(heads(revisions)).toEqual(['a1', 'a2', 'b1']);
});

test('the head is latest when the current commits stop short', () => {
  // The caller passed the first 250 commits, where GitHub's commit list stops.
  const commits = Array.from({ length: 250 }, (_, index) => `c${index + 1}`);
  const revisions = build([polled('c100', 10), polled('c293', 50)], commits, 'c293');

  expect(heads(revisions)).toEqual(['c100', 'c293']);
});

test('heads rebased away come before the latest force push', () => {
  // x1 was pushed, then y1, which a force-push replaced with a1; a2 and a3 followed. A review on
  // x1 was submitted after a2 was pushed.
  const revisions = build(
    [forcePush('y1', 'a1', 20), review('x1', 35), polled('a3', 40)],
    ['a1', 'a2', 'a3'],
    'a3',
  );

  expect(heads(revisions)).toEqual(['y1', 'x1', 'a1', 'a3']);
  const a3 = revisions.latest();
  expect(a3?.previous).toBe('a1');
  expect(a3?.forced).toBe(false);
});

test('pushes before the pull request opened are not revisions', () => {
  // p1 and p2 were pushed before the pull request opened at p2; p3 came after.
  const revisions = opened(
    [
      checkSuite(NO_COMMIT, 'p1', 0),
      checkSuite('p1', 'p2', 20),
      checkSuite('p2', 'p3', 60),
      polled('p2', 31),
    ],
    ['p1', 'p2', 'p3'],
    'p3',
    30,
  );

  expect(heads(revisions)).toEqual(['p2', 'p3']);
  expect(previousOf(revisions, 'p2')).toBe('p1');
});

test('the whole activity log starts at the head when the pull request opened', () => {
  const revisions = opened(
    [
      activity(undefined, 'x0', 5, false),
      activity('x0', 'a1', 10, false),
      activity('a1', 'a2', 20, false),
    ],
    ['x0', 'a1', 'a2'],
    'a2',
    12,
  );

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  expect(previousOf(revisions, 'a1')).toBe('x0');
});

test('with nothing dated before the pull request opened every head stays', () => {
  const revisions = opened([forcePush('a1', 'b1', 50), polled('b1', 51)], ['b1'], 'b1', 30);

  expect(heads(revisions)).toEqual(['a1', 'b1']);
});

test('a check suites previous head in the current commits is a revision', () => {
  // No other source saw a2, which only the next push's check suite names.
  const revisions = build([polled('a1', 5), checkSuite('a2', 'a3', 30)], ['a1', 'a2', 'a3'], 'a3');

  expect(heads(revisions)).toEqual(['a1', 'a2', 'a3']);
  const a2 = revisions.get('a2');
  expect(a2?.sources).toEqual(['checkSuite']);
  expect(a2?.pushedAt).toEqual({ kind: 'by', at: at(30) });
});

test('a push from an ancestor was not forced', () => {
  const revisions = build([polled('a1', 5), polled('a2', 25)], ['a1', 'c2', 'a2'], 'a2');

  expect(forcedOf(revisions)).toEqual([undefined, false]);
});

test('a push over a revision rebased away was forced', () => {
  const revisions = build([polled('a1', 5), polled('b1', 25)], ['b0', 'b1'], 'b1');

  expect(heads(revisions)).toEqual(['a1', 'b1']);
  expect(forcedOf(revisions)).toEqual([undefined, true]);
});

test('a push back to an ancestor was forced', () => {
  // The author reset the branch from a2 to a1, then pushed a3 on top of a2 again.
  const revisions = build(
    [polled('a2', 10), checkSuite('a2', 'a1', 20), polled('a3', 30)],
    ['a1', 'a2', 'a3'],
    'a3',
  );

  expect(heads(revisions)).toEqual(['a2', 'a1', 'a3']);
  expect(forcedOf(revisions)).toEqual([undefined, true, false]);
});

test('a push back to an ancestor is ordered the same whatever the record order', () => {
  const records = [polled('a2', 10), checkSuite('a2', 'a1', 20), polled('a3', 30)];
  const [first, second, third] = records;
  const suiteFirst = [second, first, third].filter((record) => record !== undefined);

  for (const order of [records, records.toReversed(), suiteFirst]) {
    const revisions = build(order, ['a1', 'a2', 'a3'], 'a3');

    expect(heads(revisions)).toEqual(['a2', 'a1', 'a3']);
    expect(forcedOf(revisions)).toEqual([undefined, true, false]);
  }
});

test('heads pushed back and forth go by their own times whatever the record order', () => {
  // a1 was pushed over by b1, then pushed back to; only check suites saw it.
  const records = [checkSuite('a1', 'b1', 20), checkSuite('b1', 'a1', 30), polled('c1', 40)];

  for (const order of [records, records.toReversed()]) {
    expect(heads(build(order, [], 'c1'))).toEqual(['b1', 'a1', 'c1']);
  }
});

test('forced is unknown when neither head is in the current commits', () => {
  const revisions = build([polled('a1', 5), polled('a2', 25)], ['b1'], 'b1');

  expect(heads(revisions)).toEqual(['a1', 'a2', 'b1']);
  expect(forcedOf(revisions)[1]).toBeUndefined();
});

test('forced is unknown when the previous head is no revision', () => {
  // x0 was the branch's head before the pull request opened, and was force-pushed over.
  const revisions = build([checkSuite('x0', 'a1', 10)], ['a1'], 'a1');

  expect(forcedOf(revisions)).toEqual([undefined]);
});

test('a source saying whether the push was forced wins over ancestry', () => {
  const revisions = build(
    [activity(undefined, 'a1', 10, false), activity('a1', 'a2', 20, true)],
    ['a1', 'a2'],
    'a2',
  );

  expect(forcedOf(revisions)).toEqual([undefined, true]);
});

test('a branch recreated over an unrelated head was forced', () => {
  // The branch was deleted at a2 and created again at b1.
  const revisions = build(
    [
      activity(undefined, 'a1', 10, false),
      activity('a1', 'a2', 20, false),
      activity(NO_COMMIT, 'b1', 40, false),
    ],
    ['b0', 'b1'],
    'b1',
  );

  const b1 = revisions.latest();
  expect(b1?.previous).toBe('a2');
  expect(b1?.forced).toBe(true);
});

test('a branch recreated at a descendant was not forced', () => {
  const revisions = build(
    [
      activity(undefined, 'a1', 10, false),
      activity('a1', 'a2', 20, false),
      activity(undefined, 'a3', 40, false),
    ],
    ['a1', 'a2', 'a3'],
    'a3',
  );

  expect(forcedOf(revisions)).toEqual([undefined, false, false]);
});

test('a branch recreated with no ancestry to go on counts as forced', () => {
  const revisions = build(
    [activity(undefined, 'a1', 10, false), activity(undefined, 'b1', 40, false)],
    [],
    'b1',
  );

  expect(forcedOf(revisions)).toEqual([undefined, true]);
});

test('a branch restored at its head is one revision', () => {
  const revisions = build(
    [
      activity(undefined, 'a1', 10, false),
      activity('a1', 'a2', 20, false),
      activity(undefined, 'a2', 40, false),
    ],
    ['a1', 'a2'],
    'a2',
  );

  expect(heads(revisions)).toEqual(['a1', 'a2']);
  expect(forcedOf(revisions)).toEqual([undefined, false]);
});

test('revisions are numbered from r1 for display', () => {
  const revisions = build(
    [activity(undefined, 'a1', 10, false), activity('a1', 'a2', 20, false)],
    [],
    'a2',
  );

  expect(revisions.number('a1')).toBe(1);
  expect(revisions.label('a2')).toBe('r2');
  expect(revisions.number('ffff')).toBeUndefined();
  expect(revisions.label('ffff')).toBeUndefined();
  expect(revisions.latest()?.head).toBe('a2');
});
