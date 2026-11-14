// What the stack's keys and clicks do: `]s` and `[s` show the next and previous layer, `-` in the
// file tree goes up to the stack's tree, and `+` back down, and there the keyboard moves from layer
// to layer, shows one, opens one on GitHub, or makes the chain through one a GitHub stack. A layer shows in its
// tab, which keeps a view of each layer shown, so each keeps its place; showing one isn't a jump.
//
// And runs of layers: `v` starts choosing one, `j` and `k` move its end along its branch, and `⏎`
// asks main for a view of it, which opens on its diff. `Esc`, or the bar over it, goes back to the
// layer it was chosen from, and `]s` and `[s` go on from that layer.

import type { Target } from '@lo/ui/commands';

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { escapeInMiddle, escapeToMiddle, focusMiddle } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import {
  activeTab,
  pullOf,
  runViewOf,
  withoutBidi,
  type PullTab,
} from '../../tab/window/shared.ts';
import { goToTree } from '../../tree/window/shared.ts';
import { makeStack } from './actions.ts';
import { choosing, focused, keyboardLayer, layersOf, stacks, stepFrom } from './layers.ts';
import { main } from './main.ts';
import { chainIn, stepChoice, type Choice } from './runs.ts';

const tabs = () => client(tabContract);

/** Where the stack's tree is on the DOM: the tab on screen's, the only one drawn. */
const TREE = '[data-lo-scope="stack"]';

/** The pull request's tab on screen, as its view on screen, or why a key for it can't run. */
export function pullOnScreen(): PullTab | string {
  const tab = activeTab();
  return tab?.kind === 'pull' ? tab : 'There’s no pull request on screen.';
}

/** The stack's tree on screen, if it's drawn. */
function treeOnScreen(): HTMLElement | undefined {
  const tree = document.querySelector(TREE);
  return tree instanceof HTMLElement ? tree : undefined;
}

/**
 * Whether the stack's tree takes focus back once the next view is drawn: it had it as the layer it
 * showed went, so the keyboard stays in the stack while it walks it.
 */
let refocus = false;

/** Whether the stack's tree should take focus as it's drawn, which it does once. */
export function takeRefocus(): boolean {
  const now = refocus;
  refocus = false;
  return now;
}

/**
 * Shows layer `number` in pull request's tab `tab`, named by its view on screen: its view of that
 * layer, made the first time. Focus in the stack's tree stays there, on the layer shown.
 */
export function showLayer(tab: PullTab, number: number): Promise<string | undefined> {
  // A run on screen is left for any of its layers, its top one too.
  if (number === tab.number && !tab.run) return Promise.resolve(tab.id);
  const tree = treeOnScreen();
  refocus = tree !== undefined && tree.contains(document.activeElement);
  return tabs()
    .layer({ id: tab.id, number })
    .catch((error: unknown) => {
      refocus = false;
      console.error("Lo couldn't show the layer:", error);
      return undefined;
    });
}

/**
 * Where `]s` (`by` 1) or `[s` (-1) goes from the layer on screen, or from a run's, the layer it was
 * chosen from, `count` layers on but no further than the last or the first, or why it can't go one.
 */
function stepOnScreen(by: 1 | -1, count = 1): { tab: PullTab; layer: number } | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  const view = stacks.get(tab.id);
  if (view?.kind !== 'stack' && pullOf(tab.id)?.acting?.kind === 'anonymous') {
    return `Sign in to see the stack #${tab.number} is in.`;
  }
  const step = stepFrom(view, tab.run?.from ?? tab.number, by);
  if ('why' in step) return step.why;
  let { layer } = step;
  for (let left = count - 1; left > 0; left--) {
    const further = stepFrom(view, layer, by);
    if ('why' in further) break;
    layer = further.layer;
  }
  return { tab, layer };
}

/**
 * `]s` and `[s`: show the next or previous layer, or with a count that many on, unless it's the last
 * or the first.
 */
export function walking(by: 1 | -1) {
  return {
    run: (_target?: unknown, count = 1) => {
      const step = stepOnScreen(by, count);
      if (typeof step !== 'string') void showLayer(step.tab, step.layer);
    },
    enabled: () => {
      const step = stepOnScreen(by);
      return typeof step === 'string' ? step : true;
    },
  };
}

/** The layer the keyboard is on in `tab`'s stack tree: the one it was put on, or the one on screen. */
export function focusedLayer(tab: PullTab): number | undefined {
  return keyboardLayer(stacks.get(tab.id), focused.get(tab.id), tab.number);
}

/** What a key in the stack's tree acts on: the layer the keyboard is on. */
export function stackTarget(tab: PullTab): Target {
  const layer = focusedLayer(tab);
  return layer === undefined ? { kind: 'none' } : { kind: 'layer', layer };
}

/**
 * `+` in the stack's tree: goes down to the file tree, at the file on screen, as `-` goes up, or
 * why it can't.
 */
export const goDown = {
  run(): void {
    const tab = pullOnScreen();
    if (typeof tab !== 'string') goToTree(tab.id);
  },
  enabled(): true | string {
    const tab = pullOnScreen();
    if (typeof tab === 'string') return tab;
    return document.querySelector('[data-lo-scope="tree"]') !== null
      ? true
      : 'The file tree isn’t open.';
  },
};

/**
 * `-` in the file tree: goes up to the stack's tree, at the layer on screen, when the view on screen
 * has one; otherwise it's `-` as in the code, back to the file on screen in the file tree.
 */
export function goUp(): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const tree = treeOnScreen();
  if (!tree) {
    goToTree(tab.id);
    return;
  }
  focused.set(tab.id, tab.number);
  tree.focus();
}

/**
 * `j` and `k` in the stack's tree: moves the keyboard a layer, stopping at the ends. While a run is
 * being chosen, they move its end along its branch, and the keyboard with it.
 */
export function moveFocus(by: 1 | -1): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const view = stacks.get(tab.id);
  const choice = choosing.get(tab.id);
  if (choice && view?.kind === 'stack') {
    const next = stepChoice(view.rows, choice, by);
    choosing.set(tab.id, next);
    focused.set(tab.id, next.end);
    return;
  }
  const layers = layersOf(view);
  const from = focusedLayer(tab);
  const at = from === undefined ? -1 : layers.indexOf(from);
  const next = layers[Math.min(Math.max(at + by, 0), layers.length - 1)];
  if (next !== undefined) focused.set(tab.id, next);
}

/** Whether `target` is a layer of the stack on screen, or why a command can't act on it. */
export function onLayer(target: Target): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  if (target.kind !== 'layer') return 'No layer has focus.';
  return layersOf(stacks.get(tab.id)).includes(target.layer)
    ? true
    : `#${target.layer} isn't in the stack on screen.`;
}

/**
 * `⏎` in the stack's tree, a click, or Show on a layer's menu: shows the layer. While a run is
 * being chosen, `⏎` shows it instead.
 */
export function showTarget(target: Target): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || target.kind !== 'layer') return;
  const choice = choosing.get(tab.id);
  if (choice) {
    choosing.set(tab.id, undefined);
    showChoice(tab, choice);
    return;
  }
  focused.set(tab.id, target.layer);
  void showLayer(tab, target.layer);
}

/** What notes about showing a run say they're about. */
export const RUN = 'View as one diff';

/** What went wrong asking main, in words to show: a branch's name may carry bidi controls. */
function whyNot(error: unknown): string {
  return error instanceof IpcError
    ? withoutBidi(error.message)
    : 'Lo couldn’t ask for it. Try again.';
}

/** Shows the run `choice` chose: as one diff, or, while it's one layer, that layer. */
function showChoice(tab: PullTab, choice: Choice): void {
  const view = stacks.get(tab.id);
  const layers = view?.kind === 'stack' ? chainIn(view.rows, choice.anchor, choice.end) : undefined;
  if (!layers || layers.length < 2) {
    focused.set(tab.id, choice.anchor);
    void showLayer(tab, choice.anchor);
    return;
  }
  openRun(tab, layers);
}

/**
 * Asks main for a view of the run of `layers`, bottom first, in `tab`, which opens on its diff, or
 * says why there's none.
 */
export function openRun(tab: PullTab, layers: readonly number[]): void {
  const [bottom] = layers;
  const top = layers.at(-1);
  if (bottom === undefined || top === undefined) return;
  // The view opens on its diff: it has no overview, and the diff is what it's for.
  const view = runViewOf(tab.id, layers);
  if (view !== undefined) showDiff(view);
  main()
    .run({ id: tab.id, bottom, top })
    .catch((error: unknown) => notify(RUN, whyNot(error)));
}

/** The row of layer `number` in the stack of `tab`, if it has one. */
function rowOf(tab: PullTab, number: number) {
  const view = stacks.get(tab.id);
  return view?.kind === 'stack' ? view.rows.find((row) => row.number === number) : undefined;
}

/** Whether a run can start at `target`, a layer of the stack on screen, or why not. */
export function choosable(target: Target): true | string {
  const on = onLayer(target);
  if (on !== true || target.kind !== 'layer') return on;
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  return (rowOf(tab, target.layer)?.path.length ?? 0) > 0
    ? true
    : `#${target.layer} isn't a layer of the stack now, so no run can hold it.`;
}

/**
 * `v` on a layer, or Choose a run from here on its menu: starts choosing a run there, in the
 * stack's tree, which has the keys.
 */
export function choose(target: Target): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || target.kind !== 'layer') return;
  choosing.set(tab.id, { anchor: target.layer, end: target.layer });
  focused.set(tab.id, target.layer);
  treeOnScreen()?.focus();
}

/** `Esc` in the stack's tree: stops choosing a run, or else goes back to the middle view. */
export function cancel(): void {
  const tab = pullOnScreen();
  if (typeof tab !== 'string' && choosing.get(tab.id) !== undefined) {
    choosing.set(tab.id, undefined);
    return;
  }
  escapeToMiddle();
}

/** Stops choosing a run in view `id`'s stack tree, as leaving the tree does. */
export function stopChoosing(id: string): void {
  if (choosing.get(id) !== undefined) choosing.set(id, undefined);
}

/** The layers from the stack's bottom up to `target`, in the tab on screen, or why there's no run. */
function stackUpTo(target: Target): { tab: PullTab; layers: readonly number[] } | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  if (target.kind !== 'layer') return 'No layer has focus.';
  const row = rowOf(tab, target.layer);
  if (!row) return `#${target.layer} isn't in the stack on screen.`;
  if (row.path.length === 0) return `#${target.layer} isn't a layer of the stack now.`;
  if (row.path.length < 2) {
    return `#${target.layer} is the stack's bottom layer, so the stack up to it is that layer alone.`;
  }
  return { tab, layers: row.path };
}

/** View the stack up to here as one diff, on a layer's menu. */
export function upTo(target: Target): void {
  const found = stackUpTo(target);
  if (typeof found === 'string') return;
  stopChoosing(found.tab.id);
  openRun(found.tab, found.layers);
}

/** Whether the stack up to `target` can show as one diff, or why not. */
export function upToReady(target: Target): true | string {
  const found = stackUpTo(target);
  return typeof found === 'string' ? found : true;
}

/** Goes back from the run on screen to the layer it was chosen from, as the bar's button does. */
export function leaveRun(): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || !tab.run) return;
  tabs()
    .layer({ id: tab.id, number: tab.run.from })
    .catch((error: unknown) => console.error("Lo couldn't go back to the layer:", error));
}

/**
 * `Esc` in the diff: what the diff has open closes first; then, in a run on screen, back to the
 * layer it was chosen from, and anywhere else, focus to the middle view, as `Esc` gives it anywhere.
 */
export function back(): void {
  if (escapeInMiddle()) return;
  const tab = pullOnScreen();
  if (typeof tab !== 'string' && tab.run) leaveRun();
  else focusMiddle();
}

/** `gx` on a layer: opens its pull request on github.com. */
export async function openOnGithub(target: Target): Promise<void> {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || target.kind !== 'layer') return;
  await tabs().openExternal({
    url: `https://github.com/${tab.owner}/${tab.repo}/pull/${target.layer}`,
  });
}

/**
 * `gS`: makes the chain through the layer on screen a GitHub stack, or, on a layer of the stack's
 * tree, the chain through that layer, which shows first, so the dialog is over the layer it's for.
 */
export async function convertTarget(target: Target): Promise<void> {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const layer = target.kind === 'layer' ? target.layer : tab.number;
  if (layer === tab.number) {
    makeStack(tab.id, layer);
    return;
  }
  focused.set(tab.id, layer);
  const view = await showLayer(tab, layer);
  if (view !== undefined) makeStack(view, layer);
}

/** Whether `gS` can act on `target` now, or why not: it needs a pull request on screen. */
export function convertible(target: Target): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  return target.kind === 'layer' ? onLayer(target) : true;
}
