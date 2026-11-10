// Looking up the move a line belongs to, and whether it was edited.

import { expect, test } from 'vitest';

import { editOfNew, editOfOld, type Move, Moves } from '../../src/moved.ts';
import { changes, summarize } from './support.ts';

function lines(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `const ${prefix}${index + 1} = ${index + 1};`);
}

/** Two blocks moved from a.ts to b.ts, and one within b.ts, with blank lines and an edit. */
function files(): ReturnType<typeof changes>[] {
  const first = lines('first', 4).toSpliced(2, 0, '');
  const second = lines('second', 3);
  const third = lines('third', 5);
  const edited = third.with(2, 'const third3 = changed();');
  return [
    changes('a.ts').delete(1, first).delete(20, second),
    changes('b.ts').add(1, second).add(10, first).delete(30, third).add(50, edited),
  ];
}

function at(moves: Moves, found: Move | undefined): number | undefined {
  return found && moves.all.indexOf(found);
}

test('finds the moves', () => {
  const moves = Moves.find(files());

  expect(moves.all.map(summarize)).toEqual([
    'a.ts:20-22 -> b.ts:1-3',
    'a.ts:1-5 -> b.ts:10-14',
    'b.ts:30-34 -> b.ts:50-54 edited 32/52',
  ]);
});

test('finds the move of each deleted line', () => {
  const moves = Moves.find(files());

  const ofDeleted = (file: number, line: number): number | undefined =>
    at(moves, moves.ofDeleted(file, line));
  expect(ofDeleted(0, 1)).toBe(1);
  // The blank line inside the block.
  expect(ofDeleted(0, 3)).toBe(1);
  expect(ofDeleted(0, 5)).toBe(1);
  expect(ofDeleted(0, 6)).toBeUndefined();
  expect(ofDeleted(0, 19)).toBeUndefined();
  expect(ofDeleted(0, 20)).toBe(0);
  expect(ofDeleted(0, 22)).toBe(0);
  expect(ofDeleted(0, 23)).toBeUndefined();
  expect(ofDeleted(1, 1)).toBeUndefined();
  expect(ofDeleted(1, 32)).toBe(2);
  expect(ofDeleted(2, 1)).toBeUndefined();
});

test('finds the move of each added line', () => {
  const moves = Moves.find(files());

  const ofAdded = (file: number, line: number): number | undefined =>
    at(moves, moves.ofAdded(file, line));
  expect(ofAdded(0, 1)).toBeUndefined();
  expect(ofAdded(1, 1)).toBe(0);
  expect(ofAdded(1, 3)).toBe(0);
  expect(ofAdded(1, 4)).toBeUndefined();
  expect(ofAdded(1, 9)).toBeUndefined();
  expect(ofAdded(1, 10)).toBe(1);
  expect(ofAdded(1, 12)).toBe(1);
  expect(ofAdded(1, 14)).toBe(1);
  expect(ofAdded(1, 15)).toBeUndefined();
  expect(ofAdded(1, 50)).toBe(2);
  expect(ofAdded(1, 54)).toBe(2);
  expect(ofAdded(1, 55)).toBeUndefined();
});

test('finds the edit of a line', () => {
  const moves = Moves.find(files());
  const edited = moves.all[2]!;
  const edit = { old: 32, new: 52 };

  expect(editOfOld(edited, 32)).toEqual(edit);
  expect(editOfNew(edited, 52)).toEqual(edit);
  expect(editOfOld(edited, 31)).toBeUndefined();
  expect(editOfOld(edited, 52)).toBeUndefined();
  expect(editOfNew(edited, 53)).toBeUndefined();
  expect(editOfNew(moves.all[0]!, 1)).toBeUndefined();
});

test('finds nothing among no moves', () => {
  const moves = Moves.find([]);

  expect(moves.all).toEqual([]);
  expect(moves.ofDeleted(0, 1)).toBeUndefined();
  expect(moves.ofAdded(0, 1)).toBeUndefined();
});
