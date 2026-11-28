// The ends of an open comment box's bracket, its handles, as a code view draws them in its threads'
// lane, the diff's and an excerpt's alike: what each says under the pointer, the lane's name for the
// box's lines, and the tip that waits after a drag. A drag from one is the view's own, as it moves
// the box (`pick.ts` holds the pointer).

import { controlOf } from '../commands/index.ts';
import { type At, draftKey } from './beside.ts';
import type { Side } from './api.ts';
import type { Tip } from './tip.ts';

/** Which end of a box's bracket a handle is: its first line's, its last's, or both, on one line. */
export type HandleEnd = 'first' | 'last' | 'both';

/**
 * What an end of an open box's bracket says under the pointer, by the end: which it is, and the
 * keys that move it, by the commands they run. On one line, those that add a line either way. It
 * shows over its line, never under it, where the box, or the popover the box is in, is.
 */
const HANDLE_TIPS = {
  first: { label: 'First line', commands: ['comments.lineAbove', 'comments.dropFirst'] },
  last: { label: 'Last line', commands: ['comments.lineBelow', 'comments.dropLast'] },
  both: { label: 'First and last line', commands: ['comments.lineAbove', 'comments.lineBelow'] },
} as const;

/** Which end handle `control` is, if it's one. */
export function handleEnd(control: HTMLElement): HandleEnd | undefined {
  const { handle } = control.dataset;
  return handle === 'first' || handle === 'last' || handle === 'both' ? handle : undefined;
}

/** What handle `end` says under the pointer: which end it is, and its keys. */
export function handleTip(end: HandleEnd): Tip {
  const { label, commands } = HANDLE_TIPS[end];
  return { label, keys: commands.flatMap((id) => controlOf(id)?.keys ?? []), side: 'top' };
}

/** The lane's name for the draft of a box under `place`, from line `from` where it starts above. */
export function boxDraftKey(place: At, from: { line: number } | undefined): string {
  return draftKey(place.file, place.side, from?.line ?? place.line, place.line);
}

/** What a drag's tip says of lines `from` to `to` of `side`, a box's head's words for them. */
export function linesWords(side: Side, from: number, to: number): string {
  const lines = from === to ? `Line ${to}` : `Lines ${Math.min(from, to)}–${Math.max(from, to)}`;
  return side === 'old' ? `${lines}, removed` : lines;
}

/**
 * The handles' tips in `root` after a drag: let go on the end it moved, that end shows no tip until
 * the pointer leaves it, so its tip doesn't come back over the box let go under it. A click on a
 * handle does nothing, whatever its cell draws.
 */
export class HandleTips {
  readonly #root: HTMLElement;
  #quiet = false;
  /** Where the pointer last moved over `root`, while it's over it. */
  #at: { readonly x: number; readonly y: number } | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
    root.addEventListener('pointermove', this.#moved, { passive: true });
    root.addEventListener('pointerleave', this.#moved, { passive: true });
    root.addEventListener('click', this.#clicked, { capture: true });
  }

  /** Whether the handles show no tip now. */
  get quiet(): boolean {
    return this.#quiet;
  }

  /**
   * A press on a handle ends, before its bracket is drawn as the box's again: let go on the end it
   * `moved`, as it's drawn still, its tip waits for the pointer to come to it again.
   */
  dragEnded(moved: boolean): void {
    const at = this.#at;
    const under = moved && at ? this.#root.ownerDocument.elementFromPoint(at.x, at.y) : null;
    this.#quiet = Boolean(under?.closest('.lo-handle'));
  }

  destroy(): void {
    this.#root.removeEventListener('pointermove', this.#moved);
    this.#root.removeEventListener('pointerleave', this.#moved);
    this.#root.removeEventListener('click', this.#clicked, { capture: true });
  }

  /** The pointer moved over `root`, or left it: off a handle, their tips come again. */
  readonly #moved = (event: PointerEvent): void => {
    const left = event.type === 'pointerleave';
    this.#at = left ? undefined : { x: event.clientX, y: event.clientY };
    if (!this.#quiet) return;
    const { target } = event;
    if (left || !(target instanceof Element) || target.closest('.lo-handle') === null) {
      this.#quiet = false;
    }
  };

  readonly #clicked = (event: MouseEvent): void => {
    const { target } = event;
    if (!(target instanceof Element) || target.closest('.lo-handle') === null) return;
    event.preventDefault();
    event.stopPropagation();
  };
}
