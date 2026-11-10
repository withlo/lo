// How long a block has to be, and how blank lines count.

import { expect, test } from 'vitest';

import { changes, moves } from './support.ts';

test('a move needs three lines', () => {
  const three = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
  const files = [changes('a.ts').delete(1, three), changes('b.ts').add(1, three)];

  expect(moves(files)).toEqual(['a.ts:1-3 -> b.ts:1-3']);
});

test('two lines are too short', () => {
  const two = ['const a = 1;', 'const b = 2;'];
  const files = [changes('a.ts').delete(1, two), changes('b.ts').add(1, two)];

  expect(moves(files)).toEqual([]);
});

test('blank lines do not count toward three', () => {
  const two = ['const a = 1;', '', '  ', 'const b = 2;', ''];
  const files = [changes('a.ts').delete(1, two), changes('b.ts').add(1, two)];

  expect(moves(files)).toEqual([]);
});

test('blank lines sit inside a block', () => {
  const files = [
    changes('a.ts').delete(1, ['const a = 1;', '', 'const b = 2;', '', 'const c = 3;']),
    changes('b.ts').add(1, ['const a = 1;', 'const b = 2;', '', '', '', 'const c = 3;']),
  ];

  expect(moves(files)).toEqual(['a.ts:1-5 -> b.ts:1-6']);
});

test('a block starts and ends on a line that is not blank', () => {
  const files = [
    changes('a.ts').delete(1, ['', 'const a = 1;', 'const b = 2;', 'const c = 3;', '']),
    changes('b.ts').add(1, ['', '', 'const a = 1;', 'const b = 2;', 'const c = 3;']),
  ];

  expect(moves(files)).toEqual(['a.ts:2-4 -> b.ts:3-5']);
});

test('a block is consecutive lines', () => {
  // The same three lines, but an unchanged line splits the deletion in two.
  const files = [
    changes('a.ts').delete(1, ['const a = 1;', 'const b = 2;']).delete(4, ['const c = 3;']),
    changes('b.ts').add(1, ['const a = 1;', 'const b = 2;', 'const c = 3;']),
  ];

  expect(moves(files)).toEqual([]);
});

test('lines of only punctuation are not a move', () => {
  const braces = ['        }', '    });', '}'];
  const files = [changes('a.ts').delete(1, braces), changes('b.ts').add(1, braces)];

  expect(moves(files)).toEqual([]);
});

test('lines of only punctuation do not count toward three', () => {
  const call = ['run(', '  first,', ');'];
  const files = [changes('a.ts').delete(1, call), changes('b.ts').add(1, call)];

  expect(moves(files)).toEqual([]);
});

test('lines of only punctuation sit inside a block', () => {
  const block = ['const list = [', '  1,', '];', 'const total = 2;'];
  const files = [changes('a.ts').delete(1, block), changes('b.ts').add(1, block)];

  expect(moves(files)).toEqual(['a.ts:1-4 -> b.ts:1-4']);
});

test('lines with letters or digits decide which match is longer', () => {
  const parts = ['const p1 = 1;', 'const p2 = 2;', 'const p3 = 3;', 'const p4 = 4;'];
  const old = [...parts, ...Array<string>(6).fill('}')];
  const files = [
    changes('a.ts').delete(1, old),
    // Nine matching lines, but only three with letters or digits.
    changes('b.ts').add(1, old.slice(1)),
    changes('c.ts').add(1, parts),
  ];

  expect(moves(files)).toEqual(['a.ts:1-4 -> c.ts:1-4']);
});
