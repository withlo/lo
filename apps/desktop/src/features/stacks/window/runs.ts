// Selecting a stack's layers in its tree, to show as one diff: `v` starts at the layer the keyboard
// is on, and `j` and `k` move the selection's other end along the branch it's on, never onto
// another, since only a chain, each layer based on the one before, is one diff. Each row main sends
// has its path from the stack's bottom, which is all a chain needs, and which places each layer in
// the stack: layers 3–5. Nothing here touches the DOM or main.

import type { Row } from '../contract.ts';

/** Layers being selected: the layer it started at, and the one its other end is at now. */
export interface Choice {
  readonly anchor: number;
  readonly end: number;
}

/**
 * The layers from `a` to `b`, in either order, bottom first, when one sits on the other through
 * the layers between: the chain one diff shows. Nothing when they're on different branches, or
 * either isn't a layer now, as a layer that merged isn't.
 */
export function chainIn(rows: readonly Row[], a: number, b: number): readonly number[] | undefined {
  const pathOf = (number: number) => rows.find((row) => row.number === number)?.path ?? [];
  const from = pathOf(a);
  const to = pathOf(b);
  if (from.length === 0 || to.length === 0) return undefined;
  if (to.includes(a)) return to.slice(to.indexOf(a));
  if (from.includes(b)) return from.slice(from.indexOf(b));
  return undefined;
}

/**
 * Where `j` (`by` 1) or `k` (-1) moves `choice`'s end, which is the run's top or its bottom. `j`
 * takes the end up a layer: from the bottom, toward where the run started; from the top, onto the
 * first layer in the tree's order that sits on it, the rest being other branches. `k` takes it
 * down a layer: from the top, toward where it started; from the bottom, onto the layer it sits on.
 * Neither drops a layer the run holds for one on another branch, and at the end of the branch, or
 * the stack's bottom, the end stays.
 */
export function stepChoice(rows: readonly Row[], choice: Choice, by: 1 | -1): Choice {
  const run = chainIn(rows, choice.anchor, choice.end);
  if (!run) return choice;
  const at = run.indexOf(choice.end);
  const [bottom] = run;
  const top = run.at(-1);
  let end: number | undefined;
  if (by > 0) {
    end =
      choice.end === top
        ? rows.find((row) => row.path.length > 1 && row.path.at(-2) === top)?.number
        : run[at + 1];
  } else {
    end =
      choice.end === bottom ? rows.find((row) => row.number === bottom)?.path.at(-2) : run[at - 1];
  }
  return end === undefined ? choice : { ...choice, end };
}

/**
 * The span of `layers`, bottom first, as their places in the stack count them from its bottom:
 * "3–5". Nothing while a layer isn't in the stack's rows.
 */
export function spanOf(rows: readonly Row[], layers: readonly number[]): string | undefined {
  const placeOf = (number: number | undefined) =>
    rows.find((row) => row.number === number)?.path.length ?? 0;
  const bottom = placeOf(layers[0]);
  const top = placeOf(layers.at(-1));
  if (bottom === 0 || top === 0) return undefined;
  return bottom === top ? String(bottom) : `${bottom}–${top}`;
}

/** "Layers 3–5", or "3 layers" while their places aren't known. */
export function layersName(rows: readonly Row[], layers: readonly number[]): string {
  const span = spanOf(rows, layers);
  return span === undefined ? `${layers.length} layers` : `Layers ${span}`;
}

/**
 * What the stack's tree says while `choice` is selected: the layer it started from, while it's one
 * layer; then which layers, and what they're compared with: the layer below the bottom one, or
 * `root`, the branch the stack sits on.
 */
export function choiceLine(
  rows: readonly Row[],
  root: string,
  choice: Choice,
): { readonly name: string | undefined; readonly from: string; readonly code: boolean } {
  const layers = chainIn(rows, choice.anchor, choice.end) ?? [choice.anchor];
  if (layers.length < 2) return { name: undefined, from: `#${choice.anchor}`, code: false };
  const bottom = rows.find((row) => row.number === layers[0])?.path ?? [];
  const below = bottom.at(-2);
  return {
    name: layersName(rows, layers),
    from: below === undefined ? root : `#${below}`,
    code: below === undefined,
  };
}
