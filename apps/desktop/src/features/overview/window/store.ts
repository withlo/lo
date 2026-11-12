// Each pull request's tab's overview, checked, in the window: the checking of each, fed what main
// says of the tab's overview, and what it found, kept with the tab. A tab's checking stops as the
// tab closes.

import { tabState } from '../../tab/window/shared.ts';
import type { OverviewState } from '../contract.ts';
import { Checking, type CheckedOverview } from './checking.ts';
import { main, overviewJobs } from './main.ts';

/**
 * Each tab's overview, checked: none until main has said the tab has one and it's been checked.
 * It's set again only when the result changes, with the same parse for as long as the overview's
 * commit is the same.
 */
export const checked = tabState<CheckedOverview | undefined>(() => undefined);

const checkings = new Map<string, Checking>();

/** Tab `id`'s checking, made the first time it's needed. */
function checkingOf(id: string): Checking {
  let checking = checkings.get(id);
  if (checking) return checking;
  checking = new Checking(id, {
    files: (input) => main().files(input),
    code: (input) => main().code(input),
    parse: (input, signal) => overviewJobs().parse(input, { signal }),
    check: (input, signal) => overviewJobs().check(input, { signal }),
    publish: (value) => checked.set(id, value),
    log: (message, error) => console.error(message, error),
  });
  checkings.set(id, checking);
  return checking;
}

/** Takes what main says of a tab's overview. */
export function takeState(state: OverviewState): void {
  checkingOf(state.id).take(state);
}

/**
 * Asks main for the overview of each of `ids`, once, for a tab main spoke of before the window
 * listened: what main says meanwhile comes first.
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
