// Words in a code view's editors: where one is drawn, for a popover over it, such as the type
// hover, and the one under the pointer, which counts as rested on once the pointer has stayed there
// for half a second.

import type { EditorView } from '@codemirror/view';

import type { Anchor, Place, Rested } from './api.ts';

/** How long the pointer stays on a word before it rests there, in milliseconds. */
export const REST = 500;

/** The word at `pos` of `view`, or the character there outside a word: none at a line's end. */
function wordRange(view: EditorView, pos: number): { from: number; to: number } | undefined {
  const word = view.state.wordAt(pos);
  if (word) return { from: word.from, to: word.to };
  return pos < view.state.doc.lineAt(pos).to ? { from: pos, to: pos + 1 } : undefined;
}

/**
 * Where the word at `pos` of `view` is drawn, or the character there outside one, or the place
 * itself at a line's end: its first row, where it wraps. None unless some of it is on `screen`.
 */
export function wordAnchor(view: EditorView, pos: number, screen: DOMRect): Anchor | undefined {
  if (pos < view.viewport.from || pos > view.viewport.to) return undefined;
  const range = wordRange(view, pos) ?? { from: pos, to: pos };
  const start = view.coordsAtPos(range.from, 1);
  const end = range.to > range.from ? view.coordsAtPos(range.to, -1) : start;
  if (!start || !end) return undefined;
  const oneRow = Math.abs(end.top - start.top) < 1;
  const box = {
    left: start.left,
    top: start.top,
    right: oneRow ? end.right : start.right,
    bottom: start.bottom,
  };
  return box.bottom > screen.top && box.top < screen.bottom ? box : undefined;
}

/** The word under the point `x`, `y` of the window in `view`, if the point is on one. */
export function wordUnder(
  view: EditorView,
  x: number,
  y: number,
): { from: number; to: number } | undefined {
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return undefined;
  const word = view.state.wordAt(pos);
  if (!word) return undefined;
  const start = view.coordsAtPos(word.from, 1);
  const end = view.coordsAtPos(word.to, -1);
  if (!start || !end || y < start.top || y > end.bottom) return undefined;
  // Wrapped over rows, it's under the point anywhere between them.
  if (Math.abs(end.top - start.top) >= 1) return word;
  return x >= start.left && x <= end.right ? word : undefined;
}

/** A word the pointer is on: what tells it apart from others, and where it starts. */
export interface Word {
  key: string;
  at: Place;
}

/**
 * Tells `tell` when the pointer rests on a word of `dom`, which `find` finds under it, and when it
 * leaves the word, or the scroll takes the word from under it. Returns what stops it.
 */
export function watchRests(
  dom: HTMLElement,
  find: (event: PointerEvent) => Word | undefined,
  tell: Rested,
): () => void {
  let on: Word | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let said = false;
  const leave = (): void => {
    clearTimeout(timer);
    timer = undefined;
    on = undefined;
    if (!said) return;
    said = false;
    tell(undefined);
  };
  const moved = (event: PointerEvent): void => {
    const word = event.pointerType === 'touch' ? undefined : find(event);
    if (word && word.key === on?.key) return;
    leave();
    if (!word) return;
    on = word;
    timer = setTimeout(() => {
      timer = undefined;
      said = true;
      tell(word.at);
    }, REST);
  };
  dom.addEventListener('pointermove', moved, { passive: true });
  dom.addEventListener('pointerleave', leave, { passive: true });
  dom.addEventListener('scroll', leave, { passive: true });
  return () => {
    clearTimeout(timer);
    dom.removeEventListener('pointermove', moved);
    dom.removeEventListener('pointerleave', leave);
    dom.removeEventListener('scroll', leave);
  };
}
