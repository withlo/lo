import { describe, expect, it } from 'vitest';

import { contract, FOLDERS_LIMIT, treePath } from './contract.ts';

const paths = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ text: `f${index}` }));

describe("the tree feature's contract", () => {
  it('takes a path as text, with its bytes in hex beside it when they aren’t UTF-8', () => {
    expect(treePath.parse({ text: 'src/a.ts' })).toEqual({ text: 'src/a.ts' });
    expect(treePath.parse({ text: 'caf�', hex: '636166e9' })).toEqual({
      text: 'caf�',
      hex: '636166e9',
    });
    const refused = [
      { text: '' },
      { text: 'a', hex: '6' },
      { text: 'a', hex: 'zz' },
      { text: 'a', hex: '6A' },
      { text: 'a', bytes: [97] },
    ];
    expect(refused.filter((path) => treePath.safeParse(path).success)).toEqual([]);
  });

  it('asks for a bounded number of folders, of one commit', () => {
    const { input } = contract.requests.folder;
    const at = 'a'.repeat(40);
    expect(input.safeParse({ id: 't1', at, paths: paths(1) }).success).toBe(true);
    expect(input.safeParse({ id: 't1', at, paths: paths(FOLDERS_LIMIT + 1) }).success).toBe(false);
    expect(input.safeParse({ id: 't1', at, paths: [] }).success).toBe(false);
    expect(input.safeParse({ id: 't1', at: 'main', paths: paths(1) }).success).toBe(false);
  });

  it('finds with a query of 1,000 characters at most', () => {
    const { input } = contract.requests.find;
    expect(input.safeParse({ id: 't1', query: 'a'.repeat(1000) }).success).toBe(true);
    expect(input.safeParse({ id: 't1', query: 'a'.repeat(1001) }).success).toBe(false);
  });
});
