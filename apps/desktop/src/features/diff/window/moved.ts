// The other end of moved code, which `gm` goes to from the cursor's line and a moved label's click
// from the label's: the same line where the code went or came from. Either is a jump the reader
// asks for, recorded in the tab's history, so `⌃o` comes back.

import type { DiffView, Place, Target } from '@lo/ui/code';

import type { Drawn } from './tabs.ts';

/** The diff a jump goes in: its view, and how it takes in a file the reader goes into. */
export interface Going extends Pick<Drawn, 'enter'> {
  readonly view: Pick<DiffView, 'otherEnd' | 'keyState' | 'setCollapsed' | 'reveal' | 'focus'>;
}

/** What `gm` says on a line that isn't moved code. */
export const NOT_MOVED = 'No moved code on this line';

/** Whether line `at` is in moved code, so `gm` can go from it, or why not. */
export function movedNow(view: Pick<DiffView, 'otherEnd'>, at: Place): true | string {
  return view.otherEnd(at) !== undefined || NOT_MOVED;
}

/**
 * `gm`: from moved code at `at` to the line it moved with at the other end, in `diff`. The other
 * end's file is gone into first, so the lines that have come for it are there to pair with; a file
 * that has none, as one kept out, is gone to at the block's first line. Says whether `at` is in
 * moved code.
 */
export function fromMoved(diff: Going, at: Place): boolean {
  const end = diff.view.otherEnd(at);
  if (!end) return false;
  diff.enter(end.file);
  toLine(diff.view, diff.view.otherEnd(at) ?? end);
  return true;
}

/**
 * A click on a moved label that goes to `to`, the first line at the other end: its file is gone
 * into, and `record` gets the line the label is over, the first of its own end of the code, as the
 * place the jump leaves.
 */
export function followLabel(diff: Going, to: Place, record: (left: Target) => void): void {
  diff.enter(to.file);
  const label = diff.view.otherEnd(to);
  record(label ? { kind: 'line', at: label } : diff.view.keyState().target);
  toLine(diff.view, to);
}

/**
 * Opens `to`'s file if it's closed, and puts the cursor on its line, brought on screen by the least
 * scroll, with focus.
 */
function toLine(view: Going['view'], to: Place): void {
  view.setCollapsed(to.file, false);
  view.reveal({ kind: 'line', at: to });
  view.focus();
}
