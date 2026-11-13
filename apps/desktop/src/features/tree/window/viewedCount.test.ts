// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { ShownMarks } from '../../revisions/window/shared.ts';
import type { LocalState } from '../../tab/contract.ts';
import type { Files } from '../../tab/window/shared.ts';
import type { Changed, TreeState } from '../contract.ts';
import { viewedCountOf } from './shared.ts';
import { held, showState } from './store.ts';

const AT = 'a'.repeat(40);

/** The local copy, ready at the head: a layer's says what it's compared with, other pull requests' none. */
const PLAIN: LocalState = { kind: 'ready', head: AT, base: AT, mergeBase: AT, offline: false };
const LAYER: LocalState = { ...PLAIN, from: { commit: 'b'.repeat(40), missing: false } };

const change = (text: string, previous?: string): Changed => ({
  path: { text },
  change: previous === undefined ? 'modified' : 'renamed',
  previous: previous === undefined ? null : { text: previous },
  generated: null,
});

/** A tab's tree, listing `changes` and, when two revisions are compared, the files between them. */
function treeOf(
  id: string,
  changes: Changed[] | null,
  { compared = null, partial = false }: { compared?: Changed[] | null; partial?: boolean } = {},
): TreeState {
  return {
    id,
    at: AT,
    listing: { kind: 'changed', why: 'Only the changed files show.' },
    from: 'local',
    changes,
    changesFrom: 'local',
    partial,
    problem: null,
    omitted: 0,
    compared,
  };
}

/** GitHub's marks for the pull request: of the paths marked, and of `total` files. */
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

describe('the viewed count', () => {
  // #84 sits on #83 by shared commits, so GitHub's own diff of it, and its count, take in #82 and
  // #83's files; the layer's diff holds only nodes.ts.
  const marks = marksOf(
    { 'src/limits.ts': 'viewed', 'src/cost.ts': 'unviewed', 'src/nodes.ts': 'unviewed' },
    3,
  );
  const own = [change('src/nodes.ts')];

  it('is GitHub’s count of the pull request’s files, for a pull request that isn’t a layer', () => {
    expect(viewedCountOf(marks, listedOf(3, 3), PLAIN, own)).toEqual({
      viewed: 1,
      total: 3,
      partial: false,
    });
    // Partial while GitHub listed fewer files than the pull request changes.
    expect(
      viewedCountOf(marksOf({ a: 'viewed' }, 214), listedOf(1, 214), PLAIN, undefined),
    ).toEqual({
      viewed: 1,
      total: 214,
      partial: true,
    });
    expect(viewedCountOf({ byPath: new Map(), count: undefined }, undefined, LAYER, own)).toBe(
      undefined,
    );
  });

  it('is of the layer’s own files, for a layer compared with the layer below it', () => {
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, own)).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // A mark on a file its diff leaves out doesn't count either, and a rename is found by its old
    // name.
    expect(
      viewedCountOf(marks, listedOf(3, 3), LAYER, [
        change('src/limits2.ts', 'src/limits.ts'),
        ...own,
      ]),
    ).toEqual({ viewed: 1, total: 2, partial: false });
  });

  it('never changes while revisions are compared, on a pull request that isn’t a layer', () => {
    // r5 reverts an unrelated edit to X: r4 → r5 lists X among the changes, though the pull
    // request doesn't change it, and `e` on it fails. The head read "10 / 11 viewed".
    const paths = Array.from({ length: 10 }, (_, index) => `src/f${index}.ts`);
    const all = marksOf(Object.fromEntries(paths.map((path) => [path, 'viewed' as const])), 10);
    const pull = paths.map((path) => change(path));
    const x = change('src/x.ts');
    const count = () => viewedCountOf(all, listedOf(10, 10), PLAIN, held.get('ordinary'));
    showState(treeOf('ordinary', pull));
    expect(count()).toEqual({ viewed: 10, total: 10, partial: false });
    showState(treeOf('ordinary', [...pull, x], { compared: [x] }));
    expect(count()).toEqual({ viewed: 10, total: 10, partial: false });
    // Nor does the tree loading for another revision blank it.
    showState(treeOf('ordinary', null));
    expect(count()).toEqual({ viewed: 10, total: 10, partial: false });
  });

  it('is of the layer’s own files while revisions are compared too, from when none were', () => {
    // The layer's own files, listed with no revisions compared.
    showState(treeOf('layer', own));
    expect(held.get('layer')).toBe(own);
    // r4 → r5 lists the files from the bottom of the stack, and one the pull request doesn't
    // change: none of them is the layer's.
    const lower = [change('src/limits.ts'), change('src/cost.ts'), change('src/nodes.ts')];
    const reverted = change('src/x.ts');
    showState(treeOf('layer', [...lower, reverted], { compared: [reverted] }));
    expect(held.get('layer')).toBe(own);
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, held.get('layer'))).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // The tree loading again, as on a revision change, keeps it too.
    showState(treeOf('layer', null));
    expect(held.get('layer')).toBe(own);
    // Opened straight into a comparison, nothing is known of the layer's own files, so GitHub's
    // count shows.
    showState(treeOf('compared', [...lower, reverted], { compared: [reverted] }));
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, held.get('compared'))).toEqual({
      viewed: 1,
      total: 3,
      partial: false,
    });
  });

  it('keeps no list GitHub gave only part of', () => {
    showState(treeOf('partial', own, { partial: true }));
    expect(held.get('partial')).toBeUndefined();
  });
});
