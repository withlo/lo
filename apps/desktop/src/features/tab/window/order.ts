// Moving tabs along the strip: a place at a time by key or from a tab's right-click menu, or to
// where a tab is dragged. Main keeps the order, so it comes back after Lo restarts. A screen reader
// hears where the tab went.

import type { NoTarget, TabTarget } from '@lo/ui/commands';
import { createStore } from 'zustand/vanilla';

import { chosenTab, shownLayerOf, type Moved, type PlaceChoice, type Tab } from '../contract.ts';
import { main } from './main.ts';
import { moreStore } from './more.ts';
import { withoutBidi } from './shared.ts';
import { tabsStore, type TabsState } from './store.ts';

/** What the strip last said of a tab it moved, for a screen reader. */
export const movedStore = createStore<{ readonly said: string }>()(() => ({ said: '' }));

/** A tab's name, as the strip shows it: a pull request's by the layer the strip names. */
function nameOf(tab: Tab): string {
  switch (tab.kind) {
    case 'pull':
      return `${tab.repo} #${shownLayerOf(tab)}`;
    case 'recent':
      return 'Recent pull requests';
    case 'settings':
      return 'Settings';
    case 'queue':
      return `${tab.repo} merge queue for ${withoutBidi(tab.branch)}`;
    default:
      tab satisfies never;
      throw new Error(`A tab of an unknown kind: ${JSON.stringify(tab)}.`);
  }
}

/** What's said of `tab` at `place`, from 0, among `count` tabs: "Moved fd #2212 to tab 2 of 3". */
export function saidOf(tab: Tab, place: number, count: number): string {
  return `Moved ${nameOf(tab)} to tab ${place + 1} of ${count}`;
}

/**
 * How many tabs the strip shows: the first in the order, while the others are folded into its
 * "N more" menu.
 */
export function inStrip(): number {
  const { tabs } = tabsStore.getState();
  return Math.max(1, tabs.length - moreStore.getState().folded.length);
}

/**
 * Why the tab `target` names, or the one on screen, can't move a place by `by` among `state`'s
 * tabs, or `true` when it can. It goes no further than the first `shown`, those the strip shows,
 * and not round the ends. The reason is the fact alone, as its menu row and its key's toast say it.
 */
export function movable(
  { tabs, active }: TabsState,
  target: TabTarget | NoTarget,
  by: 1 | -1,
  shown: number = tabs.length,
): true | string {
  const id = target.kind === 'tab' ? target.tab : active;
  const at = tabs.findIndex((tab) => tab.id === id);
  const tab = tabs[at];
  if (!tab) return 'Tab isn’t open';
  if (tab.kind === 'recent') {
    return 'Recent pull requests can’t move';
  }
  if (at + by < 0) return 'Already first';
  if (at + by >= Math.min(shown, tabs.length)) return 'Already last';
  return true;
}

/**
 * Whether `choice` names a tab to show among `state`'s tabs: one not on screen. Otherwise, as with
 * one tab open, or none at that place, there's nothing to say, so the palette leaves it out and its
 * key does nothing.
 */
export function showable(state: TabsState, choice: PlaceChoice): true | '' {
  const chosen = chosenTab(state, choice);
  return (chosen !== undefined && chosen.id !== state.active) || '';
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
 * presses move it two places, within the tabs the strip shows.
 */
export async function stepTab(target: TabTarget | NoTarget, by: 1 | -1): Promise<void> {
  const within = inStrip();
  say(
    await main().move(
      target.kind === 'tab' ? { id: target.tab, step: by, within } : { step: by, within },
    ),
  );
}

/**
 * Moves a tab dragged along the strip, or `brought` into it, to place `to`, from 0, counted
 * without it.
 */
export async function dropTab(id: string, to: number, brought?: boolean): Promise<void> {
  say(await main().move(brought ? { id, to, brought } : { id, to }));
}
