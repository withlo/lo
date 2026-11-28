// Picking lines with the pointer, from a control a code view draws in its gutter, as the `+` beside
// a line: a press on it and a move of 4 px or more start a range at its line, whose far end follows
// the pointer's row in each frame, held wherever the view says it may rest. A tip 8 px right of the
// pointer says the lines, and within 24 px of the pane's top, under its pinned header, or of its
// foot, the pane scrolls 12 px a frame, under a pointer held still too. Let go, the lines are the
// view's to act on. `Esc`, a cancelled pointer, the control taken off the page and the window
// losing focus drop them, changing nothing. A press let go with no move is a click, the control's
// own.
//
// What follows the pointer is the view's: this holds the pointer, the frames, the scroll and the
// tip, so a range's end the view draws itself, as a box's bracket's, drags the same way.

import { takeKeys } from '../commands/listener.ts';

/** How far the pointer goes, in CSS pixels, before a press on a gutter control picks lines. */
export const PICK_START = 4;

/** How near the pane's top or foot the pointer scrolls it, in CSS pixels. */
export const SCROLL_REACH = 24;

/** How far the pane scrolls in a frame with the pointer there, in CSS pixels. */
export const SCROLL_STEP = 12;

/** How far right of the pointer its tip sits, and how far inside the window's edges it stays. */
const TIP_GAP = 8;
const EDGE = 8;

/** The part of the window a pane shows its lines in: from under its pinned header to its foot. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/** What a drag that picks lines asks of the view whose control it started on. */
export interface LinePick {
  /**
   * The pointer is at `y` in the window, the pane drawn as it is now: the range's far end goes to
   * the row there, and the view draws what's picked. The words the tip says, while there are any.
   */
  follow(y: number): string | undefined;
  /** Where the pane shows its lines now. */
  band(): Band;
  /** Scrolls the pane `by` pixels, down for more than 0: whether it moved. */
  scroll(by: number): boolean;
  /**
   * Whether the view knows yet where the end may rest: until it does, as while it asks which lines
   * take a comment, the end follows again in each frame, the pointer still or not.
   */
  known(): boolean;
  /** Let go after a move: the lines followed last are picked. */
  end(): void;
  /** Dropped after a move: what was drawn for it goes, and nothing else changes. */
  cancel(): void;
  /** The press ended before it moved far enough: it was a click, the control's own. */
  click(): void;
}

/** How far the pane scrolls in a frame with the pointer at `y`: up below 0, down above it, or not. */
export function scrollFor(y: number, band: Band): number {
  if (y < band.top + SCROLL_REACH) return -SCROLL_STEP;
  if (y > band.bottom - SCROLL_REACH) return SCROLL_STEP;
  return 0;
}

/**
 * Where a range's far end rests that would be at line `toward`, the range starting at `start`: the
 * first line from `toward` back toward `start` that `rests` takes, or `start` where none does.
 */
export function restingEnd(
  start: number,
  toward: number,
  rests: (line: number) => boolean,
): number {
  const step = toward > start ? -1 : 1;
  for (let line = toward; line !== start; line += step) if (rests(line)) return line;
  return start;
}

/**
 * Starts picking lines from `control` on the press `event`, a left button's with no modifier, or
 * does nothing for another. Returns what drops the pick from outside, or `undefined` for a press
 * that doesn't pick.
 */
export function pickLines(
  control: HTMLElement,
  event: PointerEvent,
  pick: LinePick,
): (() => void) | undefined {
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return undefined;
  }
  const document = control.ownerDocument;
  const window = document.defaultView;
  const pointer = event.pointerId;
  const from = { x: event.clientX, y: event.clientY };
  let at = from;
  let started = false;
  let done = false;
  let frame = 0;
  let tip: HTMLElement | undefined;
  let stopKeys: (() => void) | undefined;

  /** Draws the tip by the pointer, saying `words`, or takes it away while there are none. */
  const drawTip = (words: string | undefined): void => {
    if (words === undefined) {
      if (tip) tip.hidden = true;
      return;
    }
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'lo-tip lo-picktip move-pop';
      tip.dataset.side = 'right';
      // What it says is the pointer's alone: the box it opens says the same.
      tip.setAttribute('aria-hidden', 'true');
      (control.closest('.lo-app') ?? document.body).append(tip);
    }
    tip.hidden = false;
    if (tip.textContent !== words) tip.textContent = words;
    const size = tip.getBoundingClientRect();
    const width = window?.innerWidth ?? Infinity;
    const height = window?.innerHeight ?? Infinity;
    const left = Math.min(at.x + TIP_GAP, width - EDGE - size.width);
    const top = Math.max(EDGE, Math.min(at.y - size.height / 2, height - EDGE - size.height));
    tip.style.left = `${Math.max(EDGE, left)}px`;
    tip.style.top = `${top}px`;
  };

  /** The frame's work: the pane scrolls with the pointer near an edge, and the end follows it. */
  const tick = (): void => {
    frame = 0;
    if (done) return;
    const by = scrollFor(at.y, pick.band());
    const scrolled = by !== 0 && pick.scroll(by);
    drawTip(pick.follow(at.y));
    // Held near an edge, it scrolls on in the next frame, the pointer still or not, and the end
    // follows again once the view knows where it may rest.
    if (scrolled || !pick.known()) frame = requestAnimationFrame(tick);
  };

  const soon = (): void => {
    if (started && !done && frame === 0) frame = requestAnimationFrame(tick);
  };

  const onMove = (move: PointerEvent): void => {
    if (move.pointerId !== pointer) return;
    at = { x: move.clientX, y: move.clientY };
    if (!started) {
      if (Math.hypot(at.x - from.x, at.y - from.y) < PICK_START) return;
      started = true;
      stopKeys = takeKeys((key) => {
        if (key.key !== 'Escape') return false;
        end('cancel');
        return true;
      });
    }
    soon();
  };

  /** Ends the pick: with the lines followed last, or with nothing changed. */
  const end = (how: 'let go' | 'cancel'): void => {
    if (done) return;
    done = true;
    stop();
    if (!started) {
      pick.click();
      return;
    }
    if (how === 'let go') {
      // Where the pointer let go, the pane drawn as it is now.
      pick.follow(at.y);
      pick.end();
    } else pick.cancel();
  };

  const onUp = (up: PointerEvent): void => {
    if (up.pointerId !== pointer) return;
    at = { x: up.clientX, y: up.clientY };
    end('let go');
  };
  const onCancel = (): void => end('cancel');

  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    stopKeys?.();
    tip?.remove();
    tip = undefined;
    control.removeEventListener('pointermove', onMove);
    control.removeEventListener('pointerup', onUp);
    control.removeEventListener('pointercancel', onCancel);
    control.removeEventListener('lostpointercapture', onCancel);
    window?.removeEventListener('blur', onCancel);
    document.removeEventListener('scroll', soon, true);
    if (control.hasPointerCapture(pointer)) control.releasePointerCapture(pointer);
  }

  control.setPointerCapture(pointer);
  control.addEventListener('pointermove', onMove);
  control.addEventListener('pointerup', onUp);
  control.addEventListener('pointercancel', onCancel);
  control.addEventListener('lostpointercapture', onCancel);
  window?.addEventListener('blur', onCancel);
  // The wheel's scroll, or anything else's, moves the lines under a pointer held still.
  document.addEventListener('scroll', soon, { capture: true, passive: true });
  return onCancel;
}
