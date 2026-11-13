// How long the window holds back what a pull request's tab shows first, as it opens: the overview,
// or a place in the diff, for something that may change it. It's {@link HOLD_LIMIT}, unless a build
// run from source was started with another, which main says once the page loads, so a test that
// isn't about the bound doesn't race it.

import { HOLD_LIMIT } from '../contract.ts';

let limit = HOLD_LIMIT;

/** How long the window holds back what a tab shows first, in milliseconds. */
export function holdLimit(): number {
  return limit;
}

/** Takes the bound main says a test asked for, or {@link HOLD_LIMIT} when it asked for none. */
export function takeHoldLimit(asked: number | undefined): void {
  limit = asked ?? HOLD_LIMIT;
}
