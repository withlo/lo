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
    threads: null,
  };
}

const VIEW: StackView = {
  kind: 'stack',
  root: 'stack/root',
  githubStack: false,
  rows: [row(82, []), row(83, [82]), row(84, [82, 83], 'stack/c‮'), row(85, [82])],
  notes: [],
  offered: true,
  callout: null,
};

const START = 'a'.repeat(40);

describe('the bar over a run of layers', () => {
  it('names its layers by their span, and goes from the head of the layer below to its top layer’s', () => {
    expect(barOf({ layers: [83, 84], start: START, from: 84 }, VIEW)).toEqual({
      layers: [
        { number: 83, title: 'Layer 83' },
        { number: 84, title: 'Layer 84' },
      ],
      name: 'Layers 2–3',
      branches: { from: 'stack/82', to: 'stack/c' },
      problem: undefined,
    });
    // From the stack's bottom, it starts at the branch the stack sits on.
    expect(barOf({ layers: [82, 85], start: START, from: 85 }, VIEW).branches).toEqual({
      from: 'stack/root',
      to: 'stack/85',
    });
  });

  it('says the layers can’t show as one diff, and the top one shows alone, while GitHub couldn’t compare them', () => {
    const run = { layers: [83, 84], start: START, from: 84 };
    expect(barOf(run, VIEW).problem).toBeUndefined();
    expect(barOf(run, VIEW, true).problem).toEqual({
      title: 'Can’t show layers 2–3 as one diff',
      reason: 'Showing #84 alone.',
    });
  });

  it('names its layers by number, and counts them, until the stack is known', () => {
    expect(barOf({ layers: [83, 84], start: START, from: 84 }, undefined)).toEqual({
      layers: [
        { number: 83, title: undefined },
        { number: 84, title: undefined },
      ],
      name: '2 layers',
      branches: undefined,
      problem: undefined,
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
