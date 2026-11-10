// Code deleted and added in the same place, between the same two unchanged lines, was changed in
// place, not moved.

import { expect, test } from 'vitest';

import { changes, indented, moves, total } from './support.ts';

test('code re indented in place is not a move', () => {
  const file = changes('a.ts').delete(10, total).add(10, indented(4, total));

  expect(moves([file])).toEqual([]);
});

test('code wrapped in a block in place is not a move', () => {
  const wrapped = ['if (enabled) {', ...indented(4, total), '}'];
  const file = changes('a.ts').delete(10, total).add(10, wrapped);

  expect(moves([file])).toEqual([]);
});

test('code in place is found after earlier changes shift the numbers', () => {
  // Deleting line 2 moves every later line up one, so old line 10 is new line 9.
  const file = changes('a.ts')
    .delete(2, ['const unused = 0;'])
    .delete(10, total)
    .add(9, indented(4, total));

  expect(moves([file])).toEqual([]);
});

test('code in place in a renamed file is not a move', () => {
  const file = changes('b.ts').renamedFrom('a.ts').delete(10, total).add(10, indented(4, total));

  expect(moves([file])).toEqual([]);
});

test('code moved past an unchanged line is a move', () => {
  // Old lines 14 to 18 stay, as new lines 10 to 14.
  const file = changes('a.ts').delete(10, total).add(15, total);

  expect(moves([file])).toEqual(['a.ts:10-13 -> a.ts:15-18']);
});

test('code at the same line numbers in another file is a move', () => {
  const files = [changes('a.ts').delete(10, total), changes('b.ts').add(10, total)];

  expect(moves(files)).toEqual(['a.ts:10-13 -> b.ts:10-13']);
});
