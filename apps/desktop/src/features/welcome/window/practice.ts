// What `Esc` closes in the welcome: the practice comment box, while it's open.

/** The practice on screen: whether its box is open, and what closes it. */
interface Practice {
  readonly open: () => boolean;
  readonly close: () => void;
}

let practice: Practice | undefined;

/** Says what the practice on screen is, while there's one, or that it's gone. */
export function setPracticeEscape(given: Practice | undefined): void {
  practice = given;
}

/** What `Esc` closes in the welcome, closing nothing: the practice box, while it's open. */
export function practiceEscape(): (() => void) | undefined {
  return practice?.open() === true ? practice.close : undefined;
}

/** `Esc` in the welcome: closes the practice box if it's open, and says whether it did. */
export function escapePractice(): boolean {
  const close = practiceEscape();
  close?.();
  return close !== undefined;
}
