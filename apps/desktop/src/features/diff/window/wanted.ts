// A review thread another feature asked a pull request's tab's diff to show, such as the threads
// panel, that the diff on screen couldn't show yet: it isn't drawn, or it's about to be drawn anew,
// as for another comparison. The next diff drawn that has the thread opens it and puts it at the
// top of the screen. The reader's next key, click or wheel drops one still waiting: they've moved
// on, and it would move what they're reading.

/** What the reader does that drops a thread still waiting. */
const INPUT = ['keydown', 'pointerdown', 'wheel'] as const;

/** The thread each tab's diff waits to show, and what stops it waiting. */
const wanted = new Map<string, { readonly thread: string; readonly stop: () => void }>();

/**
 * Has tab `tab`'s diff show `thread` once it's drawn with it, in place of any it waited to show,
 * until the reader does anything else.
 */
export function want(tab: string, thread: string): void {
  wanted.get(tab)?.stop();
  const stop = () => {
    for (const type of INPUT) window.removeEventListener(type, stop, true);
    if (wanted.get(tab)?.stop === stop) wanted.delete(tab);
  };
  wanted.set(tab, { thread, stop });
  // Not the key or click that asked for it: the window has heard that already.
  for (const type of INPUT) window.addEventListener(type, stop, true);
}

/** The thread tab `tab`'s diff waits to show, if any. */
export function wantedIn(tab: string): string | undefined {
  return wanted.get(tab)?.thread;
}

/** Tab `tab`'s diff showed the thread it waited for, or no longer waits for one. */
export function shown(tab: string): void {
  wanted.get(tab)?.stop();
}

/** Forgets what the tabs that closed waited for: those not in `open`. */
export function keepWanted(open: ReadonlySet<string>): void {
  for (const [tab, { stop }] of wanted) if (!open.has(tab)) stop();
}
