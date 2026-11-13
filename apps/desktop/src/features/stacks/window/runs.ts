// Choosing a run of a stack's layers in its tree, to view as one diff: `v` starts one at the layer
// the keyboard is on, and `j` and `k` move its other end along the branch it's on, past the layers
// on other branches, since only a chain, each layer sitting on the one before, is one diff. Each row
// main sends has its path from the stack's bottom, which is all a chain needs. Nothing here touches
// the DOM or main.

import type { Row } from '../contract.ts';

/** A run being chosen: the layer it started at, and the one its other end is at now. */
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
 * Where `j` (`by` 1) or `k` (-1) moves `choice`'s end: to the next row in the tree's order that's
 * on one branch with where it started, skipping the rest. At either end of that branch it stays.
 */
export function stepChoice(rows: readonly Row[], choice: Choice, by: 1 | -1): Choice {
  const at = rows.findIndex((row) => row.number === choice.end);
  if (at < 0) return choice;
  for (let index = at + by; index >= 0 && index < rows.length; index += by) {
    const row = rows[index];
    if (row && chainIn(rows, choice.anchor, row.number)) return { ...choice, end: row.number };
  }
  return choice;
}

/** "#83", "#83 and #84", "#82, #83 and #84". */
export function numbered(layers: readonly number[]): string {
  const names = layers.map((number) => `#${number}`);
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** The keys the note names, as this system shows them. */
export interface NoteKeys {
  /** `⏎`, which shows the run. */
  readonly show: string;
  /** `Esc`, which stops choosing. */
  readonly cancel: string;
  /** `j` and `k`, which move its end. */
  readonly down: string;
  readonly up: string;
}

/**
 * What the stack's tree says while `choice` is being chosen: which layers, what they're compared
 * with (the top of the layer below the bottom one, or the tip of `root`, the branch the stack sits
 * on), and what the keys do.
 */
export function choiceNote(
  rows: readonly Row[],
  root: string,
  choice: Choice,
  keys: NoteKeys,
): string {
  const layers = chainIn(rows, choice.anchor, choice.end) ?? [choice.anchor];
  if (layers.length < 2) {
    return `A run from #${choice.anchor}: ${keys.down} and ${keys.up} add the layers above or below it on its branch, and ${keys.cancel} stops.`;
  }
  const bottom = rows.find((row) => row.number === layers[0])?.path ?? [];
  const below = bottom.at(-2);
  const from = below === undefined ? `the tip of ${root}` : `the top of #${below}`;
  return `${numbered(layers)}, compared with ${from}. ${keys.show} shows them as one diff; ${keys.cancel} goes back to one layer.`;
}
