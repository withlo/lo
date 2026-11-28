// @vitest-environment jsdom
// What the stack's keys do in the window: `-` in the file tree, which goes up to the stack only
// when the view on screen has one; choosing a run of layers and showing it as one diff; and leaving
// a run on screen for the layer it was chosen from, which `]s` and `[s` go on from, as they go on
// from a layer asked for that main hasn't shown yet.

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Row, StackView } from '../contract.ts';
import { choosing, focused, OVERVIEW_ROW, OVERVIEW_TARGET, runTrouble, stacks } from './layers.ts';
import {
  back,
  backable,
  branchFor,
  cancel,
  choose,
  goDown,
  goUp,
  moveFocus,
  runAgain,
  showable,
  showName,
  showStackAt,
  showTarget,
  stackTarget,
  upTo,
  upToNamed,
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
const diff = vi.hoisted(() => ({
  showDiff: vi.fn<(tab: string) => boolean>(() => true),
  showPlace: vi.fn<(tab: string, path: string, line?: number, marked?: unknown) => void>(),
}));
vi.mock('../../diff/window/shared.ts', () => diff);
// The overview, as the stack's tree sees it: which views' stacks have an overview, and which views
// show it.
const overview = vi.hoisted(() => {
  const present = new Set<string>();
  const subjects = new Map<string, 'pull' | 'stack'>();
  return {
    present,
    subjects,
    hasStackOverview: (id: string) => present.has(id),
    showStackOverview: (tab: { id: string }) => {
      if (!present.has(tab.id)) return false;
      subjects.set(tab.id, 'stack');
      return true;
    },
    showOwnOverview: (id: string) => {
      subjects.set(id, 'pull');
    },
  };
});
vi.mock('../../overview/window/shared.ts', () => overview);
const middle = vi.hoisted(() => {
  const run = vi.fn<(id: string, target: unknown) => void>();
  return {
    escapeInMiddle: vi.fn<() => boolean>(() => false),
    canEscape: vi.fn<(focused: Element | null) => boolean>(() => true),
    focusMiddle: vi.fn<() => void>(),
    escapeToMiddle: vi.fn<() => void>(),
    run,
    here: () => undefined,
    registry: () => ({ run, history: { record: vi.fn<(entry: unknown) => void>() } }),
  };
});
vi.mock('../../../window/commands/registry.ts', () => middle);
vi.mock('../../../window/commands/overlays.tsx', () => ({ askedFrom: () => document.body }));

/** The layer whose head is the commit a stack overview describes, as main finds it. */
const described = vi.hoisted(() => ({ layer: null as number | null }));
const bridge = installBridge({
  'stacks.run': () => 'run',
  'stacks.layerAt': () => described.layer,
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
    threads: null,
  };
}

/** #82, #83 on it, #84 on #83, and #85, a second layer on #82. */
const STACK: StackView = {
  kind: 'stack',
  root: 'stack/root',
  start: null,
  githubStack: false,
  rows: [row(82, []), row(83, [82]), row(84, [82, 83]), row(85, [82])],
  notes: [],
  offered: true,
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

/** Waits two frames, as long as the left panel takes to show its tree. */
const twoFrames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

beforeEach(() => {
  bridge.calls.length = 0;
  vi.clearAllMocks();
  middle.escapeInMiddle.mockReturnValue(false);
  overview.present.clear();
  overview.subjects.clear();
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

/** The stack's overview, which Lo has read. */
function withOverview(tab: PullTab): void {
  overview.present.add(tab.id);
}

describe('the stack overview’s row', () => {
  it('is first for j and k while the stack has an overview, and ⏎ there shows it', () => {
    const tab = showing(82, STACK);
    moveFocus(-1);
    // None yet: the bottom layer is as far as the keyboard goes.
    expect(stackTarget(tab)).toEqual({ kind: 'layer', layer: 82 });
    expect(showable(OVERVIEW_TARGET)).toBe('No stack overview yet');
    withOverview(tab);
    moveFocus(-1);
    expect(focused.get(tab.id)).toBe(OVERVIEW_ROW);
    expect(stackTarget(tab)).toEqual(OVERVIEW_TARGET);
    moveFocus(-1);
    expect(stackTarget(tab)).toEqual(OVERVIEW_TARGET);
    expect(showable(OVERVIEW_TARGET)).toBe(true);
    expect(showName(OVERVIEW_TARGET)).toBe('Show stack overview');
    expect(showName({ kind: 'layer', layer: 82 })).toBe(undefined);
    showTarget(OVERVIEW_TARGET);
    expect(overview.subjects.get(tab.id)).toBe('stack');
    moveFocus(1);
    expect(stackTarget(tab)).toEqual({ kind: 'layer', layer: 82 });
  });

  it('gives way to the layer’s own overview as a layer is shown', async () => {
    const tab = showing(82, STACK);
    withOverview(tab);
    overview.subjects.set(tab.id, 'stack');
    showTarget({ kind: 'layer', layer: 82 });
    expect(overview.subjects.get(tab.id)).toBe('pull');
    // Another layer's view shows that layer's own too.
    overview.subjects.set('shown', 'stack');
    showTarget({ kind: 'layer', layer: 83 });
    await answered();
    expect(overview.subjects.get('shown')).toBe('pull');
  });
});

describe('a stack overview’s code', () => {
  const COMMIT = 'c'.repeat(40);

  it('goes up to the layer whose head the overview describes, as one diff, at its lines', async () => {
    described.layer = 85;
    const tab = showing(84, STACK);
    showStackAt(tab, 'src/limits.ts', { start: 3, end: 9 }, COMMIT);
    await answered();
    await answered();
    expect(bridge.calls).toContainEqual(['stacks.layerAt', { id: tab.id, commit: COMMIT }]);
    expect(bridge.calls).toContainEqual(['stacks.run', { id: tab.id, bottom: 82, top: 85 }]);
    expect(diff.showPlace).toHaveBeenCalledWith('run', 'src/limits.ts', 3, { from: 3, to: 9 });
  });

  it('goes up the branch the writer goes up when no layer’s head is the commit', async () => {
    described.layer = null;
    const tab = showing(84, STACK);
    showStackAt(tab, 'src/limits.ts', undefined, COMMIT);
    await answered();
    await answered();
    expect(bridge.calls).toContainEqual(['stacks.run', { id: tab.id, bottom: 82, top: 84 }]);
    expect(diff.showPlace).toHaveBeenCalledWith('run', 'src/limits.ts', undefined, undefined);
  });

  it('goes through the lowest-numbered layer wherever two sit on one, to the top', () => {
    const rows = [row(90, []), row(95, [90]), row(91, [90]), row(93, [90, 91]), row(92, [90, 91])];
    expect(branchFor(rows, undefined)).toEqual([90, 91, 92]);
    expect(branchFor(rows, 93)).toEqual([90, 91, 93]);
    expect(branchFor(rows, 95)).toEqual([90, 95]);
    // A layer the stack doesn't have isn't the top, nor one that merged, which is in no branch.
    expect(branchFor(rows, 7)).toEqual([90, 91, 92]);
    const merged = { ...row(94, []), path: [] };
    expect(branchFor([...rows, merged], 94)).toEqual([90, 91, 92]);
    expect(branchFor([], undefined)).toEqual([]);
  });
});

describe('+ in the stack’s tree', () => {
  it('goes down to the file tree, at the file on screen, while the tree is open', () => {
    const tab = showing(84, STACK);
    const files = document.createElement('div');
    files.dataset['loScope'] = 'tree';
    document.body.append(files);
    expect(goDown.enabled()).toBe(true);
    goDown.run();
    expect(tree.goToTree).toHaveBeenCalledWith(tab.id);
    expect(middle.run).not.toHaveBeenCalled();
  });

  it('shows the left panel first while it’s hidden', async () => {
    const tab = showing(84, STACK);
    expect(goDown.enabled()).toBe(true);
    goDown.run();
    expect(middle.run).toHaveBeenCalledWith('tab.leftPanel', { kind: 'none' });
    expect(tree.goToTree).not.toHaveBeenCalled();
    await twoFrames();
    expect(tree.goToTree).toHaveBeenCalledWith(tab.id);
  });
});

describe(']s and [s with a count', () => {
  it('go that many layers, each branch finished before the next, as far as the end', async () => {
    const tab = showing(82, STACK);
    walking(1).run(undefined, 2);
    walking(1).run(undefined, 9);
    await answered();
    expect(bridge.calls).toEqual([
      ['tab.layer', { id: tab.id, number: 84 }],
      ['tab.layer', { id: tab.id, number: 85 }],
    ]);
    const top = showing(85, STACK);
    walking(-1).run(undefined, 2);
    await answered();
    expect(bridge.calls.at(-1)).toEqual(['tab.layer', { id: top.id, number: 83 }]);
  });
});

describe(']s again before main has answered', () => {
  it('goes on from the layer asked for, not the one still on screen', async () => {
    const tab = showing(82, STACK);
    walking(1).run();
    walking(1).run();
    await answered();
    expect(bridge.calls).toEqual([
      ['tab.layer', { id: tab.id, number: 83 }],
      ['tab.layer', { id: tab.id, number: 84 }],
    ]);
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

  it('shows the layers up to a layer from its bottom, and not from the bottom layer itself', async () => {
    const tab = showing(85, STACK);
    expect(upToReady({ kind: 'layer', layer: 82 })).toBe('#82 is the bottom layer');
    expect(upToNamed({ kind: 'layer', layer: 84 })).toBe('Show layers 1–3');
    upTo({ kind: 'layer', layer: 84 });
    await answered();
    expect(bridge.calls).toEqual([['stacks.run', { id: tab.id, bottom: 82, top: 84 }]]);
  });
});

describe('a run of layers that couldn’t be shown', () => {
  it('is tried again from its problem, with focus put in the stack’s tree as the problem goes', async () => {
    const tab = showing(83, STACK);
    const stackTree = document.createElement('div');
    stackTree.dataset['loScope'] = 'stack';
    stackTree.tabIndex = -1;
    document.body.append(stackTree);
    runTrouble.set(tab.id, {
      title: 'Couldn’t show layers 1–2',
      details: 'down',
      layers: [82, 83],
    });
    runAgain(tab);
    expect(document.activeElement).toBe(stackTree);
    expect(runTrouble.get(tab.id)).toBeUndefined();
    await answered();
    expect(bridge.calls).toEqual([['stacks.run', { id: tab.id, bottom: 82, top: 83 }]]);
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

  it('is there to go back with, and elsewhere only where Esc would do anything', () => {
    // Focus where the diff puts it, and nothing open.
    middle.canEscape.mockReturnValue(false);
    onTestFinished(() => {
      middle.canEscape.mockReturnValue(true);
    });
    showing(84, STACK, run);
    expect(backable()).toBe(true);
    // A layer's own view: nothing to say.
    showing(84, STACK);
    expect(backable()).toBe('');
    expect(middle.canEscape).toHaveBeenLastCalledWith(document.body);
    middle.canEscape.mockReturnValue(true);
    expect(backable()).toBe(true);
  });
});
