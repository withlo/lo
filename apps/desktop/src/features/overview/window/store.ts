// Each pull request's tab's overview in the window: what main last said of it, its checking, fed
// what main says, and what that found, kept with the tab; and the tab's revisions, which the
// overview names by their labels. A tab's checking stops as the tab closes.

import { client } from '../../../window/ipc.ts';
import { contract as revisionsContract, type ComparisonView } from '../../revisions/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { OverviewState } from '../contract.ts';
import { Checking, type CheckedOverview } from './checking.ts';
import { main, overviewJobs } from './main.ts';
import { steady } from './steady.ts';

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

const checkings = new Map<string, Checking>();

/** Takes a result for tab `id`, unless it's the one the tab has. */
export function publish(id: string, value: CheckedOverview | undefined): void {
  const kept = steady(checked.get(id), value);
  if (kept !== checked.get(id)) checked.set(id, kept);
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

/** Takes what main says of a tab's overview. */
export function takeState(state: OverviewState): void {
  states.set(state.id, state);
  checkingOf(state.id).take(state);
}

/**
 * Checks tab `id`'s overview again after a check that failed, with what main last said of it.
 * Nothing new starts while a check is under way, or once one has gone through.
 */
export function checkAgain(id: string): void {
  const state = states.get(id);
  if (state) checkingOf(id).take(state);
}

/** Takes what main says of a tab's revisions. */
export function takeRevisions(view: ComparisonView): void {
  revisions.set(view.id, view);
}

/**
 * Asks main for the overview and the revisions of each of `ids`, once, for a tab main spoke of
 * before the window listened: what main says meanwhile comes first.
 */
export function catchUp(ids: readonly string[]): void {
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

/** Stops checking the overviews of tabs that closed: those not in `open`. */
export function keepOnly(open: ReadonlySet<string>): void {
  for (const [id, checking] of checkings) {
    if (open.has(id)) continue;
    checking.stop();
    checkings.delete(id);
  }
}
