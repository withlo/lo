// Each view's timeline in the window: what main last sent of it and what of that is on screen,
// what goes beside its description, the tab's revisions, the row the keyboard is on, and the hidden
// comments the reader chose to show. Each is kept with its tab and goes when the tab closes. What
// main sends while the timeline is on screen waits for the reader's next key, click or scroll,
// unless it's what their own write changed (`holding.ts`).

import type { PullWrite } from '../../comments/window/shared.ts';
import type { ComparisonView } from '../../revisions/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { Sidebar, SidebarView, TimelineView } from '../contract.ts';
import { atOnce, CLAIM_FOR, type Claim, holding, stillToCome } from './holding.ts';
import { main, revisions } from './main.ts';

/** What main last sent of each view's timeline. */
export const timelines = tabState<TimelineView | undefined>(() => undefined);
/** What of it is on screen: what main last sent, or, while the reader looks, what came before. */
export const shownTimelines = tabState<TimelineView | undefined>(() => undefined);
/** The reader's own writes whose change each view's timeline shows at once, as it comes. */
const claims = tabState<readonly Claim[]>(() => []);
/** The views whose timeline is on screen. */
const looked = new Set<string>();
export const sidebars = tabState<Sidebar | undefined>(() => undefined);
export const comparisons = tabState<ComparisonView | undefined>(() => undefined);
/** The row the keyboard is on, by its key: the first row until the reader moves. */
export const focusedRows = tabState<string | undefined>(() => undefined);
/** The hidden comments and reviews the reader chose to show, by their keys. */
export const shownHidden = tabState<ReadonlySet<string>>(() => new Set());

/** What takes each view's reading place as its timeline changes on screen. */
const placeTakers = new Map<string, () => void>();

/**
 * Says `take` takes where the reader is in view `view`'s timeline, just before what main sent goes
 * on screen, until the returned function.
 */
export function beforeShowing(view: string, take: () => void): () => void {
  placeTakers.set(view, take);
  return () => {
    if (placeTakers.get(view) === take) placeTakers.delete(view);
  };
}

/** Puts what main last sent of view `id`'s timeline on screen. */
function show(id: string): void {
  const view = timelines.get(id);
  if (view === undefined || view === shownTimelines.get(id)) return;
  placeTakers.get(id)?.();
  shownTimelines.set(id, view);
  const waiting = claims.get(id);
  if (waiting.length > 0) claims.set(id, stillToCome(waiting, view.timeline, Date.now()));
}

export function takeTimeline(view: TimelineView): void {
  timelines.set(view.id, view);
  const go = atOnce(
    view,
    shownTimelines.get(view.id),
    looked.has(view.id),
    claims.get(view.id),
    Date.now(),
  );
  if (go) show(view.id);
}

/** The reader pressed a key, clicked or scrolled: view `id`'s timeline shows what's come since. */
export function showHeld(id: string): void {
  show(id);
}

/**
 * Says whether view `id`'s timeline is on screen. What comes while it isn't goes on screen at once,
 * and so does what came while it was, as it goes.
 */
export function setLooked(id: string, on: boolean): void {
  if (on) looked.add(id);
  else {
    looked.delete(id);
    show(id);
  }
}

/**
 * GitHub took the reader's `write` to view `view`'s pull request: what it changes in the timeline
 * goes on screen as it comes, and with it what came before, for a minute at most.
 */
export function claim(view: string, write: PullWrite): void {
  const had = write.kind === 'posted' ? holding(shownTimelines.get(view)?.timeline, write.text) : 0;
  claims.update(view, (waiting) => [...waiting, { write, until: Date.now() + CLAIM_FOR, had }]);
  // It may be here already, held.
  show(view);
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
