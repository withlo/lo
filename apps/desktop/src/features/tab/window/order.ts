// Moving tabs along the strip: a place at a time by key or from a tab's right-click menu, or to
// where a tab is dragged. Main keeps the order, so it comes back after Lo restarts. A screen reader
// hears where the tab went.

import type { NoTarget, TabTarget } from '@lo/ui/commands';
import { createStore } from 'zustand/vanilla';

import type { Moved, Tab } from '../contract.ts';
import { main } from './main.ts';
import { tabsStore, type TabsState } from './store.ts';

/** What the strip last said of a tab it moved, for a screen reader. */
export const movedStore = createStore<{ readonly said: string }>()(() => ({ said: '' }));

/** A tab's name, as the strip shows it. */
function nameOf(tab: Tab): string {
  switch (tab.kind) {
    case 'pull':
      return `${tab.repo} #${tab.number}`;
    case 'recent':
      return 'Recent pull requests';
    case 'settings':
      return 'Settings';
    default:
      tab satisfies never;
      throw new Error(`A tab of an unknown kind: ${JSON.stringify(tab)}.`);
  }
}

/** What's said of `tab` at `place`, from 0, among `count` tabs: "fd #2212 is now tab 2 of 3." */
export function saidOf(tab: Tab, place: number, count: number): string {
  return `${nameOf(tab)} is now tab ${place + 1} of ${count}.`;
}

/**
 * Why the tab `target` names, or the one on screen, can't move a place by `by` among `state`'s
 * tabs, or `true` when it can. It doesn't go round the ends.
 */
export function movable(
  { tabs, active }: TabsState,
  target: TabTarget | NoTarget,
  by: 1 | -1,
): true | string {
  const id = target.kind === 'tab' ? target.tab : active;
  const at = tabs.findIndex((tab) => tab.id === id);
  const tab = tabs[at];
  if (!tab) return "That tab isn't open.";
  if (tab.kind === 'recent') {
    return "Recent pull requests can't move: it shows while no other tab is open.";
  }
  if (at + by < 0) return 'The tab is first in the strip already.';
  if (at + by >= tabs.length) return 'The tab is last in the strip already.';
  return true;
}

/** Says where a moved tab is now. */
function say(moved: Moved | undefined): void {
  if (!moved) return;
  const { tabs } = tabsStore.getState();
  const tab = tabs.find((each) => each.id === moved.id);
  if (tab) movedStore.setState({ said: saidOf(tab, moved.place, tabs.length) });
}

/**
 * Moves the tab `target` names a place by `by`, or the one on screen as main has it, so two quick
 * presses move it two places.
 */
export async function stepTab(target: TabTarget | NoTarget, by: 1 | -1): Promise<void> {
  say(await main().move(target.kind === 'tab' ? { id: target.tab, step: by } : { step: by }));
}

/** Moves a tab dragged along the strip to place `to`, from 0, counted without it. */
export async function dropTab(id: string, to: number): Promise<void> {
  say(await main().move({ id, to }));
}
