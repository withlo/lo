// What `Esc` closes in the welcome: the practice comment box, while it's open.

let close: (() => boolean) | undefined;

/** Says what closes the practice box, while there's a practice on screen, or that it's gone. */
export function setPracticeEscape(closer: (() => boolean) | undefined): void {
  close = closer;
}

/** `Esc` in the welcome: closes the practice box if it's open, and says whether it did. */
export function escapePractice(): boolean {
  return close?.() ?? false;
}
