// Each pull request's tab's panels, for each of its views, kept while the tab is open: whether its
// left panel is open, which of the middle views it shows, and which of the right panel's. And the
// right panel's open state, which is the window's: it stays open or closed from tab to tab and
// layer to layer.

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { makeTabState, useKept } from './kept.ts';

export interface Panels {
  readonly leftOpen: boolean;
  /** Which middle view is on screen, by its place among them. */
  readonly middle: number;
  /**
   * Which of the right panel's views it shows, by id: the one shown last, which `⌘⇧\` opens it on.
   * None for the first, the threads.
   */
  readonly right?: string | undefined;
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

/**
 * The middle views' ids, in their order, as the tab last drew them, to show one by its id, and
 * which of them have a label: the header's switch lists those, and `` ` `` steps through them.
 */
export const middleIds: { ids: readonly string[]; labeled: readonly boolean[] } = {
  ids: [],
  labeled: [],
};

/** The right panel's views' ids, in their order, as the tab last drew them, the threads first. */
export const rightIds: string[] = [];

/**
 * The middle view `step` on from view `at` among those `labeled` says have a label, round the ends,
 * as `` ` `` (1) and `~` (-1) step: from one without a label, the next or previous one with.
 * `at` itself when no other has one.
 */
export function stepAmong(at: number, step: 1 | -1, labeled: readonly boolean[]): number {
  const count = labeled.length;
  for (let moved = 1; moved <= count; moved++) {
    const next = (((at + step * moved) % count) + count) % count;
    if (labeled[next] && next !== at) return next;
  }
  return at;
}

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

/** Gives focus to the scope drawn in right panel `panel`, so its keys work at once. */
export function focusPanel(panel: HTMLElement): void {
  panel.querySelector<HTMLElement>('[data-lo-scope]')?.focus({ preventScroll: true });
}

/**
 * Shows view `id` in tab `tab`'s right panel, opening it if it's closed, and gives it focus, as
 * it's drawn or at once if it's drawn already, unless `focus` is false; or, with none, closes the
 * panel, giving focus in it back to the middle view.
 */
export function showRightView(tab: string, id: string | undefined, focus = true): void {
  if (id === undefined) {
    if (rightPanel.getState().open) toggleRight();
    return;
  }
  const drawn = document.querySelector<HTMLElement>(RIGHT);
  const shown = rightPanel.getState().open && drawn?.dataset.loRight === id;
  panels.update(tab, (current) => ({ ...current, right: id }));
  rightPanel.setState({ open: true, focus });
  // Drawn already, it isn't drawn again to take it.
  if (shown && drawn && takeRightFocus()) focusPanel(drawn);
}

/** How a tab's right panel stands: open or closed, and on which view (none for the first). */
export interface RightKept {
  readonly open: boolean;
  readonly right: string | undefined;
}

/** How tab `tab`'s right panel stands now. */
export function keptRight(tab: string): RightKept {
  return { open: rightPanel.getState().open, right: panels.get(tab).right };
}

/**
 * Puts tab `tab`'s right panel back as `kept` had it, on its view, open or closed, without taking
 * focus; closing, focus in it goes back to the middle view.
 */
export function putRightBack(tab: string, kept: RightKept): void {
  panels.update(tab, (current) => ({ ...current, right: kept.right }));
  if (kept.open) rightPanel.setState({ open: true, focus: false });
  else if (rightPanel.getState().open) toggleRight();
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
