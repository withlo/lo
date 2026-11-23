// Where `⏎` goes in a dialog: to its main button, when nothing else takes it.

import type { KeyboardEvent } from 'react';

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"], [contenteditable]';

/**
 * Whether `event` is `⏎` alone, pressed where nothing takes it for itself, such as the dialog or
 * its text, which a click there leaves focus on. A dialog's main button takes it then, so `⏎` still
 * confirms.
 */
export function enterOffControls(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== 'Enter' || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const { target } = event;
  return !(target instanceof Element && target.closest(CONTROLS) !== null);
}
