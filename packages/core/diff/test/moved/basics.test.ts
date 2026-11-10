// Blocks moved unchanged: within a file, across files and re-indented.

import { expect, test } from 'vitest';

import { editOfNew, Moves } from '../../src/moved.ts';
import { changes, indented, moves, total } from './support.ts';

test('finds a block moved within a file', () => {
  const file = changes('src/cart.ts').delete(10, total).add(40, total);

  expect(moves([file])).toEqual(['src/cart.ts:10-13 -> src/cart.ts:40-43']);
});

test('finds a block moved to another file', () => {
  const files = [changes('src/cart.ts').delete(10, total), changes('src/pricing.ts').add(1, total)];

  const found = Moves.find(files);

  expect(found.all).toEqual([
    {
      from: { file: 0, path: 'src/cart.ts', first: 10, last: 13 },
      to: { file: 1, path: 'src/pricing.ts', first: 1, last: 4 },
      edits: [],
    },
  ]);
});

test('names a renamed file by its old path where the block came from', () => {
  const file = changes('src/billing.ts')
    .renamedFrom('src/cart.ts')
    .delete(10, total)
    .add(40, total);

  expect(moves([file])).toEqual(['src/cart.ts:10-13 -> src/billing.ts:40-43']);
});

test('ignores changes in indentation', () => {
  const files = [
    changes('src/cart.ts').delete(10, total),
    changes('src/pricing.ts').add(20, indented(4, total)),
  ];

  expect(moves(files)).toEqual(['src/cart.ts:10-13 -> src/pricing.ts:20-23']);
});

test('ignores trailing whitespace', () => {
  const trailing = total.map((line) => `${line}  \t`);
  const files = [
    changes('src/cart.ts').delete(10, trailing),
    changes('src/pricing.ts').add(20, total),
  ];

  expect(moves(files)).toEqual(['src/cart.ts:10-13 -> src/pricing.ts:20-23']);
});

test('finds only the moved part of larger changes', () => {
  const deleted = ['const before = 1;', ...total, 'const after = 2;'];
  const added = ['const other = 3;', ...total, 'const another = 4;'];
  const files = [
    changes('src/cart.ts').delete(10, deleted),
    changes('src/pricing.ts').add(20, added),
  ];

  expect(moves(files)).toEqual(['src/cart.ts:11-14 -> src/pricing.ts:21-24']);
});

test('finds several moves in order of where they land', () => {
  const other = ['function zero(): number {', '  const zero = 0;', '  return zero;', '}'];
  const files = [
    changes('src/a.ts').delete(5, other).delete(30, total),
    changes('src/b.ts').add(1, total).add(10, other),
  ];

  expect(moves(files)).toEqual([
    'src/a.ts:30-33 -> src/b.ts:1-4',
    'src/a.ts:5-8 -> src/b.ts:10-13',
  ]);
});

test('finds nothing without a match', () => {
  const files = [
    changes('src/a.ts').delete(1, total),
    changes('src/b.ts').add(1, ['function other() {', '  work();', '  more();', '}']),
  ];

  expect(moves(files)).toEqual([]);
});

test('takes lines in any order', () => {
  const file = changes('src/cart.ts').add(40, total);
  file.deleted = changes('src/cart.ts').delete(10, total).deleted.toReversed();
  [file.added[0], file.added[2]] = [file.added[2]!, file.added[0]!];

  expect(moves([file])).toEqual(['src/cart.ts:10-13 -> src/cart.ts:40-43']);
});

test('finds a function moved into a class, with its return edited', () => {
  const files = [
    changes('api/user.ts').delete(40, [
      'function fullName(user: User): string {',
      '  const first = user.first.trim();',
      '  const middle = user.middle?.trim();',
      '  const last = user.last.trim();',
      "  return [first, middle, last].filter(Boolean).join(' ');",
      '}',
    ]),
    // Moved into a class, so one level deeper, with its return edited.
    changes('api/names.ts').add(12, [
      '  fullName(user: User): string {',
      '    const first = user.first.trim();',
      '    const middle = user.middle?.trim();',
      '    const last = user.last.trim();',
      "    return [first, middle, last].filter((name) => name).join(' ');",
      '  }',
    ]),
  ];
  const found = Moves.find(files);

  // The function's first line changed too, so the move starts at the line after it: a move starts
  // and ends with lines that match.
  const moved = found.ofAdded(1, 14);
  expect(moved).toMatchObject({
    from: { path: 'api/user.ts', first: 41, last: 45 },
    to: { first: 13, last: 17 },
    edits: [{ old: 44, new: 16 }],
  });
  expect(editOfNew(moved!, 16)).toEqual({ old: 44, new: 16 });
  expect(found.ofDeleted(0, 42)).toBe(moved);
});
