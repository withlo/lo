// What the reader wrote on a pull request itself that its timeline on screen doesn't show yet: a
// comment from the box at the timeline's end, which the timeline draws as its last row from the
// moment it's sent, and an edit of one of their comments there, whose card shows the new text. Each
// stays until the timeline shows GitHub's copy, which takes its place, so the text never leaves
// the screen and never goes back to what it was, and once it has, it never comes back. Each
// view's, in the window's memory, until its tab closes.

import { tabState } from '../../tab/window/shared.ts';
import type { DraftPlaceRow, Sending } from '../contract.ts';
import { sentLabel } from './writing.ts';

/**
 * What the timeline on screen held as a comment on the pull request itself was sent, which tells
 * GitHub's copy of it from one of the reader's with the same text before: how many of theirs it
 * held with that text, and its newest item's cursor.
 */
export interface SentBefore {
  readonly had: number;
  readonly after: string | undefined;
}

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
  /** When it was sent, by this computer's clock. */
  readonly since: number;
  /**
   * What the timeline on screen held as it was sent, for a comment sent while there was one:
   * nothing for one sent before the timeline was read, or found on its way as Lo started.
   */
  readonly before: SentBefore | undefined;
}

/** Each view's comments and edits on its pull request that its timeline doesn't show yet. */
export const onPull = tabState<readonly OnPull[]>(() => []);

/**
 * When each of a view's entries the timeline showed, or let go, was sent, by its key: what its box
 * says after of that send, as that GitHub took it, brings nothing back.
 */
const settled = tabState<ReadonlyMap<string, number>>(() => new Map());

/** How long one GitHub took waits for the timeline to show it before it's let go. */
export const ON_PULL_KEPT = 5 * 60_000;

/** What reads the timeline on screen as a comment is sent: nothing until the timeline says. */
let readBefore: (view: string, text: string) => SentBefore | undefined = () => undefined;

/**
 * Has `read` say what view `view`'s timeline on screen holds of the reader's comments with the
 * text `text`, as one is sent: nothing while it has none.
 */
export function readBeforeWith(read: (view: string, text: string) => SentBefore | undefined): void {
  readBefore = read;
}

/** What view `view`'s timeline on screen holds now of the reader's comments with text `text`. */
export function beforeOnPull(view: string, text: string): SentBefore | undefined {
  return readBefore(view, text);
}

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
  /** When it was last sent, by this computer's clock. */
  readonly since: number;
  /** What the timeline on screen held as it was sent, when it was sent here with one on screen. */
  readonly before: SentBefore | undefined;
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
  const { since, before: held } = box;
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
          since,
          before: held,
        }
      : {
          key: box.key,
          comment,
          text: box.text,
          state: box.sending === 'checking' ? 'checking' : 'sending',
          label: sentLabel(box.sending, comment !== undefined),
          at: undefined,
          since,
          before: held,
        };
  if (next === undefined) return was === undefined ? before : before.filter((_, i) => i !== at);
  if (
    was !== undefined &&
    was.state === next.state &&
    was.text === next.text &&
    was.label === next.label &&
    was.since === next.since
  ) {
    return before;
  }
  return at === -1 ? [...before, next] : before.map((each, i) => (i === at ? next : each));
}

/**
 * Notes how the comment of a box writing on view `view`'s pull request itself stands. One GitHub
 * took is let go once it has waited `ON_PULL_KEPT` for the timeline to show it. One the timeline
 * showed, or let go, is done: what its box says of it after, as that it was taken, adds nothing.
 */
export function noteOnPull(box: BoxSend): void {
  if (!writesOnPull(box.place) || settled.get(box.view).get(box.key) === box.since) return;
  const before = onPull.get(box.view);
  const after = noted(before, box, Date.now());
  if (after === before) return;
  onPull.set(box.view, after);
  const sent = after.find((each) => each.key === box.key && each.state === 'sent');
  if (sent && !before.some((each) => each.key === box.key && each.state === 'sent')) {
    setTimeout(() => settleOnPull(box.view, new Set([box.key])), ON_PULL_KEPT);
  }
}

/**
 * The timeline on screen shows what `keys` sent on view `view`'s pull request, or let them go: they
 * never come back.
 */
export function settleOnPull(view: string, keys: ReadonlySet<string>): void {
  const going = onPull.get(view).filter((each) => keys.has(each.key));
  if (going.length === 0) return;
  settled.update(view, (done) => {
    const next = new Map(done);
    for (const each of going) next.set(each.key, each.since);
    return next;
  });
  onPull.update(view, (before) => before.filter((each) => !keys.has(each.key)));
}
