// Choosing a run of a stack's layers in its tree, to view as one diff: `v` starts one at the layer
// the keyboard is on, and `j` and `k` move its other end along the branch it's on, never onto
// another, since only a chain, each layer sitting on the one before, is one diff. Each row
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
