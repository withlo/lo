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

/**
 * Where focus can go: an element, or a part of the view that puts focus where it belongs in it, as
 * the middle view does in its text.
 */
export interface FocusTarget {
  focus(options?: FocusOptions): void;
}

/** Whether `element` can hold focus now: on the page, not inert, and not disabled. */
function canHold(element: Element): boolean {
  return (
    element.isConnected &&
    element.closest('[inert]') === null &&
    !(element instanceof HTMLButtonElement && element.disabled)
  );
}

/**
 * Focuses `target`, an element made to take focus (`tabIndex = -1`) only for as long as it holds
 * it, if it isn't a stop for `Tab` already. Says whether it took it.
 */
function give(target: FocusTarget): boolean {
  if (!(target instanceof HTMLElement)) {
    target.focus({ preventScroll: true });
    return true;
  }
  if (!canHold(target)) return false;
  target.focus({ preventScroll: true });
  if (target.ownerDocument.activeElement === target) return true;
  if (target.hasAttribute('tabindex')) return false;
  target.tabIndex = -1;
  target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  target.focus({ preventScroll: true });
  return target.ownerDocument.activeElement === target;
}

/**
 * Hands focus on from what's leaving to where it belongs, so it doesn't fall to the page: a banner's
 * "+1" to the next banner's, a status item's details to their item. `leaving` is what goes, with
 * what's in it, such as a popup's trigger and the popup; `to` says, once React has drawn what
 * replaces it, where focus goes: the first of its answers that can hold focus takes it.
 *
 * Call it as `leaving` goes: right after the change that takes it, as a press does, or in a layout
 * effect's cleanup, while it's still on the page. It does nothing unless focus is inside `leaving`
 * then. A microtask on, once React is done, it hands focus on where focus has fallen to the page,
 * or stays on what's leaving now that it can't hold it, as a button in a row that closes, which
 * goes inert. Focus that went anywhere else by then, as into a dialog the press opened, stays
 * there. The window's own catch (`catchFocus`) is the last resort, where `to` has nowhere.
 */
export function handOffFocus(
  leaving: readonly (Element | null | undefined)[],
  to: () => readonly (FocusTarget | null | undefined)[],
): void {
  const from = leaving.filter((each) => each !== null && each !== undefined);
  const document = from.find((each) => each.isConnected)?.ownerDocument;
  const had = document?.activeElement;
  if (!document || !had || !from.some((each) => each.contains(had))) return;
  queueMicrotask(() => {
    const now = document.activeElement;
    const fell =
      now === null ||
      now === document.body ||
      (from.some((each) => each.contains(now)) && !canHold(now));
    if (!fell) return;
    for (const target of to()) {
      if (target && give(target)) return;
    }
  });
}

/**
 * The stops beside `leaving` in `row`, such as the status bar, for focus to go to as it leaves: the
 * next button or link after it, else the one before it, else the row itself. `leaving` is what
 * goes, with what's in it.
 */
export function besideIn(
  row: HTMLElement | null | undefined,
  leaving: readonly (Element | null | undefined)[],
): FocusTarget[] {
  const mine = leaving.filter((each) => each !== null && each !== undefined);
  const first = mine.find((each) => each.isConnected && row?.contains(each));
  if (!row || !first) return row ? [row] : [];
  const stops = [...row.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')].filter(
    (stop) => !mine.some((each) => each.contains(stop)),
  );
  const next = stops.find(
    (stop) => first.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const previous = stops.findLast(
    (stop) => first.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  return [next, previous, row].filter((each) => each !== undefined);
}
