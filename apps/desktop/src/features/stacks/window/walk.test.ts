// @vitest-environment jsdom
// What the stack's keys do in the window: `-` in the file tree, which goes up to the stack only
// when the view on screen has one; choosing a run of layers and showing it as one diff; and leaving
// a run on screen for the layer it was chosen from, which `]s` and `[s` go on from.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Row, StackView } from '../contract.ts';
import { choosing, focused, stacks } from './layers.ts';
import {
  back,
  cancel,
  choose,
  goUp,
  moveFocus,
  showTarget,
  upTo,
  upToReady,
  walking,
} from './walk.ts';

// The tab on screen, as the tab feature names it; the tab feature isn't loaded.
const on = vi.hoisted(() => ({ tab: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => on.tab,
  runViewOf: (_id: string, layers: readonly number[]) =>
    `t:${layers[0] ?? ''}-${layers.at(-1) ?? ''}`,
}));
const tree = vi.hoisted(() => ({ goToTree: vi.fn<(tab: string) => void>() }));
vi.mock('../../tree/window/shared.ts', () => tree);
const diff = vi.hoisted(() => ({ showDiff: vi.fn<(tab: string) => boolean>(() => true) }));
vi.mock('../../diff/window/shared.ts', () => diff);
const middle = vi.hoisted(() => ({
  escapeInMiddle: vi.fn<() => boolean>(() => false),
  focusMiddle: vi.fn<() => void>(),
  escapeToMiddle: vi.fn<() => void>(),
}));
vi.mock('../../../window/commands/registry.ts', () => middle);

const bridge = installBridge({
  'stacks.run': () => 'run',
  'tab.layer': () => 'shown',
});

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
  };
}

/** #82, #83 on it, #84 on #83, and #85, a second layer on #82. */
const STACK: StackView = {
  kind: 'stack',
  root: 'stack/root',
  githubStack: false,
  found: ['baseBranch', 'sharedCommits'],
  rows: [row(82, []), row(83, [82]), row(84, [82, 83]), row(85, [82])],
  notes: [],
  callout: null,
};

let views = 0;

/** A view of pull request `number` on screen, new for each test, with `stack` its stack. */
function showing(number: number, stack: StackView, run?: PullTab['run']): PullTab {
  views += 1;
  const tab: PullTab = {
    id: `t${views}`,
    kind: 'pull',
    owner: 'rozed-dev',
    repo: 'e2e',
    number,
    ...(run ? { run } : {}),
  };
  on.tab = tab;
  stacks.set(tab.id, stack);
  return tab;
}

/** Lets the window hear main's answer. */
const answered = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  bridge.calls.length = 0;
  vi.clearAllMocks();
  middle.escapeInMiddle.mockReturnValue(false);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('- in the file tree', () => {
  it('goes back to the file on screen in the tree for a pull request that isn’t in a stack', () => {
    const tab = showing(7, { kind: 'none' });
    goUp();
    expect(tree.goToTree).toHaveBeenCalledWith(tab.id);
    // Nor while Lo is still looking for one.
    const looking = showing(8, { kind: 'unknown' });
    goUp();
    expect(tree.goToTree).toHaveBeenLastCalledWith(looking.id);
  });

  it('goes up to the stack’s tree, at the layer on screen, when the view has one', () => {
    const tab = showing(84, STACK);
    const drawn = document.createElement('div');
    drawn.dataset['loScope'] = 'stack';
    drawn.tabIndex = 0;
    document.body.append(drawn);
    goUp();
    expect(tree.goToTree).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(drawn);
    expect(focused.get(tab.id)).toBe(84);
  });
});

describe('choosing a run of layers', () => {
  it('starts at a layer, grows along its branch with j and k, and shows on its diff with ⏎', async () => {
    const tab = showing(83, STACK);
    choose({ kind: 'layer', layer: 83 });
    moveFocus(1);
    // #85 is on another branch: j stays at #84.
    moveFocus(1);
    expect(choosing.get(tab.id)).toEqual({ anchor: 83, end: 84 });
    expect(focused.get(tab.id)).toBe(84);
    moveFocus(-1);
    moveFocus(-1);
    expect(choosing.get(tab.id)).toEqual({ anchor: 83, end: 82 });
    showTarget({ kind: 'layer', layer: 82 });
    await answered();
    expect(diff.showDiff).toHaveBeenCalledWith('t:82-83');
    expect(bridge.calls).toEqual([['stacks.run', { id: tab.id, bottom: 82, top: 83 }]]);
    expect(choosing.get(tab.id)).toBeUndefined();
  });

  it('stops with Esc, the keyboard staying where it is, and Esc then goes to the middle', () => {
    const tab = showing(83, STACK);
    choose({ kind: 'layer', layer: 83 });
    moveFocus(1);
    cancel();
    expect(choosing.get(tab.id)).toBeUndefined();
    expect(focused.get(tab.id)).toBe(84);
    expect(middle.escapeToMiddle).not.toHaveBeenCalled();
    cancel();
    expect(middle.escapeToMiddle).toHaveBeenCalledOnce();
  });

  it('shows the layer alone while only one is chosen', async () => {
    const tab = showing(84, STACK);
    choose({ kind: 'layer', layer: 83 });
    showTarget({ kind: 'layer', layer: 83 });
    await answered();
    expect(bridge.calls).toEqual([['tab.layer', { id: tab.id, number: 83 }]]);
  });

  it('views the stack up to a layer from its bottom, and not from the bottom layer itself', async () => {
    const tab = showing(85, STACK);
    expect(upToReady({ kind: 'layer', layer: 82 })).toBe(
      "#82 is the stack's bottom layer, so the stack up to it is that layer alone.",
    );
    upTo({ kind: 'layer', layer: 84 });
    await answered();
    expect(bridge.calls).toEqual([['stacks.run', { id: tab.id, bottom: 82, top: 84 }]]);
  });
});

describe('a run of layers on screen', () => {
  const run = { layers: [83, 84], start: 'a'.repeat(40), from: 83 };

  it('walks on with ]s and [s from the layer it was chosen from, its top one too', async () => {
    const tab = showing(84, STACK, run);
    walking(1).run();
    await answered();
    expect(bridge.calls).toEqual([['tab.layer', { id: tab.id, number: 84 }]]);
  });

  it('goes back to that layer with Esc once the diff has nothing of its own to close', async () => {
    const tab = showing(84, STACK, run);
    middle.escapeInMiddle.mockReturnValueOnce(true);
    back();
    await answered();
    expect(bridge.calls).toEqual([]);
    back();
    await answered();
    expect(bridge.calls).toEqual([['tab.layer', { id: tab.id, number: 83 }]]);
    // A layer's own view: Esc gives the middle focus, as anywhere.
    showing(84, STACK);
    back();
    expect(middle.focusMiddle).toHaveBeenCalledOnce();
  });
});
