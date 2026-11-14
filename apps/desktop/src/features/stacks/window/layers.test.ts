// Where `]s` and `[s` go from a layer, and the layer the keyboard is on in the stack's tree, from
// the rows main sends, in the order its tree lists them.

import { describe, expect, it } from 'vitest';

import type { Row, StackView } from '../contract.ts';
import { keyboardLayer, stepFrom } from './layers.ts';

/** A row of layer `number`, sitting on the layers before it in `path`, open, with nothing read. */
function row(number: number, path: number[], current = false): Row {
  return {
    number,
    title: `#${number}`,
    author: 'rozed-bot',
    head: `stack/${number}`,
    state: 'open',
    current,
    branch: false,
    on: null,
    path: [...path, number],
    review: null,
    checks: null,
    queue: null,
    needsRebase: false,
    overview: null,
    viewed: null,
    threads: null,
  };
}

/** #82, #83, #84 and #85, a second layer on #82, as main sends them, with #84 on screen. */
const STACK: StackView = {
  kind: 'stack',
  root: 'stack/root',
  githubStack: false,
  found: ['baseBranch', 'sharedCommits'],
  rows: [
    row(82, []),
    row(83, [82]),
    row(84, [82, 83], true),
    { ...row(85, [82]), branch: true, on: 82 },
  ],
  notes: [],
  callout: null,
};

describe(']s and [s', () => {
  it('go to the next and previous layer in the order the tree lists them, into a branch too', () => {
    expect(stepFrom(STACK, 84, 1)).toEqual({ layer: 85 });
    expect(stepFrom(STACK, 85, -1)).toEqual({ layer: 84 });
    expect(stepFrom(STACK, 83, -1)).toEqual({ layer: 82 });
  });

  it("don't go round, and say why at either end", () => {
    expect(stepFrom(STACK, 85, 1)).toEqual({ why: '#85 is the last layer.' });
    expect(stepFrom(STACK, 82, -1)).toEqual({ why: '#82 is the first layer.' });
  });

  it("say why there's nowhere to go without a stack", () => {
    expect(stepFrom({ kind: 'none' }, 87, 1)).toEqual({ why: "#87 isn't in a stack." });
    expect(stepFrom({ kind: 'unknown' }, 84, 1)).toEqual({
      why: 'Lo is still looking for the stack #84 is in.',
    });
    expect(stepFrom(undefined, 84, -1)).toEqual({
      why: 'Lo is still looking for the stack #84 is in.',
    });
    expect(stepFrom(STACK, 90, 1)).toEqual({ why: "#90 isn't in its stack now." });
  });
});

describe('the layer the keyboard is on', () => {
  it('is the one it was put on, or else the one on screen, or the first', () => {
    expect(keyboardLayer(STACK, 83, 84)).toBe(83);
    expect(keyboardLayer(STACK, undefined, 84)).toBe(84);
    // One that's no longer a layer.
    expect(keyboardLayer(STACK, 90, 84)).toBe(84);
    expect(keyboardLayer(STACK, undefined, 86)).toBe(82);
    expect(keyboardLayer({ kind: 'none' }, 83, 84)).toBeUndefined();
  });
});
