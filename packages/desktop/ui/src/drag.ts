// Dragging an edge with the pointer, as plain DOM, so whatever draws an edge drags it the same way:
// `Splitter` wraps it, and so can an edge a code view draws in its own DOM.
//
// A press holds the pointer. Past a few pixels the drag starts, and the edge follows the pointer in
// each move's own frame, within its range. While it lasts, nothing else is hovered or selected, the
// cursor is the edge's wherever the pointer goes, the edge is drawn pressed (`data-dragging`), and
// `Esc` is the drag's. What it hands back is the whole of what changed: only a drag that moved the
// edge somewhere new ends with a width (`onEnd`). A press that never moved, `Esc`, a cancelled
// pointer, and a drag stopped from outside, as when the edge leaves the page, end with `onCancel`,
// and whoever draws the edge puts back what was there before the press. The window losing focus
// ends the drag where it is, as letting go there would, but never closes a panel: a drag that was
// showing one gone ends with nothing changed.

import { takeKeys } from './commands/listener.ts';
import type { Range } from './fit.ts';

/** How near the window's side a panel's edge is let go to close the panel. */
export const CLOSE_REACH = 110;

/** How far the pointer goes, in CSS pixels, before a press drags: less is a click. */
export const DRAG_START = 3;

/** The attribute on `<html>` while an edge is dragged, naming the cursor: `col`, `e` or `w`. */
const RESIZING = 'data-lo-resizing';

/** Whether an edge is being dragged in `document`: what's sized then is passing through. */
export function resizing(document: Document): boolean {
  return document.documentElement.hasAttribute(RESIZING);
}

export interface EdgeDrag {
  /** The width the edge sizes, as drawn at the press. */
  readonly from: number;
  /** How far it goes, asked again at each move. */
  readonly range: () => Range;
  /**
   * Which way the pointer goes to widen what it sizes: `end` for what's before the edge, `start`
   * for what's after it.
   */
  readonly grows: 'end' | 'start';
  /** The width the pointer asks for, within the range, in the move's own frame. */
  readonly onDrag: (value: number, closing: boolean) => void;
  /** Let go, or the window lost focus, somewhere new: the width it ends at. */
  readonly onEnd: (value: number) => void;
  /** Ended with nothing changed: put back what was there before the press. */
  readonly onCancel: () => void;
  /**
   * For a panel's edge: let go within `CLOSE_REACH` of the window's side the panel is on, which
   * shows it gone from there, it closes the panel instead, and changes no width. The window losing
   * focus there closes nothing: the drag cancels.
   */
  readonly onClose?: (() => void) | undefined;
}

/** Which limit `value` is at, if one. */
export function limitOf(value: number, range: Range): 'min' | 'max' | undefined {
  if (range.max - range.min < 0.5) return undefined;
  if (value <= range.min + 0.5) return 'min';
  if (value >= range.max - 0.5) return 'max';
  return undefined;
}

/** The cursor at `limit` for an edge that `grows` one way: the arrow points the way left to go. */
function cursorAt(limit: 'min' | 'max' | undefined, grows: 'end' | 'start'): 'col' | 'e' | 'w' {
  if (limit === undefined) return 'col';
  return (limit === 'min') === (grows === 'end') ? 'e' : 'w';
}

/**
 * Starts dragging `edge` from the press `event`, a left button's, or does nothing for another.
 * Returns what stops the drag from outside, which then ends with `onCancel`, or `undefined` when
 * the press doesn't drag.
 */
export function dragEdge(
  edge: HTMLElement,
  event: PointerEvent,
  drag: EdgeDrag,
): (() => void) | undefined {
  if (event.button !== 0) return undefined;
  // Focus stays where it was, so the keys go on acting on it, and no text is selected.
  event.preventDefault();
  const document = edge.ownerDocument;
  const window = document.defaultView;
  const root = document.documentElement;
  const pointer = event.pointerId;
  const x = event.clientX;
  let started = false;
  let at = drag.from;
  let closing = false;
  let done = false;

  const follow = (to: number) => {
    if (!started && Math.abs(to - x) < DRAG_START) return;
    started = true;
    const range = drag.range();
    const moved = (to - x) * (drag.grows === 'end' ? 1 : -1);
    at = Math.max(range.min, Math.min(range.max, drag.from + moved));
    closing =
      drag.onClose !== undefined &&
      window !== null &&
      (drag.grows === 'end' ? to <= CLOSE_REACH : to >= window.innerWidth - CLOSE_REACH);
    root.setAttribute(RESIZING, cursorAt(limitOf(at, range), drag.grows));
    drag.onDrag(at, closing);
  };

  /**
   * Ends the drag: with a new width, closing the pane, or with nothing changed. Left (`blur`) as the
   * window loses focus, it ends where it is, but closes nothing.
   */
  const end = (how: 'let go' | 'blur' | 'cancel') => {
    if (done) return;
    done = true;
    stop();
    const moved = how !== 'cancel' && started;
    if (moved && closing) {
      if (how === 'let go' && drag.onClose) drag.onClose();
      else drag.onCancel();
    } else if (moved && Math.abs(at - drag.from) >= 0.5) {
      drag.onEnd(at);
    } else {
      drag.onCancel();
    }
  };

  const onMove = (move: PointerEvent) => {
    if (move.pointerId === pointer) follow(move.clientX);
  };
  const onUp = (up: PointerEvent) => {
    if (up.pointerId !== pointer) return;
    follow(up.clientX);
    end('let go');
  };
  const onCancel = () => end('cancel');
  const onBlur = () => end('blur');
  const stopKeys = takeKeys((key) => {
    if (key.key !== 'Escape') return false;
    end('cancel');
    return true;
  });

  function stop(): void {
    stopKeys();
    edge.removeEventListener('pointermove', onMove);
    edge.removeEventListener('pointerup', onUp);
    edge.removeEventListener('pointercancel', onCancel);
    edge.removeEventListener('lostpointercapture', onCancel);
    window?.removeEventListener('blur', onBlur);
    root.removeAttribute(RESIZING);
    edge.removeAttribute('data-dragging');
    if (edge.hasPointerCapture(pointer)) edge.releasePointerCapture(pointer);
  }

  edge.setPointerCapture(pointer);
  edge.addEventListener('pointermove', onMove);
  edge.addEventListener('pointerup', onUp);
  edge.addEventListener('pointercancel', onCancel);
  edge.addEventListener('lostpointercapture', onCancel);
  window?.addEventListener('blur', onBlur);
  root.setAttribute(RESIZING, cursorAt(limitOf(drag.from, drag.range()), drag.grows));
  edge.setAttribute('data-dragging', '');
  return onCancel;
}
