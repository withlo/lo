// The window's title: the pull request on screen's, and where it is in its stack, or the run of
// its stack's layers on screen as one diff, or Lo's name while another kind of tab is.

import { layerOf, type Tab } from '../contract.ts';
import { withoutBidi } from './shared.ts';

export { withoutBidi };

/** The title while no pull request is on screen. */
export const NO_PULL_REQUEST = 'Lo';

/** Where a tab's pull request sits in the stack the tab shows. */
export interface StackPosition {
  /** The branch the bottom layer sits on. */
  readonly root: string;
  /** The tab's own layer, from 1, while it's a layer. */
  readonly layer?: number | undefined;
  readonly layers: number;
}

/** `owner/repo#n — title`, or `owner/repo#n` until its title is known. */
export function forPullRequest(repository: string, number: number, title?: string): string {
  return title === undefined
    ? `${repository}#${number}`
    : `${repository}#${number} — ${withoutBidi(title)}`;
}

/** `title`, a pull request's, for a layer of a stack: where it is, and what the stack sits on. */
export function inStack(title: string, { root, layer, layers }: StackPosition): string {
  const where = layer === undefined ? layerCount(layers) : `layer ${layer} of ${layers}`;
  return `${title} · ${where}, stack on ${withoutBidi(root)}`;
}

/** "1 layer", "5 layers". */
function layerCount(count: number): string {
  return count === 1 ? '1 layer' : `${count} layers`;
}

/** `owner/repo#83 to #84 — 2 layers as one diff`, for a run of a stack's layers, bottom first. */
export function forRun(repository: string, layers: readonly number[]): string {
  return `${repository}#${layers[0] ?? ''} to #${layers.at(-1) ?? ''} — ${layerCount(layers.length)} as one diff`;
}

/**
 * The window's title while `tab` is on screen: its layer on screen's, and, once the stack it's in
 * is known, where in the stack it is; or the run of the stack's layers it shows as one diff.
 */
export function windowTitle(tab: Tab | undefined): string {
  if (tab?.kind !== 'pull') return NO_PULL_REQUEST;
  if (tab.run) {
    const run = forRun(`${tab.owner}/${tab.repo}`, tab.run.layers);
    return tab.stack ? `${run}, stack on ${withoutBidi(tab.stack.root)}` : run;
  }
  const layer = layerOf(tab);
  const title = forPullRequest(`${tab.owner}/${tab.repo}`, layer, tab.title);
  const { stack } = tab;
  if (!stack) return title;
  const at = stack.layers.indexOf(layer);
  return inStack(title, {
    root: stack.root,
    layer: at < 0 ? undefined : at + 1,
    layers: stack.layers.length,
  });
}
