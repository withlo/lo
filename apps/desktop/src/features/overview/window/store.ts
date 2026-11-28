// Each pull request's tab's overview in the window: what main last said of it, its checking, fed
// what main says, and what that found, kept with the tab; and the tab's revisions, which the
// overview names by their labels. A tab's checking stops as the tab closes.

import { client } from '../../../window/ipc.ts';
import { contract as revisionsContract, type ComparisonView } from '../../revisions/contract.ts';
import { markRevision } from '../../revisions/window/shared.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { OverviewState } from '../contract.ts';
import { Checking, type CheckedOverview } from './checking.ts';
import { standingOf } from './facts.ts';
import { main, overviewJobs } from './main.ts';
import { steady } from './steady.ts';
import { catchUpTerms, keepTermsOnly, takeTerms } from './terms.ts';

/** What main last said of each tab's overview: none until it has. */
export const states = tabState<OverviewState | undefined>(() => undefined);

/**
 * Each tab's overview, checked: none until main has said the tab has one and it's been checked.
 * It's set again only when the result changes, and each part of it that's equal to the last is the
 * last one's own object, so the view keeps what it drew of it.
 */
export const checked = tabState<CheckedOverview | undefined>(() => undefined);

/** What main last said of each tab's revisions, for their labels: none until it has. */
export const revisions = tabState<ComparisonView | undefined>(() => undefined);

/** Whether main is reading each tab's overview again, as Check again asked, until it has. */
export const rereading = tabState<boolean>(() => false);

const checkings = new Map<string, Checking>();

/** Whether the window takes what main says of overviews: not while Settings turns them off. */
let taking = true;

/**
 * Asks main to read tab `id`'s overview again now, as Check again and its key do, saying the tab is
 * `rereading` until main has: its button reads "Checking…" meanwhile.
 */
export function readAgain(id: string): void {
  if (rereading.get(id)) return;
  rereading.set(id, true);
  main()
    .retry({ id })
    .catch((error: unknown) => console.error("Lo couldn't read the overview again:", error))
    .finally(() => rereading.set(id, false));
}

/** Takes a result for tab `id`, unless it's the one the tab has. */
export function publish(id: string, value: CheckedOverview | undefined): void {
  const kept = steady(checked.get(id), value);
  if (kept !== checked.get(id)) checked.set(id, kept);
  markDescribed(id);
}

/**
 * Marks the commit tab `id`'s overview on screen describes in its revision picker, or clears the
 * mark when none shows.
 */
function markDescribed(id: string): void {
  const standing = standingOf(states.get(id), checked.get(id));
  markRevision(id, 'overview', standing.kind === 'shown' ? standing.header.commit : undefined);
}

/** Tab `id`'s checking, made the first time it's needed. */
function checkingOf(id: string): Checking {
  let checking = checkings.get(id);
  if (checking) return checking;
  checking = new Checking(id, {
    files: (input) => main().files(input),
    code: (input) => main().code(input),
    parse: (input, signal) => overviewJobs().parse(input, { signal }),
    check: (input, signal) => overviewJobs().check(input, { signal }),
    publish: (value) => publish(id, value),
    log: (message, error) => console.error(message, error),
  });
  checkings.set(id, checking);
  return checking;
}

/** Takes what main says of a tab's overview, while there are overviews. */
export function takeState(state: OverviewState): void {
  if (!taking) return;
  states.set(state.id, state);
  checkingOf(state.id).take(state);
  markDescribed(state.id);
}

/**
 * Checks tab `id`'s overview again after a check that failed, with what main last said of it, and
 * settles once that check is done, however it went. Nothing new starts while a check is under way,
 * or once one has gone through.
 */
export async function checkAgain(id: string): Promise<void> {
  const state = states.get(id);
  if (!state) return;
  const checking = checkingOf(id);
  checking.take(state);
  await checking.done();
}

/** Takes what main says of a tab's revisions. */
export function takeRevisions(view: ComparisonView): void {
  revisions.set(view.id, view);
}

/**
 * Asks main for the overview, its definitions and the revisions of each of `ids`, once, for a tab
 * main spoke of before the window listened: what main says meanwhile comes first.
 */
export function catchUp(ids: readonly string[]): void {
  catchUpTerms(ids);
  for (const id of ids) {
    if (checkings.has(id)) continue;
    main()
      .current({ id })
      .then((state) => {
        if (state && !checkings.has(id)) takeState(state);
      })
      .catch((error: unknown) => console.error("Lo couldn't ask about a tab's overview:", error));
    client(revisionsContract)
      .list({ id })
      .then((view) => {
        if (view && revisions.get(id) === undefined) takeRevisions(view);
      })
      .catch((error: unknown) => console.error("Lo couldn't ask about a tab's revisions:", error));
  }
}

/**
 * Takes what main says of overviews again as Settings turns them on, catching up on the tabs
 * `open`; or as it turns them off, forgets every tab's, its definitions, its checking and its
 * revision's mark, and takes nothing more until they're on.
 */
export function takeOverviews(on: boolean, open: readonly string[]): void {
  taking = on;
  takeTerms(on);
  if (on) {
    catchUp(open);
    return;
  }
  for (const [id, checking] of checkings) {
    checking.stop();
    states.set(id, undefined);
    checked.set(id, undefined);
    markRevision(id, 'overview', undefined);
  }
  checkings.clear();
}

/** Stops checking the overviews of tabs that closed: those not in `open`. */
export function keepOnly(open: ReadonlySet<string>): void {
  keepTermsOnly(open);
  for (const [id, checking] of checkings) {
    if (open.has(id)) continue;
    checking.stop();
    checkings.delete(id);
  }
}
