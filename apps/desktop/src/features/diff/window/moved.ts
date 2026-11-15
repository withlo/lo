// The other end of moved code, which `gm` goes to from the cursor's line and a moved label's click
// from the label's: the same line where the code went or came from. Either is a jump the reader
// asks for, recorded in the tab's history, so `⌃o` comes back.

import type { DiffView, Place, Target } from '@lo/ui/code';

/** What `gm` says on a line that isn't moved code. */
export const NOT_MOVED = 'There’s no moved code on this line.';

/** Whether line `at` is in moved code, so `gm` can go from it, or why not. */
export function movedNow(view: Pick<DiffView, 'otherEnd'>, at: Place): true | string {
  return view.otherEnd(at) !== undefined || NOT_MOVED;
}

/**
 * Goes to `to`, a line at the other end of moved code: opens its file if it's closed, as `za`
 * would, and puts the cursor on the line, brought on screen by the least scroll, with focus.
 */
export function toOtherEnd(
  view: Pick<DiffView, 'setCollapsed' | 'reveal' | 'focus'>,
  to: Place,
): void {
  view.setCollapsed(to.file, false);
  view.reveal({ kind: 'line', at: to });
  view.focus();
}

/**
 * A click on a moved label that goes to `to`: `record`s the line the label is over, the first of
 * its own end of the code, which is `to`'s other end, as the place the jump leaves, and goes there.
 */
export function followLabel(
  view: Pick<DiffView, 'otherEnd' | 'keyState' | 'setCollapsed' | 'reveal' | 'focus'>,
  to: Place,
  record: (left: Target) => void,
): void {
  const label = view.otherEnd(to);
  record(label ? { kind: 'line', at: label } : view.keyState().target);
  toOtherEnd(view, to);
}
