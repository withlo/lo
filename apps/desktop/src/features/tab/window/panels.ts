// Each pull request's tab's panels, for each of its views, kept while the tab is open: which of the
// middle views it shows, which it opened on, and which of the right panel's it shows. Whether each
// panel is open is the window's layout's (`layout.ts`): it stays open or closed from tab to tab and
// layer to layer.

import { createStore } from 'zustand/vanilla';

import type { OpenOn } from '../settings.ts';
import { makeTabState, useKept } from './kept.ts';
import { askPanel, closePanel, layout, panelDrawn, RIGHT, setOpen, togglePanel } from './layout.ts';

export interface Panels {
  /**
   * Which middle view is on screen, by id: none until the tab opens, on the one Settings names. One
   * that's gone, as the overview's is while Overview is off, shows as {@link middleOf} says until
   * it's back.
   */
  readonly middle?: string | undefined;
  /** The middle view the tab opened on, by id, once it has. */
  readonly opened?: string | undefined;
  /**
   * Which of the right panel's views it shows, by id: the one shown last, which `⌘⇧\` opens it on.
   * None for the first, the threads.
   */
  readonly right?: string | undefined;
}

export const panels = makeTabState<Panels>(() => ({}));

/**
 * The middle view a tab shows in place of one that isn't there, or that has nothing to show as the
 * tab opens, as Overview with no overview: the timeline, where the description is first.
 */
export const INSTEAD = 'timeline.view';

/**
 * Which of the middle views `ids`, those there now, a tab shows: `chosen`, the one it shows by id,
 * or before it has one, the view Settings says to open on (`open`, nothing while it isn't known);
 * and in place of one that isn't there, the timeline, or the first there is.
 */
export function middleOf(
  chosen: string | undefined,
  ids: readonly string[],
  open: OpenOn | undefined,
): string | undefined {
  const wanted = chosen ?? (open === undefined ? undefined : `${open}.view`);
  if (wanted === undefined || ids.includes(wanted)) return wanted;
  return ids.includes(INSTEAD) ? INSTEAD : ids[0];
}

/**
 * The middle view each tab is opening on, as it was last drawn, until its panels keep it: so a view
 * drawn as the tab opens knows it's the one, before the tab's own effects run.
 */
export const opening = new Map<string, string>();

/** A tab's panels, re-rendering when they change. */
export function useTabPanels(tab: string): Panels {
  return useKept(panels, tab);
}

/**
 * The middle views' ids, those there now, in their order, as the tab last drew them, to show one by
 * its id, and which of them have a label: the header's switch lists those, and `` ` `` steps
 * through them.
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
 * Whether the right panel takes focus as it's next drawn, as when it was opened: so its keys work
 * at once.
 */
export const rightPanel = createStore<{ readonly focus: boolean }>()(() => ({ focus: false }));

/**
 * Opens the right panel, which takes focus as it's drawn, so its keys work at once; or closes it,
 * and if focus was in it, gives focus back to the middle view.
 */
export function toggleRight(): void {
  // Before it's drawn, which takes it.
  rightPanel.setState({ focus: !panelDrawn('threads') });
  togglePanel('threads');
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
    if (layout.getState().threads.open) closePanel('threads');
    return;
  }
  const drawn = document.querySelector<HTMLElement>(RIGHT);
  const shown = panelDrawn('threads') && drawn?.dataset.loRight === id;
  panels.update(tab, (current) => ({ ...current, right: id }));
  rightPanel.setState({ focus });
  askPanel('threads');
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
  return { open: layout.getState().threads.open, right: panels.get(tab).right };
}

/**
 * Puts tab `tab`'s right panel back as `kept` had it, on its view, open or closed, without taking
 * focus; closing, focus in it goes back to the middle view.
 */
export function putRightBack(tab: string, kept: RightKept): void {
  panels.update(tab, (current) => ({ ...current, right: kept.right }));
  if (kept.open) {
    rightPanel.setState({ focus: false });
    setOpen('threads', true);
  } else if (layout.getState().threads.open) {
    closePanel('threads');
  }
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
