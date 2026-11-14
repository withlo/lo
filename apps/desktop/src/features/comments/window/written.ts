// What the reader's own writes changed on a pull request itself, as the window hears GitHub took
// them: a comment posted from the box at the end of its timeline, and one of their comments there
// edited or deleted. The timeline holds what comes with no input of the reader's until their next
// key or scroll, but shows what their own write changes at once, as it comes.

/** A write of the reader's to a pull request itself that GitHub took. */
export type PullWrite =
  | { readonly kind: 'posted'; readonly text: string }
  | { readonly kind: 'edited'; readonly comment: string; readonly text: string }
  | { readonly kind: 'deleted'; readonly comment: string };

const listeners = new Set<(view: string, write: PullWrite) => void>();

/** GitHub took `write` to view `view`'s pull request. */
export function wrotePull(view: string, write: PullWrite): void {
  for (const listener of listeners) listener(view, write);
}

/** Tells `listener` of each write to a pull request itself GitHub takes, until the returned function. */
export function onPullWrite(listener: (view: string, write: PullWrite) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
