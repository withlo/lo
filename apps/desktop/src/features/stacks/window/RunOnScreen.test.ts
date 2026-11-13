// @vitest-environment jsdom
// What the bar over a run of layers on screen says of it, from its stack.

import { describe, expect, it } from 'vitest';

import type { Row, StackView } from '../contract.ts';
import { barOf } from './RunOnScreen.tsx';
import { bandOf } from './Stack.tsx';

function row(number: number, below: number[], head = `stack/${number}`): Row {
  return {
    number,
    title: `Layer ${number}`,
    author: 'rozed-bot',
    head,
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
  };
}

const VIEW: StackView = {
  kind: 'stack',
  root: 'stack/root',
  found: ['baseBranch', 'sharedCommits'],
  rows: [row(82, []), row(83, [82]), row(84, [82, 83], 'stack/c‮'), row(85, [82])],
  notes: [],
  callout: null,
};

const START = 'a'.repeat(40);

describe('the bar over a run of layers', () => {
  it('names its layers, and goes from the head of the layer below to its top layer’s', () => {
    expect(barOf({ layers: [83, 84], start: START, from: 84 }, VIEW)).toEqual({
      layers: [
        { number: 83, title: 'Layer 83' },
        { number: 84, title: 'Layer 84' },
      ],
      branches: { from: 'stack/82', to: 'stack/c' },
    });
    // From the stack's bottom, it starts at the branch the stack sits on.
    expect(barOf({ layers: [82, 85], start: START, from: 85 }, VIEW).branches).toEqual({
      from: 'stack/root',
      to: 'stack/85',
    });
  });

  it('says only the top layer’s pull request shows while GitHub couldn’t compare the run', () => {
    const run = { layers: [83, 84], start: START, from: 84 };
    expect(barOf(run, VIEW).instead).toBeUndefined();
    expect(barOf(run, VIEW, true).instead).toBe(
      'Only #84’s pull request: GitHub couldn’t compare the run as one diff',
    );
  });

  it('names its layers by number until the stack is known', () => {
    expect(barOf({ layers: [83, 84], start: START, from: 84 }, undefined)).toEqual({
      layers: [
        { number: 83, title: undefined },
        { number: 84, title: undefined },
      ],
      branches: undefined,
    });
  });

  it('bands its layers in the stack’s tree, rounding the two ends', () => {
    expect([...bandOf([82, 83, 84])]).toEqual([
      [82, 'start'],
      [83, 'middle'],
      [84, 'end'],
    ]);
    expect([...bandOf([85])]).toEqual([[85, 'only']]);
    expect(bandOf([]).size).toBe(0);
  });
});
