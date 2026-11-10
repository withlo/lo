import { describe, expect, expectTypeOf, test, vi } from 'vitest';

import { Moves } from './moved.ts';
import { changedLines, diffPullRequest, findMoves, type MovedBlock } from './pull.ts';
import { diffText } from './file.ts';
import { DefaultLinesDiffComputer } from './vscode/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts';

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
    const moves = new Moves(copy.moves);

    expect(copy).toEqual(diff);
    expect(moves.ofAdded(1, 2)).toEqual(diff.moves[0]);
    expectTypeOf(moves.ofAdded(1, 2)).toEqualTypeOf<MovedBlock | undefined>();
  });

  test('finds no moves in a file whose diff came out coarse', () => {
    // A long file with every third line edited, which the budget cuts short, and a new file that
    // copies a function the edits didn't touch.
    const helperAt = Array.from({ length: 30_000 }, (_, index) =>
      index % 3 === 2 ? `edited ${index}` : `line ${index}`,
    );
    const big = [...helper, ...helperAt.map((line, index) => (index % 3 === 2 ? 'x' : line))];
    const result = diffPullRequest(
      [
        { path: 'big.ts', old: [...helper, ...helperAt].join('\n'), new: big.join('\n') },
        { path: 'copy.ts', old: undefined, new: helper.join('\n') },
      ],
      { budget: 1 },
    );

    expect(result.files[0]?.approximate).toBe(true);
    expect(result.moves).toEqual([]);
  });

  test('goes on past a file built to break the diff', () => {
    let every = '';
    for (let code = 0xe000; code <= 0xf8ff; code++) every += String.fromCharCode(code);
    const result = diffPullRequest([
      { path: 'hostile.txt', old: `${every}\nend`, new: `${every}\nend\n` },
      { path: 'b.ts', old: 'a\nb\n', new: 'a\nc\n' },
    ]);

    expect(result.files.map(({ changes }) => changes.length)).toEqual([1, 1]);
  });

  test('highlights a moved line whole when its words can\u2019t be found', () => {
    // The real diff, taken before the spy replaces it.
    const computer = new DefaultLinesDiffComputer();
    const real = computer.computeDiff.bind(computer);
    const spy = vi
      .spyOn(DefaultLinesDiffComputer.prototype, 'computeDiff')
      .mockImplementation((old, added, options) => {
        // Only a moved line's diff fails: the files' diffs have more lines.
        if (old.length === 1 && added.length === 1) throw new Error('Assertion Failed');
        return real(old, added, options);
      });
    try {
      const result = diffPullRequest([
        { path: 'src/cart.ts', old: [...helper, ''].join('\n'), new: '' },
        {
          path: 'src/pricing.ts',
          old: undefined,
          new: [...helper.slice(0, 3), '  return sum + shipping + tax(sum, region);', '}', ''].join(
            '\n',
          ),
        },
      ]);

      expect(result.moves[0]?.words).toEqual({
        old: [{ line: 4, from: 0, to: helper[3]!.length }],
        new: [{ line: 4, from: 0, to: '  return sum + shipping + tax(sum, region);'.length }],
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('goes on past a file whose diff failed', () => {
    const spy = vi
      .spyOn(DefaultLinesDiffComputer.prototype, 'computeDiff')
      .mockImplementationOnce(() => {
        throw new Error('Assertion Failed');
      });
    try {
      const result = diffPullRequest([
        { path: 'a.ts', old: 'a\nb\n', new: 'a\nc\n' },
        { path: 'b.ts', old: 'a\nb\n', new: 'a\nc\n' },
      ]);

      expect(result.files.map(({ approximate }) => approximate)).toEqual([true, false]);
      expect(result.files[1]?.changes).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('findMoves', () => {
  test('highlights edited lines whole once its budget is spent', () => {
    const moved = [...helper.slice(0, 3), '  return sum + shipping + tax(sum, region);', '}'];
    const files = [
      {
        path: 'a.ts',
        deleted: helper.map((text, index) => ({ number: index + 1, text })),
        added: [],
      },
      {
        path: 'b.ts',
        deleted: [],
        added: moved.map((text, index) => ({ number: index + 1, text })),
      },
    ];
    // The clock reads past the deadline from the first edit on.
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 10_000));
    try {
      const [block] = findMoves(files, { budget: 1000 });

      expect(block?.words).toEqual({
        old: [{ line: 4, from: 0, to: helper[3]!.length }],
        new: [{ line: 4, from: 0, to: moved[3]!.length }],
      });
    } finally {
      clock.mockRestore();
    }
  });

  test('refuses a negative budget', () => {
    expect(() => findMoves([], { budget: -1 })).toThrow(RangeError);
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

  test('gives no lines for a coarse diff', () => {
    const diff = { ...diffText('a\n', 'b\n'), approximate: true };

    expect(changedLines({ path: 'a.ts', old: 'a\n', new: 'b\n' }, diff)).toMatchObject({
      deleted: [],
      added: [],
    });
  });
});
