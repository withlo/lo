// What the reader wrote on the pull request itself that the timeline on screen doesn't show yet,
// as its rows draw it: a comment sent from the box at its end is its last row, drawn as its card
// will be, from the moment it's sent until the timeline shows GitHub's copy, which takes its place;
// an edit of one of their comments shows its new text in that comment's card until the timeline
// has it, or newer. Plain functions, tested alone.

import type { OnPull, SentBefore } from '../../comments/window/shared.ts';
import type { Timeline } from '../contract.ts';
import { holding, madeSince, pullComment, shows } from './holding.ts';
import type { Person, Row } from './rows.ts';

/**
 * How much earlier than it was sent, by GitHub's clock, GitHub may say a comment was made or
 * edited: its times, and the `Date` its clock is read from, are to the second, and the answer took
 * a while.
 */
export const CLOCK_SLACK = 5_000;

/** What `timeline` holds of account `login`'s comments with the text `text`, as one is sent. */
export function beforeOf(timeline: Timeline, text: string, login: string): SentBefore {
  return { had: holding(timeline, text, login), after: timeline.items.at(-1)?.cursor };
}

/** The key of the row a comment on its way draws as. */
export function sentKey(sent: OnPull): string {
  return `sent:${sent.key}`;
}

/**
 * Whether `timeline` shows `login`'s comment `sent`: GitHub's copy, as GitHub's answer named it;
 * before that, one more of theirs with its text than the timeline on screen held as it was sent;
 * or, with nothing from then, once its answer was lost, one of theirs with its text made since it
 * was sent, by GitHub's clock, as main says.
 */
function showsComment(timeline: Timeline, sent: OnPull, login: string): boolean {
  const { copy, before, sentAt } = sent;
  if (copy !== undefined) return pullComment(timeline, copy) !== undefined;
  if (before === undefined) {
    // Its answer still to come names its copy.
    if (sent.state === 'sending' || sentAt === undefined) return false;
    return madeSince(timeline, sent.text, login, sentAt, CLOCK_SLACK);
  }
  return shows(timeline, {
    write: { kind: 'posted', text: sent.text },
    until: Number.POSITIVE_INFINITY,
    had: before.had,
    after: before.after,
    by: login,
  });
}

/**
 * Whether `timeline` shows the edit `sent`, which GitHub took: its comment has its text, or was
 * edited when GitHub answered it or after, as elsewhere since, by GitHub's clock (or, its answer
 * lost, since it was sent), or is gone.
 */
function showsEdit(timeline: Timeline, sent: OnPull): boolean {
  const { comment } = sent;
  if (comment === undefined) return true;
  const shown = pullComment(timeline, comment);
  if (shown === undefined) return true;
  const edited = { kind: 'edited', comment, text: sent.text } as const;
  if (shows(timeline, { write: edited, until: Number.POSITIVE_INFINITY, had: 0 })) return true;
  const since = sent.editedAt ?? sent.sentAt;
  if (since === undefined || shown.lastEditedAt === undefined) return false;
  return Date.parse(shown.lastEditedAt) >= since - CLOCK_SLACK;
}

/** What the reader's writes on the pull request itself add to the timeline's rows. */
export interface SentRows {
  /** The rows of the comments on their way, or taken, that the timeline doesn't show yet. */
  readonly rows: readonly Row[];
  /** The new text, and what its card says meanwhile, of each comment whose edit it doesn't show. */
  readonly edits: ReadonlyMap<
    string,
    { readonly text: string; readonly saving: string | undefined }
  >;
  /** What the timeline shows now, or never will, by the writes' keys. */
  readonly shown: ReadonlySet<string>;
  /**
   * The row of GitHub's copy that took each shown comment's place, by the key of the row that
   * stood for it, for the keyboard on it to go to.
   */
  readonly landed: ReadonlyMap<string, string>;
}

/**
 * The reader's writes `sent` as the timeline `timeline` on screen, drawn as `rows`, adds to them:
 * each comment it doesn't show as a row of `author`'s, the account that wrote them, `byAuthor`
 * when they opened the pull request, and each edit it doesn't show as the comment's new text.
 */
export function sentRows(
  sent: readonly OnPull[],
  timeline: Timeline | null | undefined,
  rows: readonly Row[],
  author: Person | undefined,
  byAuthor: boolean,
): SentRows {
  const extra: Row[] = [];
  const edits = new Map<string, { text: string; saving: string | undefined }>();
  const shown = new Set<string>();
  const landed = new Map<string, string>();
  for (const each of sent) {
    if (each.comment !== undefined) {
      if (timeline && each.state === 'sent' && showsEdit(timeline, each)) shown.add(each.key);
      else edits.set(each.comment, { text: each.text, saving: sentLabel(each) });
      continue;
    }
    // Who sent it is the tab's account: with none, nothing could have been sent.
    if (author === undefined) continue;
    if (timeline && showsComment(timeline, each, author.login)) {
      shown.add(each.key);
      const copy =
        each.copy === undefined
          ? newest(rows, each.text, author.login)
          : rows.find((row) => row.kind === 'comment' && row.id === each.copy)?.key;
      if (copy !== undefined) landed.set(sentKey(each), copy);
      continue;
    }
    extra.push({
      kind: 'sent',
      key: sentKey(each),
      author,
      body: each.text,
      byAuthor,
      sending: sentLabel(each),
      at: each.at === undefined ? undefined : new Date(each.at).toISOString(),
    });
  }
  return { rows: extra, edits, shown, landed };
}

/** What a write's card says in its time's place: while it's on its way, what's being done. */
function sentLabel(sent: OnPull): string | undefined {
  return sent.state === 'sent' ? undefined : sent.label;
}

/** A comment's text to compare, as GitHub gives it back: Unix line ends, trimmed. */
function plain(text: string): string {
  return text.replaceAll(/\r\n?/g, '\n').trim();
}

/** The key of the newest comment row of `rows` of account `login`'s whose text is `text`. */
function newest(rows: readonly Row[], text: string, login: string): string | undefined {
  const wanted = plain(text);
  const by = login.toLowerCase();
  return rows.findLast(
    (row) =>
      row.kind === 'comment' &&
      row.author?.login.toLowerCase() === by &&
      plain(row.body) === wanted,
  )?.key;
}
