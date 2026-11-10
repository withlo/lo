// Small edits inside a moved block keep it a move, and are reported.

import { expect, test } from 'vitest';

import { changes, moves } from './support.ts';

/** `count` distinct lines, `const line1 = 1;` and so on. */
function lines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `const line${index + 1} = ${index + 1};`);
}

/** `lines` with the lines at the 1-based `numbers` edited. */
function edit(original: readonly string[], numbers: readonly number[]): string[] {
  const edited = [...original];
  for (const number of numbers) edited[number - 1] = `const line${number} = changed();`;
  return edited;
}

/** A file that deletes `old` at line 1 and one that adds `added` at line 1. */
function moved(old: readonly string[], added: readonly string[]): string[] {
  return moves([changes('a.ts').delete(1, old), changes('b.ts').add(1, added)]);
}

test('an edited line inside a block keeps it a move', () => {
  const old = lines(6);

  expect(moved(old, edit(old, [3]))).toEqual(['a.ts:1-6 -> b.ts:1-6 edited 3/3']);
});

test('two edited lines in a row keep it a move', () => {
  const old = lines(8);

  expect(moved(old, edit(old, [4, 5]))).toEqual(['a.ts:1-8 -> b.ts:1-8 edited 4/4 5/5']);
});

test('three edited lines in a row split the block', () => {
  const old = lines(10);

  expect(moved(old, edit(old, [4, 5, 6]))).toEqual([
    'a.ts:1-3 -> b.ts:1-3',
    'a.ts:7-10 -> b.ts:7-10',
  ]);
});

test('exactly two thirds matching is enough', () => {
  const old = lines(6);

  expect(moved(old, edit(old, [3, 5]))).toEqual(['a.ts:1-6 -> b.ts:1-6 edited 3/3 5/5']);
});

test('less than two thirds matching is not a move', () => {
  const old = lines(5);

  expect(moved(old, edit(old, [2, 4]))).toEqual([]);
});

test('a block runs to the furthest line that keeps two thirds', () => {
  // Matches: yes, yes, yes, no, no, yes, no, no, yes, no, no, yes.
  const old = lines(12);

  expect(moved(old, edit(old, [4, 5, 7, 8, 10, 11]))).toEqual([
    'a.ts:1-6 -> b.ts:1-6 edited 4/4 5/5',
  ]);
});

test('a block starts past a weak start', () => {
  // Matches: yes, no, no, yes, no, no, yes, yes, yes, yes. From line 1, no stretch keeps two thirds
  // past line 1, so the block starts at line 4.
  const old = lines(10);

  expect(moved(old, edit(old, [2, 3, 5, 6]))).toEqual(['a.ts:4-10 -> b.ts:4-10 edited 5/5 6/6']);
});

test('a block starts and ends with matching lines', () => {
  const old = lines(5);

  expect(moved(old, edit(old, [1, 5]))).toEqual(['a.ts:2-4 -> b.ts:2-4']);
});

test('edits need three matching lines around them', () => {
  const old = lines(3);

  expect(moved(old, edit(old, [2]))).toEqual([]);
});

test('edited lines pair up across blank lines', () => {
  const old = ['const a = 1;', '', 'const b = 2;', 'const c = 3;', 'const d = 4;'];
  const added = ['const a = 1;', 'const b = 2;', 'const c = 30;', '', 'const d = 4;'];

  expect(moved(old, added)).toEqual(['a.ts:1-5 -> b.ts:1-5 edited 4/3']);
});

test('a line added inside a block splits it in two', () => {
  const old = lines(6);
  const added = old.toSpliced(3, 0, "console.info('added');");

  expect(moved(old, added)).toEqual(['a.ts:1-3 -> b.ts:1-3', 'a.ts:4-6 -> b.ts:5-7']);
});

test('a line removed inside a block splits it in two', () => {
  const old = lines(7);
  const added = old.toSpliced(3, 1);

  expect(moved(old, added)).toEqual(['a.ts:1-3 -> b.ts:1-3', 'a.ts:5-7 -> b.ts:4-6']);
});

test('a longer block with an edit beats a shorter one without', () => {
  const old = lines(6);
  const files = [
    changes('a.ts').delete(1, old),
    changes('b.ts').add(1, old.slice(0, 4)),
    changes('c.ts').add(1, edit(old, [3])),
  ];

  expect(moves(files)).toEqual(['a.ts:1-6 -> c.ts:1-6 edited 3/3']);
});

test('of two blocks as long the one with fewer edits wins', () => {
  const old = lines(6);
  const files = [
    changes('a.ts').delete(1, old),
    changes('b.ts').add(1, edit(old, [3])),
    changes('c.ts').add(1, edit(old, [6])),
  ];

  // Both match 5 lines, but c.ts's block ends before its edited line, so it has no edits.
  expect(moves(files)).toEqual(['a.ts:1-5 -> c.ts:1-5']);
});
