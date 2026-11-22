// Choosing a run of layers in the stack's tree: a chain only, `j` and `k` skipping the layers on
// other branches, and what the tree says while it's chosen.

import { describe, expect, it } from 'vitest';

import type { Row } from '../contract.ts';
import { chainIn, choiceLine, layersName, spanOf, stepChoice, type Choice } from './runs.ts';

/** A row of layer `number`, on the layers in `below`, as main sends it. */
function row(number: number, below: number[]): Row {
  return {
    number,
    title: `#${number}`,
    author: 'rozed-bot',
    head: `stack/${number}`,
    state: 'open',
    current: false,
    branch: false,
    on: null,
    path: [...below, number],
    review: null,
    checks: null,
    queue: null,
    needsRebase: false,
    overview: null,
    viewed: null,
    threads: null,
  };
}

/** #82, #83 on it, #84 on #83, and #85, a second layer on #82, in the tree's order. */
const ROWS: Row[] = [row(82, []), row(83, [82]), row(84, [82, 83]), row(85, [82])];

/** A run started at `anchor`, its other end at `end`. */
function from(anchor: number, end = anchor): Choice {
  return { anchor, end };
}

describe('a run of layers being chosen', () => {
  it('is the chain between its ends, bottom first, either way it was chosen', () => {
    expect(chainIn(ROWS, 83, 84)).toEqual([83, 84]);
    expect(chainIn(ROWS, 84, 82)).toEqual([82, 83, 84]);
    expect(chainIn(ROWS, 85, 82)).toEqual([82, 85]);
    expect(chainIn(ROWS, 83, 83)).toEqual([83]);
    // On two branches of the stack, no one diff shows them.
    expect(chainIn(ROWS, 84, 85)).toBeUndefined();
    // A layer that merged has no path, and isn't one.
    expect(chainIn([...ROWS, { ...row(86, []), path: [] }], 82, 86)).toBeUndefined();
  });

  it('moves its end with j and k along its branch, skipping the layers on other branches', () => {
    // From #83, j reaches #84, and #85, on another branch, is skipped: #84 is the end.
    expect(stepChoice(ROWS, from(83), 1)).toEqual(from(83, 84));
    expect(stepChoice(ROWS, from(83, 84), 1)).toEqual(from(83, 84));
    // k goes back through where it started, and on down.
    expect(stepChoice(ROWS, from(83, 84), -1)).toEqual(from(83, 83));
    expect(stepChoice(ROWS, from(83), -1)).toEqual(from(83, 82));
    // From #85, k skips #84 and #83 for #82.
    expect(stepChoice(ROWS, from(85), -1)).toEqual(from(85, 82));
    expect(stepChoice(ROWS, from(82), 1)).toEqual(from(82, 83));
  });

  it('never drops a layer it holds for one on another branch, and stays at the branch’s end', () => {
    // From #82, j takes #83, the first layer on it, then #84, then stays: #85 would drop both.
    let choice = from(82);
    const ends = [1, 1, 1].map(() => {
      choice = stepChoice(ROWS, choice, 1);
      return choice.end;
    });
    expect(ends).toEqual([83, 84, 84]);
    // k shrinks it back the same way, and from the stack's bottom it stays.
    expect(stepChoice(ROWS, from(82, 84), -1)).toEqual(from(82, 83));
    expect(stepChoice(ROWS, from(82, 83), -1)).toEqual(from(82, 82));
    expect(stepChoice(ROWS, from(82), -1)).toEqual(from(82, 82));
    // From #84 down to #82, j shrinks it from the bottom, toward where it started.
    expect(stepChoice(ROWS, from(84, 82), 1)).toEqual(from(84, 83));
  });

  it('says which layers, by their places in the stack, and what they’re compared with', () => {
    expect(choiceLine(ROWS, 'stack/root', { anchor: 83, end: 84 })).toEqual({
      name: 'Layers 2–3',
      from: '#82',
      code: false,
    });
    expect(choiceLine(ROWS, 'stack/root', { anchor: 84, end: 82 })).toEqual({
      name: 'Layers 1–3',
      from: 'stack/root',
      code: true,
    });
    expect(choiceLine(ROWS, 'stack/root', { anchor: 85, end: 85 })).toEqual({
      name: undefined,
      from: '#85',
      code: false,
    });
    expect(spanOf(ROWS, [82, 85])).toBe('1–2');
    expect(spanOf(ROWS, [83])).toBe('2');
    expect(layersName(ROWS, [82, 83, 84])).toBe('Layers 1–3');
    // Layers the rows don't hold are only counted.
    expect(layersName(ROWS, [90, 91])).toBe('2 layers');
  });
});
