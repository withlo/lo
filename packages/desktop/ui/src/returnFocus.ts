import { useRef } from 'react';

/**
 * Gives focus back to where it was when a dialog closes: to the element that had it as the dialog
 * opened, if that's still there. Returns what to call once the dialog has closed.
 *
 * Base UI would do it, but it goes to the first tabbable element in that element, and one that
 * takes focus without being tabbable, such as the middle of the window, holds tabbable parts of
 * its own, so focus lands on one of them. Naming the element as the dialog's `finalFocus` goes the
 * same way: a dialog sets `finalFocus` to `false` and calls this instead.
 */
export function useReturnFocus(open: boolean): () => void {
  const origin = useRef<Element | null>(null);
  const opened = useRef(false);
  // What has focus as the dialog starts to open is what had it: focus moves in once it's drawn.
  if (open !== opened.current) {
    opened.current = open;
    if (open) origin.current = document.activeElement;
  }
  return () => {
    const back = origin.current;
    origin.current = null;
    // Not once the dialog has opened again, which has its own origin.
    if (opened.current) return;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) {
      back.focus({ preventScroll: true });
    }
  };
}
