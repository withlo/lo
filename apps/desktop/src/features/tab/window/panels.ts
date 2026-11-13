// Each pull request's tab's panels, for each of its views, kept while the tab is open: whether its
// left panel is open, and which of the middle views it shows. And the right panel, the threads,
// whose open state is the window's: it stays open or closed from tab to tab and layer to layer.

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { makeTabState, useKept } from './kept.ts';

export interface Panels {
  readonly leftOpen: boolean;
  /** Which middle view is on screen, by its place among them. */
  readonly middle: number;
}

export const panels = makeTabState<Panels>(() => ({ leftOpen: true, middle: 0 }));

/** A tab's panels, re-rendering when they change. */
export function useTabPanels(tab: string): Panels {
  return useKept(panels, tab);
}

/**
 * How many views other features put in the left panel, the middle and the right panel, as the tab
 * last drew them, for the keys that open the panels and step between the views. Features list
 * their views once, as the window starts, so the counts don't change after the first tab is drawn.
 */
export const viewCounts = { left: 0, middle: 0, right: 0 };

/** The middle views' ids, in their order, as the tab last drew them, to show one by its id. */
export const middleIds: { ids: readonly string[] } = { ids: [] };

/**
 * The right panel, the window's: whether it's open, which it is in every pull request's tab, each
 * showing what's its own; and whether it takes focus as it's next drawn, as when it was opened. It
 * starts closed.
 */
export const rightPanel = createStore<{ readonly open: boolean; readonly focus: boolean }>()(
  () => ({ open: false, focus: false }),
);

/** Whether the right panel is open, re-rendering when it opens or closes. */
export function useRightOpen(): boolean {
  return useStore(rightPanel, (state) => state.open);
}

/** Where the right panel is on the DOM, when it's open: the tab on screen's. */
export const RIGHT = '[data-lo-right]';

/**
 * Opens the right panel, which takes focus as it's drawn, so its keys work at once; or closes it,
 * and if focus was in it, gives focus back to the middle view.
 */
export function toggleRight(): void {
  if (!rightPanel.getState().open) {
    rightPanel.setState({ open: true, focus: true });
    return;
  }
  const had = document.querySelector(RIGHT)?.contains(document.activeElement) ?? false;
  rightPanel.setState({ open: false, focus: false });
  if (had) focusMiddle();
}

/**
 * Whether the right panel should take focus now that it's drawn, which it does once after it
 * opens.
 */
export function takeRightFocus(): boolean {
  const { focus } = rightPanel.getState();
  if (focus) rightPanel.setState({ focus: false });
  return focus;
}
