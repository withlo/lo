import { useRef } from 'react';

import { focusStillIn } from './motion.ts';

/**
 * Gives focus back to where it was when a dialog closes: to the element that had it as the dialog
 * opened, if that's still there. Returns what to call as the dialog closes, with the dialog's own
 * element.
 *
 * Focus goes back only while it's still the dialog's (`focusStillIn`): inside it, or dropped. Focus
 * that has gone anywhere else since stays there, so a dialog that gives focus back late, as one
 * that waits for its close to complete does, never takes it from a dialog or popup that opened in
 * its place.
 *
 * Base UI would do it, but it goes to the first tabbable element in that element, and one that
 * takes focus without being tabbable, such as the middle of the window, holds tabbable parts of
 * its own, so focus lands on one of them. Naming the element as the dialog's `finalFocus` goes the
 * same way: a dialog sets `finalFocus` to `false` and calls this instead.
 */
export function useReturnFocus(open: boolean): (dialog: Element | null) => void {
  const origin = useRef<Element | null>(null);
  const opened = useRef(false);
  // What has focus as the dialog starts to open is what had it: focus moves in once it's drawn.
  if (open !== opened.current) {
    opened.current = open;
    if (open) origin.current = document.activeElement;
  }
  return (dialog) => {
    const back = origin.current;
    origin.current = null;
    // Not once the dialog has opened again, which has its own origin.
    if (opened.current) return;
    if (!(back instanceof HTMLElement) || !back.isConnected || back === document.body) return;
    if (focusStillIn(dialog)) back.focus({ preventScroll: true });
  };
}
