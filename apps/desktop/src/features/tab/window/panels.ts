// Each pull request's tab's panels, for each of its views, kept while the tab is open: which of the
// middle views it shows, which it opened on, which of the right panel's it shows, and with the code
// beside, its reading view, its code view and which of them had focus last. Whether each panel is
// open, and whether the code is beside, is the window's layout's (`layout.ts`): it stays so from
// tab to tab and layer to layer.

import type { ViewFocus } from '@lo/ui';
import { createStore } from 'zustand/vanilla';

import type { OpenOn } from '../settings.ts';
import { makeTabState, useKept } from './kept.ts';
import { focusMiddleIn } from '../../../window/commands/registry.ts';
import {
  askBeside,
  askPanel,
  besideDrawn,
  closeBeside,
  closePanel,
  drawable,
  layout,
  panelDrawn,
  RIGHT,
  setOpen,
  togglePanel,
} from './layout.ts';
import { activeOf, tabsStore } from './store.ts';

export interface Panels {
  /**
   * Which middle view is on screen, by id: none until the tab opens, on the one Settings names. One
   * that's gone, as the overview's is while Overview is off, shows as {@link middleOf} says until
   * it's back. With the code beside, it's the one of the two that had focus last, which stays on
   * screen alone as the code goes, or as there's room for only one.
   */
  readonly middle?: string | undefined;
  /** Its reading view, the one it showed last, by id: the overview or the timeline. */
  readonly reading?: string | undefined;
  /** With the code beside, its code view, by id: the diff, or a file whole opened from it. */
  readonly code?: string | undefined;
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

/** Which of two views side by side a middle view is: one to read, or code. */
export type ViewKind = 'reading' | 'code';

/** The middle views there are, in their order, and what the tab knows of each. */
export interface MiddleList {
  readonly ids: readonly string[];
  /** Which of them have a label: the header's switch lists those, and `` ` `` steps through them. */
  readonly labeled: readonly boolean[];
  /** Which of them is a reading view, and which code, where it's either. */
  readonly kinds: readonly (ViewKind | undefined)[];
  /** Which of them has nothing to show for a tab, as the overview with none, where they say. */
  readonly empty: readonly (((tab: string) => boolean) | undefined)[];
}

/**
 * The middle views' ids, those there now, in their order, as the tab last drew them, to show one by
 * its id, which of them have a label, and which are reading views and which code.
 */
export const middleIds: {
  ids: readonly string[];
  labeled: readonly boolean[];
  kinds: readonly (ViewKind | undefined)[];
  empty: readonly (((tab: string) => boolean) | undefined)[];
} = { ids: [], labeled: [], kinds: [], empty: [] };

/** Which kind of view `id` is among `views`, if it's either. */
export function kindOf(
  id: string | undefined,
  views: MiddleList = middleIds,
): ViewKind | undefined {
  return id === undefined ? undefined : views.kinds[views.ids.indexOf(id)];
}

/** What a pull request's tab shows in its middle. */
export type OnScreen =
  /** One view, or none before the tab knows which. */
  | { readonly beside: false; readonly single: string | undefined }
  /** With the code beside: a reading view, the code, and which of them has focus. */
  | {
      readonly beside: true;
      readonly reading: string;
      readonly code: string;
      readonly focus: ViewFocus;
    };

/**
 * The reading view tab `tab` shows beside the code with nothing of its own: the view Settings says
 * to open on, where that's one with something to show; else the first with something to show, the
 * overview where the pull request has one; else the timeline.
 */
function readingFor(tab: string, open: OpenOn | undefined, views: MiddleList): string | undefined {
  const reading = views.ids.filter((id) => kindOf(id, views) === 'reading');
  const shows = (id: string) => !(views.empty[views.ids.indexOf(id)]?.(tab) ?? false);
  const named = open === undefined ? undefined : `${open}.view`;
  if (named !== undefined && reading.includes(named) && shows(named)) return named;
  const showing = reading.find(shows);
  return showing ?? (reading.includes(INSTEAD) ? INSTEAD : reading[0]);
}

/**
 * What tab `tab`, with `panels`, shows in its middle among `views`, with the code `beside` a
 * reading view or not, `open` being the view Settings says to open on. Alone, its view, as
 * {@link middleOf} says. Beside, a reading view on the left: the one it shows alone, where it's
 * one, else the last it showed, else as {@link readingFor} says; and the code on the right: the
 * code view it shows alone, where it's one, else the one it showed beside last, else the diff. The
 * one it showed alone has focus.
 */
export function viewsOf(
  tab: string,
  kept: Panels,
  open: OpenOn | undefined,
  beside: boolean,
  views: MiddleList = middleIds,
): OnScreen {
  const single = middleOf(kept.middle ?? opening.get(tab), views.ids, open);
  if (!beside || single === undefined) return { beside: false, single };
  const kind = kindOf(single, views);
  const there = (id: string | undefined) =>
    id !== undefined && views.ids.includes(id) ? id : undefined;
  const reading =
    (kind === 'reading' ? single : undefined) ??
    (kindOf(there(kept.reading), views) === 'reading' ? kept.reading : undefined) ??
    readingFor(tab, open, views);
  const code =
    (kind === 'code' ? single : undefined) ??
    (kindOf(there(kept.code), views) === 'code' ? kept.code : undefined) ??
    views.ids.find((id) => kindOf(id, views) === 'code');
  if (reading === undefined || code === undefined) return { beside: false, single };
  return { beside: true, reading, code, focus: kind === 'code' ? 'code' : 'reading' };
}

/**
 * Brings middle view `id` into sight in tab `tab`, without changing the layout: with two views
 * drawn (`two`), it takes the place of the one of its kind, and has focus where that one had it;
 * otherwise it's the view on screen. A reading view is the tab's reading view from now on.
 */
export function bringView(tab: string, id: string, two: boolean): void {
  const kind = kindOf(id);
  panels.update(tab, (current) => {
    const reading = kind === 'reading' ? id : current.reading;
    if (!two || kind === undefined) return { ...current, middle: id, reading };
    const now = viewsOf(tab, current, undefined, true);
    const replaced = now.beside ? (kind === 'reading' ? now.reading : now.code) : undefined;
    const middle =
      current.middle === undefined || current.middle === replaced ? id : current.middle;
    return { ...current, middle, reading, code: kind === 'code' ? id : current.code };
  });
}

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
  // Only one it can draw now takes focus: one that's too cramped to doesn't take it later, from
  // wherever focus is by then, as the window widens.
  rightPanel.setState({ focus: focus && drawable('threads') === true });
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

/**
 * Puts the code beside a reading view in every pull request's tab, or takes it away, as `o` and
 * its button do, and says which. Focus stays where it is. Taken away, the view that had focus last
 * stays on screen, and next time a reading view brings the diff, not the code it had beside it.
 */
export function toggleBeside(): 'opened' | 'closed' {
  if (!besideDrawn()) {
    askBeside();
    return 'opened';
  }
  const tab = activeOf(tabsStore.getState());
  if (tab?.kind === 'pull') panels.update(tab.id, (current) => ({ ...current, code: undefined }));
  closeBeside();
  return 'closed';
}

/** Where middle view `id` of the tab on screen is drawn, if it's drawn. */
function viewElement(id: string): Element | null {
  return document.querySelector(`[data-lo-views] [data-lo-middle-view="${CSS.escape(id)}"]`);
}

/**
 * Gives focus to middle view `id` of the tab on screen, one of two on screen, as a click on its
 * segment of the header's switch does. Says whether it's there to take it.
 */
export function focusView(id: string): boolean {
  const element = viewElement(id);
  return element !== null && element.closest('[inert]') === null && focusMiddleIn(element);
}
