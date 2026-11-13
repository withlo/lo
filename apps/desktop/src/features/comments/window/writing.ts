// Writing comments in a view's diff, worked out: where a comment on the cursor's line, the lines `v`
// selected or a file goes, as GitHub takes it and as main keeps its draft; where a draft's box goes
// in the diff as drawn; and what a box's frame says of where it is and how sending it stands.

import { CommentableLines, Line, type Lines, type Screen } from '@lo/review';
import type { OnFile, Place, Span } from '@lo/ui/code';

import type { DrawnDiff, ThreadedFile } from '../../diff/window/shared.ts';
import type {
  Commentable,
  CommentLinesRow,
  DraftPlaceRow,
  HunkRow,
  SendRefusal,
  Sending,
} from '../contract.ts';

/**
 * The path GitHub names file `file` by in a comment: the head's, or the base's for a file the pull
 * request deletes.
 */
export function githubPath(file: ThreadedFile): string | undefined {
  return file.path ?? file.old ?? undefined;
}

/** A hunk of a file's patch, as `CommentableLines` reads it. */
type Hunk = Parameters<typeof CommentableLines.inDiff>[1][number];
type HunkLine = Hunk['lines'][number];

const kinds: Readonly<Record<string, HunkLine['kind']>> = {
  ' ': 'unchanged',
  '-': 'deleted',
  '+': 'added',
};

/** A file's hunks as `@lo/review` reads them, from the rows main sent. */
export function hunksOf(rows: readonly HunkRow[]): Hunk[] {
  return rows.map((row) => {
    const lines = row.kinds.split('').map((kind): HunkLine => ({ kind: kinds[kind]!, text: '' }));
    const old = lines.filter((line) => line.kind !== 'added').length;
    const added = lines.filter((line) => line.kind !== 'deleted').length;
    return {
      old: { start: row.old, end: row.old + old },
      new: { start: row.new, end: row.new + added },
      lines,
    };
  });
}

/**
 * Which comments a file shown on `screen` takes, as main read its patch: none where main couldn't
 * read it, which leaves a comment on the file only.
 */
export function commentableOn(
  screen: Screen,
  commentable: Commentable,
): CommentableLines | undefined {
  switch (commentable.kind) {
    case 'diff':
      return CommentableLines.inDiff(screen, hunksOf(commentable.hunks));
    case 'notInDiff':
      return CommentableLines.notInDiff();
    case 'unknown':
      return undefined;
    default:
      commentable satisfies never;
      return undefined;
  }
}

/** A side of a diff as GitHub names it. */
function githubSide(side: 'old' | 'new'): 'LEFT' | 'RIGHT' {
  return side === 'new' ? 'RIGHT' : 'LEFT';
}

/**
 * The lines a comment on `at`, the cursor's line or the lines `v` selected, goes on, as GitHub takes
 * it: nothing where it takes none, as outside the pull request's diff. An unchanged line picked in
 * the older column goes on the newer, as `CommentableLines` says.
 */
export function linesAt(
  commentable: CommentableLines | undefined,
  at: Place | Span,
): Lines | undefined {
  if (!commentable) return undefined;
  const side = githubSide(at.side);
  if ('line' in at) return commentable.line(Line.of(side, at.line));
  const range = commentable.range(Line.of(side, at.from), Line.of(side, at.to));
  return range.kind === 'lines' ? range.lines : undefined;
}

function lineRow(line: Line): CommentLinesRow['end'] {
  return { side: line.side, number: line.number };
}

/**
 * The place main keeps the draft of a comment by: on `lines` of `file`, or on the file without
 * them, at the head the diff's newer column shows.
 */
export function placeOf(drawn: DrawnDiff, path: string, lines: Lines | undefined): DraftPlaceRow {
  return {
    kind: 'thread',
    commit: drawn.at.toLowerCase(),
    path,
    lines: lines
      ? { start: lines.start ? lineRow(lines.start) : null, end: lineRow(lines.end) }
      : null,
  };
}

/** A line of a draft's place, for its key. */
function lineKey(each: CommentLinesRow['end'] | null): string {
  return each ? `${each.side}${each.number}` : '';
}

/** A key for a draft's place: the same for the same place, however its object was made. */
export function placeKey(place: DraftPlaceRow): string {
  const { commit, path, lines } = place;
  return JSON.stringify([
    place.kind,
    commit.toLowerCase(),
    path,
    lines && lineKey(lines.start),
    lines && lineKey(lines.end),
  ]);
}

/**
 * Where a draft's box goes in a diff as drawn: under the last of its lines, or under its file's
 * header. Nowhere when the diff shows another head than the one it was written at, or not its file,
 * or, for one on the older side, another commit than the base there, as between revisions.
 */
export function boxAt(
  drawn: DrawnDiff,
  screen: Screen,
  place: DraftPlaceRow,
): { file: ThreadedFile; at: Place | Span | OnFile } | undefined {
  if (place.commit.toLowerCase() !== drawn.at.toLowerCase()) return undefined;
  const file = drawn.files.find((each) => githubPath(each) === place.path);
  if (!file) return undefined;
  if (!place.lines) return { file, at: { file: file.id } };
  const { start, end } = place.lines;
  const left = start?.side === 'LEFT' || end.side === 'LEFT';
  if (left && (file.since || screen.left.kind !== 'base')) return undefined;
  const side = end.side === 'RIGHT' ? 'new' : 'old';
  if (start && start.side === end.side) {
    return { file, at: { file: file.id, side, from: start.number, to: end.number } };
  }
  return { file, at: { file: file.id, side, line: end.number } };
}

/** A side as the box's head says it. */
function sideWords(side: 'LEFT' | 'RIGHT'): string {
  return side === 'RIGHT' ? 'new side' : 'old side';
}

/**
 * Where a box's comment goes, as its head says: "On line 41, new side", "On lines 39–41, new side",
 * "On the file".
 */
export function whereText(place: DraftPlaceRow): string {
  const { lines } = place;
  if (!lines) return 'On the file';
  const { start, end } = lines;
  if (!start) return `On line ${end.number}, ${sideWords(end.side)}`;
  if (start.side === end.side) {
    return `On lines ${start.number}–${end.number}, ${sideWords(end.side)}`;
  }
  return `On line ${start.number}, ${sideWords(start.side)}, to line ${end.number}, ${sideWords(end.side)}`;
}

/** A time of day, as the system shows it: "14:05". */
export function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** When a draft was saved, as a restored one's note says: "today, 09:12", "yesterday, 18:40". */
export function savedWhen(at: number, now: number): string {
  const when = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const time = clockOf(at);
  if (when.toDateString() === today.toDateString()) return `today, ${time}`;
  if (when.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`;
  return `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** What a box's note offers to do about what it says. */
export type Offer = 'showLatest' | 'loadNewer' | 'onFile' | 'sendAnyway' | 'discard';

/** The words on an offer's button. */
export const offerLabels: Readonly<Record<Offer, string>> = {
  showLatest: 'Show the latest',
  loadNewer: 'Load the newer push',
  onFile: 'Comment on the file',
  sendAnyway: 'Send it anyway',
  discard: 'Discard',
};

/** A note in a box's frame, before it's drawn. */
export interface BoxNote {
  readonly key: string;
  readonly tone: 'info' | 'warning';
  readonly icon?: 'clock' | 'blocked' | undefined;
  readonly text: string;
  readonly offers?: readonly Offer[] | undefined;
}

/** A refusal's note. */
function note(text: string, offers?: readonly Offer[]): BoxNote {
  return { key: 'refusal', tone: 'warning', icon: 'blocked', text, offers };
}

/** What a box says of why its comment wasn't sent, and what it offers to do. */
export function refusalNote(refusal: SendRefusal): BoxNote {
  switch (refusal.kind) {
    case 'notLatest':
      return note(
        'Your pending review is on the latest push, and GitHub adds its comments there, not to the revision on screen.',
        ['showLatest'],
      );
    case 'headMoved':
      return note('Someone pushed since, so GitHub would put it on the newer push.', ['loadNewer']);
    case 'notInDiff':
      return note('GitHub takes comments only on lines in the pull request’s diff.', ['onFile']);
    case 'paused':
      return note(`GitHub asked Lo to hold off until ${clockOf(refusal.until)}. Send it then.`);
    case 'pendingUnknown':
      return note('Lo couldn’t tell whether you have a pending review. Send it again in a moment.');
    case 'signIn':
      return note('Sign in to comment');
    case 'run':
      return note('Comment in a layer');
    case 'github':
      return note(refusal.message);
    default:
      refusal satisfies never;
      return note('GitHub didn’t take it.');
  }
}

/** What a box says of how sending its comment stands, if anything. */
export function sendingNote(sending: Sending | null): BoxNote | undefined {
  switch (sending) {
    case null:
    case 'sending':
      return undefined;
    case 'waiting':
      return { key: 'sending', tone: 'info', text: 'Waiting for your last comment' };
    case 'checking':
      return {
        key: 'sending',
        tone: 'info',
        text: 'GitHub’s answer was lost. Lo is checking whether it posted.',
      };
    case 'notPosted':
      return { key: 'sending', tone: 'warning', text: 'It didn’t post. Send it again.' };
    case 'unknown':
      return {
        key: 'sending',
        tone: 'warning',
        text: 'Lo can’t tell whether it posted.',
        offers: ['sendAnyway'],
      };
    default:
      sending satisfies never;
      return undefined;
  }
}

/** What a restored draft's box says. */
export function restoredNote(savedAt: number, now: number): BoxNote {
  return {
    key: 'restored',
    tone: 'info',
    icon: 'clock',
    text: `Restored your draft from ${savedWhen(savedAt, now)}.`,
    offers: ['discard'],
  };
}

/** Why a line refuses a comment, after `c` on it: what `⏎` does next. */
export const NOT_IN_DIFF =
  'GitHub takes comments only on lines in the pull request’s diff. ⏎ comments on the file instead.';

/** Why sending is off while GitHub can't be reached. */
export const OFFLINE = 'Offline. Lo keeps this as a draft until you send it.';

/** Why a view acting as nobody can't write. */
export const SIGN_IN = 'Sign in to comment';

/** Why a run of a stack's layers can't take a comment. */
export const IN_A_LAYER = 'Comment in a layer';

/** Why a suggestion can't go on the older side. */
export const NEW_SIDE_ONLY =
  'Suggestions work on the new side only, since GitHub applies them there';
