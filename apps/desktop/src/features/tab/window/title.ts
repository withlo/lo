// The window's title: the pull request on screen's, or Lo's name while another kind of tab is.

import type { Tab } from '../contract.ts';

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
  return `${title} · ${where}, stack on ${root}`;
}

/** "1 layer", "5 layers". */
function layerCount(count: number): string {
  return count === 1 ? '1 layer' : `${count} layers`;
}

/**
 * `text` without the characters that turn the direction of the text after them around until
 * they're closed (embeddings, overrides and isolates), which a pull request's author could use to
 * make its title read as something else. The marks right-to-left text places numbers and
 * punctuation with (LRM, RLM, ALM) stay: they change no more than their neighbours.
 */
export function withoutBidi(text: string): string {
  return text.replaceAll(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

/** The window's title while `tab` is on screen. */
export function windowTitle(tab: Tab | undefined): string {
  if (tab?.kind !== 'pull') return NO_PULL_REQUEST;
  return forPullRequest(`${tab.owner}/${tab.repo}`, tab.number, tab.title);
}
