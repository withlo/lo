import { expect, test } from 'vitest';

import { diffLines, type Hunk } from './diff.ts';

/** `before` with each hunk's lines replaced by `after`'s, checking the lines between agree. */
function apply(before: readonly string[], after: readonly string[], hunks: readonly Hunk[]) {
  const result: string[] = [];
  const mismatched: number[] = [];
  let atA = 0;
  let atB = 0;
  const unchanged = (to: number) => {
    for (; atA < to; atA++, atB++) {
      if (before[atA] !== after[atB]) mismatched.push(atA);
      result.push(before[atA] ?? '');
    }
  };
  for (const hunk of hunks) {
    unchanged(hunk.before.start);
    result.push(...after.slice(hunk.after.start, hunk.after.end));
    atA = hunk.before.end;
    atB = hunk.after.end;
  }
  unchanged(before.length);
  return { result, mismatched, trailing: after.length - atB };
}

/** How many lines change: those in `before` the hunks remove plus those in `after` they add. */
function changed(hunks: readonly Hunk[]): number {
  return hunks.reduce(
    (sum, { before, after }) => sum + before.end - before.start + after.end - after.start,
    0,
  );
}

/** The length of the longest common subsequence, the slow way. */
function longestCommon(before: readonly string[], after: readonly string[]): number {
  let previous = Array.from({ length: after.length + 1 }, () => 0);
  for (const line of before) {
    const row = [0];
    for (const [at, other] of after.entries()) {
      row.push(
        line === other ? (previous[at] ?? 0) + 1 : Math.max(previous[at + 1] ?? 0, row[at] ?? 0),
      );
    }
    previous = row;
  }
  return previous[after.length] ?? 0;
}

/** `count` lines drawn from `alphabet`, the same ones for the same seed (xorshift). */
function lines(seed: number, count: number, alphabet: readonly string[]): string[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return alphabet[(state >>> 0) % alphabet.length] ?? '';
  });
}

test('the same lines have no hunks', () => {
  expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([]);
  expect(diffLines([], [])).toEqual([]);
});

test('hunks cover lines added, deleted and replaced', () => {
  expect(diffLines([], ['a'])).toEqual([
    { before: { start: 0, end: 0 }, after: { start: 0, end: 1 } },
  ]);
  expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
    { before: { start: 1, end: 2 }, after: { start: 1, end: 2 } },
    { before: { start: 3, end: 3 }, after: { start: 3, end: 4 } },
  ]);
});

test('a function moved below another keeps its own first line', () => {
  const before = ['fn one() {', '}', 'fn two() {', '}'];
  const after = ['fn two() {', '}', 'fn one() {', '}'];

  expect(diffLines(before, after)).toEqual([
    { before: { start: 0, end: 2 }, after: { start: 0, end: 0 } },
    { before: { start: 3, end: 3 }, after: { start: 1, end: 3 } },
  ]);
});

test('hunks turn the first lines into the second', () => {
  for (const [seed, alphabet] of [
    [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']],
    [2, ['{', '}', '', 'return x;', 'let y = 1;']],
    [3, Array.from({ length: 200 }, (_, at) => `line ${at}`)],
  ] as const) {
    const before = lines(seed, 400, alphabet);
    const after = lines(seed + 100, 380, alphabet);

    expect(apply(before, after, diffLines(before, after))).toEqual({
      result: after,
      mismatched: [],
      trailing: 0,
    });
  }
});

test('lines that all repeat too often still get a shortest diff', () => {
  // Every line occurs well over 63 times, so no line anchors the diff.
  const before = lines(7, 300, ['0', '1']);
  const after = lines(8, 280, ['0', '1']);

  const hunks = diffLines(before, after);

  expect(apply(before, after, hunks).result).toEqual(after);
  expect(changed(hunks)).toBe(before.length + after.length - 2 * longestCommon(before, after));
});
