// What the reader wrote on the pull request itself that the timeline on screen doesn't show yet,
// as its rows draw it: a comment sent from the box at its end is its last row, drawn as its card
// will be, from the moment it's sent until the timeline shows GitHub's copy, which takes its place;
// an edit of one of their comments shows its new text in that comment's card until the timeline
// has it. Plain functions, tested alone.

import type { OnPull } from '../../comments/window/shared.ts';
import type { Timeline } from '../contract.ts';
import { holding, shows } from './holding.ts';
import type { Person, Row } from './rows.ts';

/**
 * What the timeline on screen held as a comment was first seen on its way, which tells GitHub's
 * copy of it from one with the same text before: how many comments it held with that text, and its
 * newest item's cursor.
 */
export interface Before {
  readonly had: number;
  readonly after: string | undefined;
}

/** What `timeline` holds, as a comment of `text` is first seen on its way. */
export function beforeOf(timeline: Timeline | null | undefined, text: string): Before {
  return { had: holding(timeline, text), after: timeline?.items.at(-1)?.cursor };
}

/** The key of the row a comment on its way draws as. */
export function sentKey(sent: OnPull): string {
  return `sent:${sent.key}`;
}

/** Whether `timeline` shows the comment `sent`, as it was before as `before` says. */
function showsComment(timeline: Timeline, sent: OnPull, before: Before): boolean {
  return shows(timeline, {
    write: { kind: 'posted', text: sent.text },
    until: Number.POSITIVE_INFINITY,
    had: before.had,
    after: before.after,
  });
}

/** Whether `timeline` shows the edit `sent`, or no longer has its comment. */
function showsEdit(timeline: Timeline, sent: OnPull): boolean {
  const { comment } = sent;
  if (comment === undefined) return true;
  return shows(timeline, {
    write: { kind: 'edited', comment, text: sent.text },
    until: Number.POSITIVE_INFINITY,
    had: 0,
  });
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
 * each comment it doesn't show as a row of `author`'s, `byAuthor` when they opened the pull
 * request, and each edit it doesn't show as the comment's new text. `before` is what the timeline
 * held as each comment was first seen on its way.
 */
export function sentRows(
  sent: readonly OnPull[],
  timeline: Timeline | null | undefined,
  rows: readonly Row[],
  before: ReadonlyMap<string, Before>,
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
    const was = before.get(each.key) ?? { had: 0, after: undefined };
    if (timeline && showsComment(timeline, each, was)) {
      shown.add(each.key);
      const copy = newest(rows, each.text);
      if (copy !== undefined) landed.set(sentKey(each), copy);
      continue;
    }
    // Who sent it is the tab's account: with none, nothing could have been sent.
    if (author === undefined) continue;
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

/** The key of the newest comment row of `rows` whose text is `text`. */
function newest(rows: readonly Row[], text: string): string | undefined {
  const wanted = plain(text);
  return rows.findLast((row) => row.kind === 'comment' && plain(row.body) === wanted)?.key;
}
