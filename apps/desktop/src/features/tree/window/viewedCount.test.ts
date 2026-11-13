import { describe, expect, it } from 'vitest';

import type { ShownMarks } from '../../revisions/window/shared.ts';
import type { Files } from '../../tab/window/shared.ts';
import type { Changed, TreeState } from '../contract.ts';
import { viewedCountOf } from './shared.ts';

const change = (text: string, previous?: string): Changed => ({
  path: { text },
  change: previous === undefined ? 'modified' : 'renamed',
  previous: previous === undefined ? null : { text: previous },
  generated: null,
});

/** The tree of a layer whose diff shows `changes`. */
function treeOf(changes: Changed[] | null, partial = false): TreeState {
  return {
    id: 't1',
    at: 'a'.repeat(40),
    listing: { kind: 'changed', why: 'Only the changed files show.' },
    from: 'local',
    changes,
    changesFrom: 'local',
    partial,
    problem: null,
    omitted: 0,
    compared: null,
  };
}

/** GitHub's marks for the pull request: `viewed` of the paths marked, of `total` files. */
function marksOf(paths: Record<string, 'viewed' | 'unviewed'>, total: number): ShownMarks {
  const viewed = Object.values(paths).filter((mark) => mark === 'viewed').length;
  return { byPath: new Map(Object.entries(paths)), count: { viewed, total } };
}

/** The files GitHub listed, which are `count` of the pull request's `total`. */
function listedOf(count: number, total: number): Files {
  return {
    id: 't1',
    files: Array.from({ length: count }, (_, index) => ({
      path: `f${index}`,
      viewed: 'unviewed' as const,
    })),
    total,
  };
}

describe('the viewed count of the files a diff shows', () => {
  // #84 sits on #83 by shared commits, so GitHub's own diff of it, and its count, take in #82 and
  // #83's files; the layer's diff shows only nodes.ts.
  const marks = marksOf(
    { 'src/limits.ts': 'viewed', 'src/cost.ts': 'unviewed', 'src/nodes.ts': 'unviewed' },
    3,
  );

  it('counts only the files the layer’s diff shows, not the pull request’s', () => {
    expect(viewedCountOf(marks, treeOf([change('src/nodes.ts')]), listedOf(3, 3))).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // A mark on a file the diff leaves out doesn't count either.
    expect(
      viewedCountOf(
        marks,
        treeOf([change('src/limits.ts'), change('src/nodes.ts')]),
        listedOf(3, 3),
      ),
    ).toEqual({ viewed: 1, total: 2, partial: false });
  });

  it('is the same as GitHub’s when the diff shows every file of the pull request', () => {
    const all = ['src/limits.ts', 'src/cost.ts', 'src/nodes.ts'].map((path) => change(path));
    expect(viewedCountOf(marks, treeOf(all), listedOf(3, 3))).toEqual({
      viewed: 1,
      total: 3,
      partial: false,
    });
  });

  it('finds a renamed file’s mark by its old name', () => {
    expect(
      viewedCountOf(marks, treeOf([change('src/limits2.ts', 'src/limits.ts')]), listedOf(3, 3)),
    ).toEqual({ viewed: 1, total: 1, partial: false });
  });

  it('is partial while GitHub listed fewer files than the pull request changes', () => {
    expect(
      viewedCountOf(
        marksOf({ a: 'viewed' }, 214),
        treeOf([change('a'), change('b')]),
        listedOf(1, 214),
      ),
    ).toEqual({ viewed: 1, total: 2, partial: true });
  });

  it('is GitHub’s own count, as partial, while the tree’s list of changes is', () => {
    expect(viewedCountOf(marks, treeOf([change('src/nodes.ts')], true), listedOf(3, 3))).toEqual({
      viewed: 1,
      total: 3,
      partial: true,
    });
  });

  it('is nothing until GitHub’s marks and the changed files are known', () => {
    expect(viewedCountOf({ byPath: new Map(), count: undefined }, treeOf([]), undefined)).toBe(
      undefined,
    );
    expect(viewedCountOf(marks, undefined, listedOf(3, 3))).toBeUndefined();
    expect(viewedCountOf(marks, treeOf(null), listedOf(3, 3))).toBeUndefined();
  });
});
