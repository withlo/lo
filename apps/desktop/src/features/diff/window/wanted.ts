// What a pull request's tab's diff waits to show, that the diff on screen can't show yet: a review
// thread another feature asked for, such as the threads panel, when the diff isn't drawn, or is
// about to be drawn anew, as for another comparison; or a place in the tab's history in another
// comparison, which going back or forward asked for. The next diff drawn that has the thread opens
// it and puts it at the top of the screen; the next diff drawn of another comparison than the one
// on screen as it was asked for shows the place. The reader's next key, click or wheel drops what
// still waits: they've moved on, and it would move what they're reading.

import type { Target } from '@lo/ui/commands';

/** What the reader does that drops what still waits. */
const INPUT = ['keydown', 'pointerdown', 'wheel'] as const;

/**
 * What a tab's diff waits to show: a thread, or a place, with the diff it was asked for in front
 * of, which isn't the one to show it in, named as {@link drawnName} names it.
 */
export type Wanted =
  | { readonly kind: 'thread'; readonly thread: string }
  | { readonly kind: 'place'; readonly target: Target; readonly left: string };

/** What each tab's diff waits to show, and what stops it waiting. */
const wanted = new Map<string, { readonly wanted: Wanted; readonly stop: () => void }>();

/** Names a diff drawn of the head `at`, comparing what `comparison` names, or the whole pull request. */
export function drawnName(
  at: string | null | undefined,
  comparison: string | null | undefined,
): string {
  return `${at ?? ''}|${comparison ?? ''}`;
}

/** Has tab `tab`'s diff show `what` once it can, in place of anything it waited for, until input. */
function want(tab: string, what: Wanted): void {
  wanted.get(tab)?.stop();
  const stop = () => {
    for (const type of INPUT) window.removeEventListener(type, stop, true);
    if (wanted.get(tab)?.stop === stop) wanted.delete(tab);
  };
  wanted.set(tab, { wanted: what, stop });
  // Not the key or click that asked for it: the window has heard that already.
  for (const type of INPUT) window.addEventListener(type, stop, true);
}

/** Has tab `tab`'s diff show thread `thread` once it's drawn with it. */
export function wantThread(tab: string, thread: string): void {
  want(tab, { kind: 'thread', thread });
}

/**
 * Has tab `tab`'s diff show `target`, with the cursor on it and focus in it, once a diff of another
 * comparison than `left`, the one on screen now, is drawn.
 */
export function wantPlace(tab: string, target: Target, left: string): void {
  want(tab, { kind: 'place', target, left });
}

/** What tab `tab`'s diff waits to show, if anything. */
export function wantedIn(tab: string): Wanted | undefined {
  return wanted.get(tab)?.wanted;
}

/** Tab `tab`'s diff showed what it waited for, or no longer waits for it. */
export function shown(tab: string): void {
  wanted.get(tab)?.stop();
}

/** Forgets what the tabs that closed waited for: those not in `open`. */
export function keepWanted(open: ReadonlySet<string>): void {
  for (const [tab, { stop }] of wanted) if (!open.has(tab)) stop();
}
