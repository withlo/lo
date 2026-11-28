// Tooltips for the controls a code view draws in the DOM, where React's `Tooltip` doesn't reach:
// the viewed ball in a file's header, the `+` in the gutter. They look and wait as `Tooltip` does:
// a control's name and its key, after the pointer rests on it, and never a state or an error. A
// control that can't run says why instead.

import { keyCap } from '../keyCap.ts';

/** What a control's tooltip says: its name, or why it can't run, and its key. */
export interface Tip {
  readonly label: string;
  /** Its key, as the system shows each key of it. */
  readonly keys?: readonly string[] | undefined;
  /**
   * Which side of the control it shows on where there's room: under it, as most do, or over it,
   * for a control with what it's about under it, as an end of a comment box's bracket has the box.
   */
  readonly side?: 'top' | 'bottom' | undefined;
  /**
   * What it never covers, as a selector, such as a comment box: where it would on its side, it
   * shows on the other, where that's clear of it and it fits there.
   */
  readonly clear?: string | undefined;
}

/** How long the pointer rests on a control before its tip comes, in milliseconds, as `Tooltip`'s. */
export const TIP_DELAY = 500;

/** The gap between a control and its tip, and between a tip and the window's edge. */
const GAP = 6;
const EDGE = 8;

/**
 * What marks an element as a control with a tip: the command it runs, a tip of its own, or an end
 * of an open comment box's bracket, which says which end it is.
 */
export const TIPPED = '[data-command], [data-tip], [data-handle]';

/**
 * Shows a tip under each control in `root` the pointer rests on, as `tipOf` says it, or over it
 * where it says so (`side`), on the other side where its own would cover what it keeps clear of
 * (`clear`), and takes it away as the pointer leaves, a button goes down, a key is pressed or
 * anything scrolls. A tip a scroll took away comes back once the pointer rests again: a move over
 * the control arms it, and so does the end of the scroll, for the control then under the pointer.
 * A control a button went down on, or the pointer was on as a key was pressed, stays quiet until
 * the pointer leaves it. Returns a function that stops.
 */
export function tips(
  root: HTMLElement,
  tipOf: (control: HTMLElement) => Tip | undefined,
): () => void {
  let over: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | undefined;
  let pressed: HTMLElement | undefined;
  /** Where the pointer is, while it's over `root`. */
  let pointer: { readonly x: number; readonly y: number } | undefined;

  const hide = (): void => {
    clearTimeout(timer);
    timer = undefined;
    over = undefined;
    shown?.remove();
    shown = undefined;
  };

  const show = (control: HTMLElement): void => {
    const tip = control.isConnected ? tipOf(control) : undefined;
    if (!tip) return;
    const popup = document.createElement('div');
    popup.className = 'lo-tip';
    popup.setAttribute('role', 'tooltip');
    popup.append(tip.label);
    if (tip.keys && tip.keys.length > 0) {
      const keys = document.createElement('span');
      keys.className = 'lo-tip__keys';
      keys.setAttribute('aria-hidden', 'true');
      for (const key of tip.keys) keys.append(keyCap(key));
      popup.append(keys);
    }
    (root.closest('.lo-app') ?? document.body).append(popup);
    const at = control.getBoundingClientRect();
    const size = popup.getBoundingClientRect();
    const left = Math.max(
      EDGE,
      Math.min(at.left + at.width / 2 - size.width / 2, window.innerWidth - EDGE - size.width),
    );
    const atBottom = at.bottom + GAP;
    const atTop = at.top - GAP - size.height;
    const fitsBelow = atBottom + size.height <= window.innerHeight - EDGE;
    const fitsAbove = atTop >= EDGE;
    /** Whether the tip, `top` from the window's top, would cover what it keeps clear of. */
    const covers = (top: number): boolean =>
      tip.clear !== undefined &&
      [...document.querySelectorAll(tip.clear)].some((each) => {
        const box = each.getBoundingClientRect();
        return (
          box.left < left + size.width &&
          left < box.right &&
          box.top < top + size.height &&
          top < box.bottom
        );
      });
    // On its side where it fits there, else on the other; and on the other where its own would
    // cover what it keeps clear of and the other wouldn't.
    let below = tip.side === 'top' ? !fitsAbove : fitsBelow;
    if (
      covers(below ? atBottom : atTop) &&
      (below ? fitsAbove : fitsBelow) &&
      !covers(below ? atTop : atBottom)
    ) {
      below = !below;
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${below ? atBottom : atTop}px`;
    shown = popup;
  };

  /** The control in `root` that `target` is in, when it may show its tip now. */
  const controlAt = (target: unknown): HTMLElement | undefined => {
    const control = target instanceof Element ? target.closest<HTMLElement>(TIPPED) : null;
    return control && control !== pressed && root.contains(control) ? control : undefined;
  };

  /** Shows `control`'s tip once the pointer has rested on it. */
  const arm = (control: HTMLElement): void => {
    over = control;
    timer = setTimeout(() => show(control), TIP_DELAY);
  };

  const onMove = (event: MouseEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
    const control = controlAt(event.target);
    if (control !== undefined && control === over) return;
    // Off a control, this also stops the wait a scroll started: the pointer is no longer at rest.
    hide();
    if (control) arm(control);
  };
  const onOut = (event: MouseEvent): void => {
    const to = event.relatedTarget;
    const into = (element: Node): boolean => to instanceof Node && element.contains(to);
    if (!into(root)) pointer = undefined;
    if (pressed && !into(pressed)) pressed = undefined;
    if (over && !into(over)) hide();
  };
  const onPress = (event: MouseEvent): void => {
    hide();
    pressed =
      (event.target instanceof Element ? event.target.closest<HTMLElement>(TIPPED) : null) ??
      undefined;
  };
  // A key quiets the control the pointer is on, as a press does: a twitch of the pointer, or the
  // scroll a key such as `j` makes, doesn't bring its tip back.
  const onKey = (): void => {
    pressed = over ?? pressed;
    hide();
  };
  // A scroll moves what's under the pointer without a move of the pointer's own to arm a tip: the
  // control under it once the scroll is over shows its tip, as if the pointer had come to rest there.
  // Where the pointer is is asked then, so a pointer that has left the view shows none.
  const onScroll = (): void => {
    hide();
    if (!pointer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const at = pointer;
      if (!at) return;
      const control = controlAt(document.elementFromPoint?.(at.x, at.y));
      if (!control) return;
      over = control;
      show(control);
    }, TIP_DELAY);
  };

  root.addEventListener('mouseover', onMove);
  root.addEventListener('mousemove', onMove);
  root.addEventListener('mouseout', onOut);
  root.addEventListener('mousedown', onPress, true);
  root.addEventListener('keydown', onKey, true);
  root.addEventListener('wheel', onScroll, { capture: true, passive: true });
  root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    hide();
    root.removeEventListener('mouseover', onMove);
    root.removeEventListener('mousemove', onMove);
    root.removeEventListener('mouseout', onOut);
    root.removeEventListener('mousedown', onPress, true);
    root.removeEventListener('keydown', onKey, true);
    root.removeEventListener('wheel', onScroll, true);
    root.removeEventListener('scroll', onScroll, true);
  };
}
