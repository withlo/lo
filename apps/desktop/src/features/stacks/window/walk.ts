// What the stack's keys and clicks do: `]s` and `[s` show the next and previous layer, `-` in the
// file tree goes up to the stack's tree, and there the keyboard moves from layer to layer, shows
// one, opens one on GitHub, or makes the chain through one a GitHub stack. A layer shows in its
// tab, which keeps a view of each layer shown, so each keeps its place; showing one isn't a jump.

import type { Target } from '@lo/ui/commands';

import { client } from '../../../window/ipc.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { activeTab, pullOf, type PullTab } from '../../tab/window/shared.ts';
import { makeStack } from './actions.ts';
import { focused, keyboardLayer, layersOf, stacks, stepFrom } from './layers.ts';

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
  if (number === tab.number) return Promise.resolve(tab.id);
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

/** Where `]s` (`by` 1) or `[s` (-1) goes from the layer on screen, or why it can't. */
function stepOnScreen(by: 1 | -1): { tab: PullTab; layer: number } | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  const view = stacks.get(tab.id);
  if (view?.kind !== 'stack' && pullOf(tab.id)?.acting?.kind === 'anonymous') {
    return `Sign in to see the stack #${tab.number} is in.`;
  }
  const step = stepFrom(view, tab.number, by);
  return 'why' in step ? step.why : { tab, layer: step.layer };
}

/** `]s` and `[s`: show the next or previous layer, unless it's the last or the first. */
export function walking(by: 1 | -1) {
  return {
    run: () => {
      const step = stepOnScreen(by);
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

/** `-` in the file tree: goes up to the stack's tree, at the layer on screen. */
export function goToStack(): void {
  const tab = pullOnScreen();
  const tree = treeOnScreen();
  if (typeof tab === 'string' || !tree) return;
  focused.set(tab.id, tab.number);
  tree.focus();
}

/** Whether the stack's tree is on screen to go to, or why not. */
export function stackShown(): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  if (treeOnScreen()) return true;
  return stacks.get(tab.id)?.kind === 'stack'
    ? 'The left panel is closed.'
    : `#${tab.number} isn't in a stack.`;
}

/** `j` and `k` in the stack's tree: moves the keyboard a layer, stopping at the ends. */
export function moveFocus(by: 1 | -1): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const layers = layersOf(stacks.get(tab.id));
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

/** `⏎` in the stack's tree, a click, or Show on a layer's menu: shows the layer. */
export function showTarget(target: Target): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || target.kind !== 'layer') return;
  focused.set(tab.id, target.layer);
  void showLayer(tab, target.layer);
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
