// Each pull request's tab's panels, kept while the tab is open: whether its left panel is open,
// and which of the middle views it shows.

import { tabState, useTabState } from './shared.ts';

export interface Panels {
  readonly leftOpen: boolean;
  /** Which middle view is on screen, by its place among them. */
  readonly middle: number;
}

export const panels = tabState<Panels>(() => ({ leftOpen: true, middle: 0 }));

/** A tab's panels, re-rendering when they change. */
export function useTabPanels(tab: string): Panels {
  return useTabState(panels, tab);
}

/**
 * How many views other features put in the left panel and the middle, as the tab last drew them,
 * for the keys that open the panel and step between the views. Features list their views once, as
 * the window starts, so the counts don't change after the first tab is drawn.
 */
export const viewCounts = { left: 0, middle: 0 };
