import { useCallback, type RefObject } from 'react';

/**
 * A ref for a Base UI popup (a menu, a dialog or a palette) that gives it focus as soon as it
 * mounts: `target`'s element, or the popup itself without one.
 *
 * Base UI moves focus into a popup on the next animation frame. Until then keys still go to what
 * had focus, outside the popup's scope, which is what holds the window's other commands back, so a
 * key pressed then runs behind the popup: `Esc` goes back to the middle view and leaves the popup
 * open. So the popup takes focus itself, before any key can arrive. It waits for two microtasks, so
 * that Base UI has noted where focus was (to give it back on close) and whether any is inside
 * already, as it does before it moves focus a frame on. Focus already inside the popup stays where
 * it is.
 */
export function useTakeFocus(
  target?: RefObject<HTMLElement | null>,
): (popup: HTMLElement | null) => void {
  return useCallback(
    (popup: HTMLElement | null) => {
      if (!popup) return;
      queueMicrotask(() =>
        queueMicrotask(() => {
          if (popup.contains(popup.ownerDocument.activeElement)) return;
          (target?.current ?? popup).focus({ preventScroll: true });
        }),
      );
    },
    [target],
  );
}
