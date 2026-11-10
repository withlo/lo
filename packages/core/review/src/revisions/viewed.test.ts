import { expect, test } from 'vitest';

import { Revisions, type PushRecord } from '../revisions.ts';
import { buildRevisions } from './build.ts';
import { viewedFileComparison, type FileComparison } from './viewed.ts';

/** `minute` minutes into a day in 2026, in milliseconds since the Unix epoch. */
function at(minute: number): number {
  return (1_790_000_000 + minute * 60) * 1000;
}

function pushed(before: string | undefined, after: string, minute: number): PushRecord {
  return { kind: 'activity', before, after, at: at(minute), forced: false };
}

const PUSHES = [
  pushed(undefined, 'a1', 10),
  pushed('a1', 'a2', 20),
  pushed('a2', 'a3', 30),
  pushed('a3', 'a4', 40),
];

/** r1 to r4, heads `a1` to `a4`. */
function revisions(): Revisions {
  return buildRevisions(PUSHES, ['a1', 'a2', 'a3', 'a4'], 'a4', 0);
}

function dismissed(
  list: Revisions,
  viewedAt: string | undefined,
  lastReview: string | undefined,
): FileComparison | undefined {
  return viewedFileComparison(list, 'DISMISSED', viewedAt, lastReview);
}

function sinceViewed(from: string): FileComparison {
  return { kind: 'sinceViewed', from, to: 'a4' };
}

function sinceLastReview(from: string): FileComparison {
  return { kind: 'sinceLastReview', from, to: 'a4' };
}

const FULL: FileComparison = { kind: 'full' };

test('a viewed file is skipped', () => {
  expect(viewedFileComparison(revisions(), 'VIEWED', 'a2', 'a1')).toBeUndefined();
});

test('an unviewed file is skipped', () => {
  expect(viewedFileComparison(revisions(), 'UNVIEWED', 'a2', 'a1')).toBeUndefined();
});

test('a file viewed on this mac compares from where it was viewed', () => {
  expect(dismissed(revisions(), 'a2', undefined)).toEqual(sinceViewed('a2'));
});

test('this macs record wins over a later review', () => {
  expect(dismissed(revisions(), 'a1', 'a3')).toEqual(sinceViewed('a1'));
});

test('a file viewed elsewhere compares from your last review', () => {
  expect(dismissed(revisions(), undefined, 'a2')).toEqual(sinceLastReview('a2'));
});

test('a last review whose record was not passed counts as none', () => {
  // c3 is a current commit, but no revision's head.
  const withC3 = buildRevisions(PUSHES, ['a1', 'a2', 'c3', 'a3', 'a4'], 'a4', 0);

  expect(dismissed(withC3, undefined, 'c3')).toEqual(FULL);
});

test('a record of an unknown head falls back to your last review', () => {
  expect(dismissed(revisions(), 'ffff', 'a2')).toEqual(sinceLastReview('a2'));
});

test('a record on the latest revision falls back to your last review', () => {
  // GitHub says the file changed since it was viewed, so a record at the latest is stale.
  expect(dismissed(revisions(), 'a4', 'a2')).toEqual(sinceLastReview('a2'));
});

test('with neither marker it shows the files whole diff', () => {
  expect(dismissed(revisions(), undefined, undefined)).toEqual(FULL);
});

test('a last review on the latest revision shows the files whole diff', () => {
  expect(dismissed(revisions(), undefined, 'a4')).toEqual(FULL);
});

test('with no revisions it shows the files whole diff', () => {
  expect(dismissed(new Revisions(), 'a2', 'a1')).toEqual(FULL);
});

test('a record on an unavailable revision compares from the nearest earlier one', () => {
  const gone = revisions();
  gone.markUnavailable('a2');

  expect(dismissed(gone, 'a2', 'a3')).toEqual(sinceViewed('a1'));
});

test('a record with no earlier available revision shows the files whole diff', () => {
  const gone = revisions();
  gone.markUnavailable('a1');
  gone.markUnavailable('a2');

  expect(dismissed(gone, 'a2', 'a3')).toEqual(FULL);
});

test('a last review on an unavailable revision compares from the nearest earlier one', () => {
  const gone = revisions();
  gone.markUnavailable('a3');

  expect(dismissed(gone, undefined, 'a3')).toEqual(sinceLastReview('a2'));
});
