// The other end of moved code, which `gm` goes to from the cursor's line and a moved label's click
// from the label's: the same line where the code went or came from. Either is a jump the reader
// asks for, recorded in the tab's history, so `⌃o` comes back.

import type { DiffView, Place, Target } from '@lo/ui/code';

import type { Drawn } from './tabs.ts';

/** The diff a jump goes in: its view, and what it does with a file the reader acts on. */
export interface Going extends Pick<Drawn, 'acted'> {
  readonly view: Pick<DiffView, 'otherEnd' | 'keyState' | 'setCollapsed' | 'reveal' | 'focus'>;
}

/** What `gm` says on a line that isn't moved code. */
export const NOT_MOVED = 'There’s no moved code on this line.';

/** Whether line `at` is in moved code, so `gm` can go from it, or why not. */
export function movedNow(view: Pick<DiffView, 'otherEnd'>, at: Place): true | string {
  return view.otherEnd(at) !== undefined || NOT_MOVED;
}

/**
 * Goes to `to`, a line at the other end of moved code, in `diff`: acts on its file as `za` does,
 * bringing it up to what's come for it and opening it if it's closed, then puts the cursor on the
 * line, brought on screen by the least scroll, with focus.
 */
export function toOtherEnd(diff: Going, to: Place): void {
  diff.acted(to.file);
  diff.view.setCollapsed(to.file, false);
  diff.view.reveal({ kind: 'line', at: to });
  diff.view.focus();
}

/**
 * A click on a moved label that goes to `to`: `record`s the line the label is over, the first of
 * its own end of the code, which is `to`'s other end, as the place the jump leaves, and goes there.
 */
export function followLabel(diff: Going, to: Place, record: (left: Target) => void): void {
  const label = diff.view.otherEnd(to);
  record(label ? { kind: 'line', at: label } : diff.view.keyState().target);
  toOtherEnd(diff, to);
}
