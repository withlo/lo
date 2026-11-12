// Focus that follows a dialog's main button from one step to the next.

import { useEffect, type KeyboardEvent, type RefObject } from 'react';

/**
 * Focuses `ref`'s element each time `step` changes. It waits two frames: when the focused button
 * went with the last step, the dialog gives focus to itself, then again on the next frame, which
 * would otherwise take it back.
 */
export function useFocusOnStep(ref: RefObject<HTMLElement | null>, step: unknown): void {
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => ref.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, step]);
}

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
