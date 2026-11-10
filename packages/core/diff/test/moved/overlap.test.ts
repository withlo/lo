// Each deleted or added line belongs to at most one move, and longer matches win.

import { expect, test } from 'vitest';

import { changes, moves, total } from './support.ts';

/** Ten distinct lines, `const line1 = 1;` to `const line10 = 10;`. */
function ten(): string[] {
  return Array.from({ length: 10 }, (_, index) => `const line${index + 1} = ${index + 1};`);
}

test('the longer of two destinations wins', () => {
  const files = [
    changes('a.ts').delete(1, total),
    changes('b.ts').add(1, total.slice(0, 3)),
    changes('c.ts').add(1, total),
  ];

  expect(moves(files)).toEqual(['a.ts:1-4 -> c.ts:1-4']);
});

test('the longer of two sources wins', () => {
  const files = [
    changes('a.ts').delete(1, total.slice(0, 3)),
    changes('b.ts').delete(1, total),
    changes('c.ts').add(1, total),
  ];

  expect(moves(files)).toEqual(['b.ts:1-4 -> c.ts:1-4']);
});

test('a block added twice is one move to the first place', () => {
  const files = [
    changes('a.ts').delete(1, total),
    changes('b.ts').add(1, total),
    changes('c.ts').add(1, total),
  ];

  expect(moves(files)).toEqual(['a.ts:1-4 -> b.ts:1-4']);
});

test('a block added twice in one file is one move', () => {
  const file = changes('a.ts').delete(1, total).add(20, total).add(40, total);

  expect(moves([file])).toEqual(['a.ts:1-4 -> a.ts:20-23']);
});

test('a block deleted twice is one move from the first place', () => {
  const files = [
    changes('a.ts').delete(1, total),
    changes('b.ts').delete(1, total),
    changes('c.ts').add(1, total),
  ];

  expect(moves(files)).toEqual(['a.ts:1-4 -> c.ts:1-4']);
});

test('what is left of a shorter match can still be a move', () => {
  const lines = ten();
  const files = [
    changes('a.ts').delete(1, lines),
    // Lines 1 to 7 win, so lines 8 to 10 are all that's left to move here.
    changes('b.ts').add(1, lines.slice(0, 7)),
    changes('c.ts').add(1, lines.slice(5)),
  ];

  expect(moves(files)).toEqual(['a.ts:1-7 -> b.ts:1-7', 'a.ts:8-10 -> c.ts:3-5']);
});

test('what is left of a shorter match must still be three lines', () => {
  const lines = ten();
  const files = [
    changes('a.ts').delete(1, lines),
    changes('b.ts').add(1, lines.slice(0, 7)),
    changes('c.ts').add(1, lines.slice(5, 9)),
  ];

  expect(moves(files)).toEqual(['a.ts:1-7 -> b.ts:1-7']);
});

test('a block gathered from two places is two moves', () => {
  const lines = ten();
  const files = [
    changes('a.ts').delete(1, lines.slice(0, 6)),
    changes('b.ts').delete(1, lines.slice(3)),
    changes('c.ts').add(1, lines),
  ];

  expect(moves(files)).toEqual(['a.ts:1-3 -> c.ts:1-3', 'b.ts:1-7 -> c.ts:4-10']);
});

test('repeated lines line up once', () => {
  const pattern = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
  const deleted = [...pattern, ...pattern, ...pattern];
  const files = [changes('a.ts').delete(1, deleted), changes('b.ts').add(1, deleted.slice(0, 6))];

  expect(moves(files)).toEqual(['a.ts:1-6 -> b.ts:1-6']);
});
