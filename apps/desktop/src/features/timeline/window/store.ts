// Each view's timeline in the window: what main last sent of it and of what goes beside its
// description, the tab's revisions, the row the keyboard is on, and the hidden comments the reader
// chose to show. Each is kept with its tab and goes when the tab closes.

import type { ComparisonView } from '../../revisions/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { Sidebar, SidebarView, TimelineView } from '../contract.ts';
import { main, revisions } from './main.ts';

export const timelines = tabState<TimelineView | undefined>(() => undefined);
export const sidebars = tabState<Sidebar | undefined>(() => undefined);
export const comparisons = tabState<ComparisonView | undefined>(() => undefined);
/** The row the keyboard is on, by its key: the first row until the reader moves. */
export const focusedRows = tabState<string | undefined>(() => undefined);
/** The hidden comments and reviews the reader chose to show, by their keys. */
export const shownHidden = tabState<ReadonlySet<string>>(() => new Set());

export function takeTimeline(view: TimelineView): void {
  timelines.set(view.id, view);
}

export function takeSidebar(view: SidebarView): void {
  sidebars.set(view.id, view.sidebar ?? undefined);
}

export function takeRevisions(view: ComparisonView): void {
  comparisons.set(view.id, view);
}

const asked = new Set<string>();

/**
 * The timeline of view `id` is shown: main reads it, the first time, and answers with what it has,
 * which fills in what it hasn't sent yet; the tab's revisions likewise.
 */
export function showTimeline(id: string): void {
  if (asked.has(id)) return;
  asked.add(id);
  main()
    .show({ id })
    .then(({ timeline, sidebar }) => {
      if (timelines.get(id) === undefined) takeTimeline(timeline);
      if (sidebars.get(id) === undefined && sidebar.sidebar !== null) takeSidebar(sidebar);
    })
    .catch((error: unknown) => {
      asked.delete(id);
      console.error("Lo couldn't ask for the timeline:", error);
    });
  revisions()
    .list({ id })
    .then((view) => {
      if (view && comparisons.get(id) === undefined) takeRevisions(view);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's revisions:", error));
}
