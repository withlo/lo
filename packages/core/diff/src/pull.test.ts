import { describe, expect, test } from 'vitest';

import { Moves } from './moved.ts';
import { changedLines, diffPullRequest } from './pull.ts';
import { diffText } from './file.ts';

const helper = [
  'function total(items: Item[]): number {',
  '  const sum = items.reduce((sum, item) => sum + item.price, 0);',
  '  const shipping = 5;',
  '  return sum + shipping + tax(sum);',
  '}',
];

describe('diffPullRequest', () => {
  const diff = diffPullRequest([
    {
      path: 'src/cart.ts',
      old: ['import { tax } from "./tax";', '', ...helper, ''].join('\n'),
      new: 'import { total } from "./pricing";\n',
    },
    {
      path: 'src/pricing.ts',
      old: undefined,
      // Moved here, with its return edited.
      new: [...helper.slice(0, 3), '  return sum + shipping + tax(sum, region);', '}', ''].join(
        '\n',
      ),
    },
  ]);

  test('diffs each file', () => {
    expect(diff.files.map(({ changes }) => changes.length)).toEqual([1, 1]);
  });

  test('finds code moved between files, with the words edited on the way', () => {
    expect(diff.moves).toEqual([
      {
        from: { file: 0, path: 'src/cart.ts', first: 3, last: 7 },
        to: { file: 1, path: 'src/pricing.ts', first: 1, last: 5 },
        edits: [{ old: 6, new: 4 }],
        // Words were only added, so nothing on the old side is highlighted.
        words: { old: [], new: [{ line: 4, from: 33, to: 41 }] },
      },
    ]);
  });

  test('gives plain data, which another thread can read back', () => {
    const copy = structuredClone(diff);

    expect(copy).toEqual(diff);
    expect(new Moves(copy.moves).ofAdded(1, 2)).toEqual(diff.moves[0]);
  });
});

describe('changedLines', () => {
  test('numbers each deleted and added line', () => {
    const old = 'a\nb\nc\n';
    const added = 'a\nx\nc\n';

    expect(
      changedLines({ path: 'b.ts', oldPath: 'a.ts', old, new: added }, diffText(old, added)),
    ).toEqual({
      path: 'b.ts',
      oldPath: 'a.ts',
      deleted: [{ number: 2, text: 'b' }],
      added: [{ number: 2, text: 'x' }],
    });
  });
});
