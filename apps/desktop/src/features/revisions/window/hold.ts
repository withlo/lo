// How long the window holds back what a pull request's tab shows first, as it opens: the overview,
// or a place in the diff, for something that may change it. It's {@link HOLD_LIMIT}, unless a build
// run from source was started with another, which main says once the page loads, so a test that
// isn't about the bound doesn't race it. A tab restored as the page loads may have started its wait
// before main said, so a wait is checked against the bound again as it ends.

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

/**
 * Runs `run` once `since`, when a tab started waiting, is the bound ago, and returns a function that
 * cancels it. The bound is read as the wait ends, and the wait goes on if it has grown since it
 * began, as it does when main says a test asked for another once the tab was waiting already.
 */
export function afterHold(since: number, run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = () => {
    const left = since + limit - Date.now();
    if (left > 0) {
      timer = setTimeout(wait, left);
      return;
    }
    timer = undefined;
    run();
  };
  timer = setTimeout(wait, Math.max(0, since + limit - Date.now()));
  return () => clearTimeout(timer);
}
