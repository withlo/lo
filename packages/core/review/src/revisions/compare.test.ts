import { expect, test } from 'vitest';

import { Revisions, type PushRecord } from '../revisions.ts';
import { buildRevisions } from './build.ts';
import { defaultComparison, type Comparison } from './compare.ts';

/** `minute` minutes into a day in 2026, in milliseconds since the Unix epoch. */
function at(minute: number): number {
  return (1_790_000_000 + minute * 60) * 1000;
}

function pushed(before: string | undefined, after: string, minute: number): PushRecord {
  return { kind: 'activity', before, after, at: at(minute), forced: false };
}

/** r1 to r4, heads `a1` to `a4`, over the current commits `a1 c2 a2 a3 a4`, with `more` records. */
function revisions(more: PushRecord[] = []): Revisions {
  return buildRevisions(
    [
      pushed(undefined, 'a1', 10),
      pushed('a1', 'a2', 20),
      pushed('a2', 'a3', 30),
      pushed('a3', 'a4', 40),
      ...more,
    ],
    ['a1', 'c2', 'a2', 'a3', 'a4'],
    'a4',
    0,
  );
}

function full(): Comparison {
  return { kind: 'full', nothingNewSince: undefined };
}

function between(from: string, to: string): Comparison {
  return { kind: 'between', from, to };
}

test('with neither marker it shows the full diff', () => {
  expect(defaultComparison(revisions(), undefined, undefined)).toEqual(full());
});

test('with no revisions it shows the full diff', () => {
  expect(defaultComparison(new Revisions(), 'a1', 'a2')).toEqual(full());
});

test('it compares your last review with the latest', () => {
  expect(defaultComparison(revisions(), 'a2', undefined)).toEqual(between('a2', 'a4'));
});

test('it compares the last revision seen here with the latest', () => {
  expect(defaultComparison(revisions(), undefined, 'a3')).toEqual(between('a3', 'a4'));
});

test('your last review wins when it is more recent', () => {
  expect(defaultComparison(revisions(), 'a3', 'a2')).toEqual(between('a3', 'a4'));
});

test('the last revision seen here wins when it is more recent', () => {
  expect(defaultComparison(revisions(), 'a1', 'a3')).toEqual(between('a3', 'a4'));
});

test('a marker on the latest shows the full diff with nothing new', () => {
  expect(defaultComparison(revisions(), 'a2', 'a4')).toEqual({
    kind: 'full',
    nothingNewSince: 'a4',
  });
});

test('an unknown marker is ignored', () => {
  expect(defaultComparison(revisions(), 'ffff', undefined)).toEqual(full());
  expect(defaultComparison(revisions(), 'ffff', 'a2')).toEqual(between('a2', 'a4'));
});

test('your last review on a commit between pushes compares from that commit', () => {
  // a2's push brought in c2 too; the API made a review on c2.
  const reviewed = revisions([{ kind: 'review', commit: 'c2', at: at(35) }]);

  expect(defaultComparison(reviewed, 'c2', undefined)).toEqual(between('c2', 'a4'));
});

test('a review whose record was not passed counts as no marker', () => {
  // c2 is a current commit, but no revision's head.
  expect(defaultComparison(revisions(), 'c2', undefined)).toEqual(full());
  expect(defaultComparison(revisions(), 'c2', 'a2')).toEqual(between('a2', 'a4'));
});

test('a marker on an unavailable revision compares from the nearest earlier one', () => {
  const gone = revisions();
  gone.markUnavailable('a3');

  expect(defaultComparison(gone, 'a3', undefined)).toEqual(between('a2', 'a4'));
});

test('a marker with no earlier available revision shows the full diff', () => {
  const gone = revisions();
  gone.markUnavailable('a1');
  gone.markUnavailable('a2');

  expect(defaultComparison(gone, 'a2', undefined)).toEqual(full());
});
