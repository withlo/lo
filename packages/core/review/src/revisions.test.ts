import { expect, test } from 'vitest';

import { buildRevisions } from './revisions/build.ts';
import { wasPushed, type PushRecord, type Revisions } from './revisions.ts';

function polled(head: string, minute: number): PushRecord {
  return { kind: 'polled', head, at: (1_790_000_000 + minute * 60) * 1000 };
}

/** Revisions `a1` and `a2` over the current commits `c1 a1 c3 c4 a2`, and `x1`, rebased away. */
function revisions(): Revisions {
  return buildRevisions(
    [polled('x1', 1), polled('a1', 10), polled('a2', 20)],
    ['c1', 'a1', 'c3', 'c4', 'a2'],
    'a2',
    0,
  );
}

function found(list: Revisions, commit: string): string | undefined {
  return list.find(commit)?.head;
}

/** `minute` minutes after the Unix epoch, in milliseconds. */
function at(minute: number): number {
  return minute * 60 * 1000;
}

test('revisions start out available', () => {
  expect([...revisions()].every((revision) => revision.available)).toBe(true);
});

test('the caller flags a revision github no longer has', () => {
  const flagged = revisions();

  expect(flagged.markUnavailable('x1')).toBe(true);
  expect(flagged.get('x1')?.available).toBe(false);
  expect(flagged.get('a1')?.available).toBe(true);
  expect(flagged.markUnavailable('ffff')).toBe(false);
});

test('a marker on a head finds its revision', () => {
  expect(found(revisions(), 'a1')).toBe('a1');
  expect(found(revisions(), 'x1')).toBe('x1');
});

test('only pushes are numbered', () => {
  // a2 came in a3's push, and a review through the API was made on it.
  const pushed = (before: string | undefined, after: string, minute: number): PushRecord => ({
    kind: 'activity',
    before,
    after,
    at: at(minute),
    forced: false,
  });
  const numbered = buildRevisions(
    [
      pushed(undefined, 'a1', 10),
      pushed('a1', 'a3', 30),
      { kind: 'reviewedCommit', commit: 'a2', at: at(40) },
    ],
    ['a1', 'a2', 'a3'],
    'a3',
    at(0),
  );

  const labels = [...numbered].map((revision) => [
    wasPushed(revision),
    numbered.label(revision.head),
  ]);
  expect(labels).toEqual([
    [true, 'r1'],
    [false, undefined],
    [true, 'r2'],
  ]);
  expect(numbered.number('a3')).toBe(2);
  expect(numbered.number('ffff')).toBeUndefined();
});

test('a marker on a commit no revision has finds nothing', () => {
  expect(found(revisions(), 'c1')).toBeUndefined();
  expect(found(revisions(), 'c3')).toBeUndefined();
  expect(found(revisions(), 'ffff')).toBeUndefined();
});
