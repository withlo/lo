// What the reader wrote on a pull request itself that its timeline on screen doesn't show yet: a
// comment from the box at the timeline's end, which the timeline draws as its last row from the
// moment it's sent, and an edit of one of their comments there, whose card shows the new text. Each
// stays until the timeline shows GitHub's copy, which takes its place, so the text never leaves
// the screen and never goes back to what it was. Each view's, in the window's memory, until its tab
// closes.

import { tabState } from '../../tab/window/shared.ts';
import type { DraftPlaceRow, Sending } from '../contract.ts';
import { sentLabel } from './writing.ts';

/** A comment on a pull request itself, or an edit of one, sent from the window. */
export interface OnPull {
  /** What tells it from the others: its box's id. */
  readonly key: string;
  /** The comment an edit is of, by its node ID; nothing for a new comment. */
  readonly comment: string | undefined;
  /** The text sent. */
  readonly text: string;
  /**
   * How it stands: on its way, GitHub's answer still to come (`sending`), looked for after its
   * answer was lost (`checking`), or taken (`sent`).
   */
  readonly state: 'sending' | 'checking' | 'sent';
  /** What its card says in its time's place while it's on its way: "Sending…", "Saving…". */
  readonly label: string;
  /** When GitHub took it, by the window's clock. */
  readonly at: number | undefined;
}

/** Each view's comments and edits on its pull request that its timeline doesn't show yet. */
export const onPull = tabState<readonly OnPull[]>(() => []);

/** How long one GitHub took waits for the timeline to show it before it's let go. */
export const ON_PULL_KEPT = 5 * 60_000;

/** The comment an edit at `place` is of, when it's of a comment on the pull request itself. */
function editOf(place: DraftPlaceRow): string | undefined {
  return place.kind === 'edit' && place.thread === null ? place.comment : undefined;
}

/** Whether a box at `place` writes on the pull request itself: its own comment, or an edit there. */
export function writesOnPull(place: DraftPlaceRow): boolean {
  return place.kind === 'conversation' || editOf(place) !== undefined;
}

/** How a box's comment stands, as `onPull` keeps it, from what the box says of it. */
export interface BoxSend {
  readonly key: string;
  readonly view: string;
  readonly place: DraftPlaceRow;
  readonly text: string;
  /** Its text is held as it's sent, looked for or waits for its card. */
  readonly held: boolean;
  /** GitHub took it. */
  readonly landing: boolean;
  readonly sending: Sending | null;
}

/**
 * `before` once a box writing on the pull request itself says how its comment stands, at `now`: on
 * its way or looked for, it's there, with its text; taken, it stays until the timeline shows it;
 * neither, as when the send failed or its answer was lost, it goes, and the box has its text again.
 */
export function noted(before: readonly OnPull[], box: BoxSend, now: number): readonly OnPull[] {
  if (!writesOnPull(box.place)) return before;
  const at = before.findIndex((each) => each.key === box.key);
  const was = at === -1 ? undefined : before[at];
  if (was?.state === 'sent') return before;
  const comment = editOf(box.place);
  const next: OnPull | undefined = !box.held
    ? undefined
    : box.landing
      ? {
          key: box.key,
          comment,
          text: box.text,
          state: 'sent',
          label: sentLabel(null, comment !== undefined),
          at: now,
        }
      : {
          key: box.key,
          comment,
          text: box.text,
          state: box.sending === 'checking' ? 'checking' : 'sending',
          label: sentLabel(box.sending, comment !== undefined),
          at: undefined,
        };
  if (next === undefined) return was === undefined ? before : before.filter((_, i) => i !== at);
  if (
    was !== undefined &&
    was.state === next.state &&
    was.text === next.text &&
    was.label === next.label
  ) {
    return before;
  }
  return at === -1 ? [...before, next] : before.map((each, i) => (i === at ? next : each));
}

/**
 * Notes how the comment of a box writing on view `view`'s pull request itself stands. One GitHub
 * took is let go once it has waited `ON_PULL_KEPT` for the timeline to show it.
 */
export function noteOnPull(box: BoxSend): void {
  if (!writesOnPull(box.place)) return;
  const before = onPull.get(box.view);
  const after = noted(before, box, Date.now());
  if (after === before) return;
  onPull.set(box.view, after);
  const sent = after.find((each) => each.key === box.key && each.state === 'sent');
  if (sent && !before.some((each) => each.key === box.key && each.state === 'sent')) {
    setTimeout(() => settleOnPull(box.view, new Set([box.key])), ON_PULL_KEPT);
  }
}

/** The timeline on screen shows what `keys` sent on view `view`'s pull request, or let them go. */
export function settleOnPull(view: string, keys: ReadonlySet<string>): void {
  if (keys.size === 0) return;
  onPull.update(view, (before) => before.filter((each) => !keys.has(each.key)));
}
