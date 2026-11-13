// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { ShownMarks } from '../../revisions/window/shared.ts';
import type { LocalState } from '../../tab/contract.ts';
import type { Files } from '../../tab/window/shared.ts';
import type { Changed, TreeState } from '../contract.ts';
import { viewedCountOf } from './shared.ts';
import { held, showState, type Held } from './store.ts';

const AT = 'a'.repeat(40);
const START = 'b'.repeat(40);

/** The local copy, ready at the head: a layer's says what it's compared with, other pull requests' none. */
const PLAIN: LocalState = { kind: 'ready', head: AT, base: AT, mergeBase: AT, offline: false };
const LAYER: LocalState = { ...PLAIN, from: { commit: START, missing: false } };

const change = (text: string, previous?: string): Changed => ({
  path: { text },
  change: previous === undefined ? 'modified' : 'renamed',
  previous: previous === undefined ? null : { text: previous },
  generated: null,
});

/**
 * A tab's tree, listing `changes` and, when two revisions are compared, the files between them. A
 * layer's starts at the commit it's compared with, unless revisions are compared.
 */
function treeOf(
  id: string,
  changes: Changed[] | null,
  {
    compared = null,
    partial = false,
    start = null,
    changesFrom = 'local',
  }: {
    compared?: Changed[] | null;
    partial?: boolean;
    start?: string | null;
    changesFrom?: 'local' | 'github';
  } = {},
): TreeState {
  return {
    id,
    at: AT,
    listing: { kind: 'changed', why: 'Only the changed files show.' },
    from: 'local',
    changes,
    changesFrom,
    partial,
    problem: null,
    omitted: 0,
    compared,
    start,
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
  // The layer's own files, listed at its head, from where it starts.
  const OWN: Held = { at: AT, start: START, changes: own };

  it('is GitHub’s count of the pull request’s files, for a pull request that isn’t a layer', () => {
    expect(viewedCountOf(marks, listedOf(3, 3), PLAIN, OWN)).toEqual({
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
    expect(viewedCountOf({ byPath: new Map(), count: undefined }, undefined, LAYER, OWN)).toBe(
      undefined,
    );
  });

  it('is of the layer’s own files, for a layer compared with the layer below it', () => {
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, OWN)).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // A mark on a file its diff leaves out doesn't count either, and a rename is found by its old
    // name.
    expect(
      viewedCountOf(marks, listedOf(3, 3), LAYER, {
        ...OWN,
        changes: [change('src/limits2.ts', 'src/limits.ts'), ...own],
      }),
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
    showState(treeOf('layer', own, { start: START }));
    expect(held.get('layer')).toEqual(OWN);
    // r4 → r5 lists the files from the bottom of the stack, and one the pull request doesn't
    // change: none of them is the layer's.
    const lower = [change('src/limits.ts'), change('src/cost.ts'), change('src/nodes.ts')];
    const reverted = change('src/x.ts');
    showState(treeOf('layer', [...lower, reverted], { compared: [reverted] }));
    expect(held.get('layer')).toEqual(OWN);
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, held.get('layer'))).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // The tree loading again, as on a revision change, keeps it too.
    showState(treeOf('layer', null));
    expect(held.get('layer')).toEqual(OWN);
    // Opened straight into a comparison, nothing is known of the layer's own files, so GitHub's
    // count shows.
    showState(treeOf('compared', [...lower, reverted], { compared: [reverted] }));
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, held.get('compared'))).toEqual({
      viewed: 1,
      total: 3,
      partial: false,
    });
  });

  it('is GitHub’s count once the head or the start isn’t the one the kept files are of', () => {
    // Viewed at r4, with the layer's own files kept, then compared r3 → r4, and r5 loaded.
    showState(treeOf('moved', own, { start: START }));
    const kept = held.get('moved');
    const github = { viewed: 1, total: 3, partial: false };
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, kept)).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // The push r5 loaded while comparing: the local copy is at a head the kept files aren't of.
    const pushed: LocalState = { ...LAYER, head: 'c'.repeat(40) };
    expect(viewedCountOf(marks, listedOf(3, 3), pushed, kept)).toEqual(github);
    // “#84 now sits on #83”, while comparing: the layer starts from another commit.
    const moved: LocalState = { ...LAYER, from: { commit: 'd'.repeat(40), missing: false } };
    expect(viewedCountOf(marks, listedOf(3, 3), moved, kept)).toEqual(github);
    // The tree listing it again at the new start, once the comparison is left, holds its files.
    showState(treeOf('moved', own, { start: 'd'.repeat(40) }));
    expect(viewedCountOf(marks, listedOf(3, 3), moved, held.get('moved'))).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
  });

  it('is of the layer’s own files from GitHub’s comparison, when the local copy can’t say what changed', () => {
    // The copy is ready at the head but refuses the comparison, or has no merge base, so the tree
    // lists what GitHub's comparison with where the layer starts holds, which is the layer's own.
    showState(treeOf('fallback', own, { start: START, changesFrom: 'github' }));
    expect(held.get('fallback')).toEqual(OWN);
    expect(viewedCountOf(marks, listedOf(3, 3), LAYER, held.get('fallback'))).toEqual({
      viewed: 0,
      total: 1,
      partial: false,
    });
    // It counts from the moment the copy is ready at the head, before the tree lists from the
    // copy, and a push or a new start leaves it behind as the copy's own list does.
    const pushed: LocalState = { ...LAYER, head: 'c'.repeat(40) };
    expect(viewedCountOf(marks, listedOf(3, 3), pushed, held.get('fallback'))).toEqual({
      viewed: 1,
      total: 3,
      partial: false,
    });
  });

  it('keeps no list GitHub gave only part of, or of a pull request that is no layer', () => {
    showState(treeOf('partial', own, { partial: true }));
    expect(held.get('partial')).toBeUndefined();
    showState(treeOf('partial layer', own, { start: START, partial: true, changesFrom: 'github' }));
    expect(held.get('partial layer')).toBeUndefined();
    // GitHub's files of a pull request that starts nowhere are of every file it changes.
    showState(treeOf('github', own, { changesFrom: 'github' }));
    expect(held.get('github')).toBeUndefined();
  });
});
