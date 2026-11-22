// Writing comments in a view's diff, worked out: where a comment on the cursor's line, the lines
// `v` selected or a file goes, as GitHub takes it and as main keeps its draft; where one on an
// overview's code block goes; where a draft's box goes in the diff as drawn, a reply's or an
// edit's in its thread, or whether it's one the timeline draws, as the pull request's own box and
// an edit of your comment on it are; and what a box's frame says of where it is and how sending it
// stands, and why a change to a thread, or to a comment, wasn't made.

import { CommentableLines, Line, type Lines, type Screen } from '@lo/review';
import type { OnFile, Place, Span } from '@lo/ui/code';

import { clockOf } from '../../../window/time.ts';
import type { DrawnDiff, ThreadedFile } from '../../diff/window/shared.ts';
import type { CommentOnHead, FileWhy } from '../../overview/window/shared.ts';
import type {
  ActRefusal,
  Commentable,
  CommentLinesRow,
  ConversationPlaceRow,
  DraftPlaceRow,
  HunkRow,
  SendRefusal,
  Sending,
  ThreadPlaceRow,
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
 * The lines a comment on `at`, the cursor's line or the lines `v` selected, goes on, as GitHub
 * takes it: nothing where it takes none, as outside the pull request's diff. An unchanged line
 * picked in the older column goes on the newer, as `CommentableLines` says.
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
 * them, at `head`, the head the diff's newer column shows.
 */
export function placeOf(head: string, path: string, lines: Lines | undefined): ThreadPlaceRow {
  return {
    kind: 'thread',
    commit: head.toLowerCase(),
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

/** The place of the comment box on the pull request itself: one a pull request. */
export const ON_PULL: ConversationPlaceRow = { kind: 'conversation' };

/**
 * Whether a draft's box, unless it opens under a code block it was written on, is drawn in the
 * timeline, not the diff: the pull request's own box, and an edit of your comment on the pull
 * request itself, which is in no thread.
 */
export function inTimeline(place: DraftPlaceRow): boolean {
  return place.kind === 'conversation' || (place.kind === 'edit' && place.thread === null);
}

/** A key for a draft's place: the same for the same place, however its object was made. */
export function placeKey(place: DraftPlaceRow): string {
  switch (place.kind) {
    case 'thread': {
      const { commit, path, lines } = place;
      return JSON.stringify([
        place.kind,
        commit.toLowerCase(),
        path,
        lines && lineKey(lines.start),
        lines && lineKey(lines.end),
      ]);
    }
    case 'reply':
      return JSON.stringify([place.kind, place.thread]);
    case 'conversation':
      return JSON.stringify([place.kind]);
    case 'edit':
      return JSON.stringify([place.kind, place.thread, place.comment]);
    default:
      throw new Error(`a draft's place Lo doesn't know: ${JSON.stringify(place satisfies never)}`);
  }
}

/**
 * Where a draft's box goes in a diff as drawn: under the last of its lines, or under its file's
 * header, or, for a reply or an edit, in its thread, when the diff places it (`placed`). Nowhere
 * when the diff shows another head than the one it was written at, or not its file, or, for one on
 * the older side, another commit than the base there, as between revisions; nor for a box the
 * timeline draws.
 */
export function boxAt(
  drawn: DrawnDiff,
  screen: Screen,
  place: DraftPlaceRow,
  placed: (thread: string) => boolean = () => false,
): { at: Place | Span | OnFile | { thread: string } } | undefined {
  // The pull request's own box isn't in the diff, nor an edit of a comment on it.
  if (place.kind === 'conversation') return undefined;
  if (place.kind !== 'thread') {
    const { thread } = place;
    return thread !== null && placed(thread) ? { at: { thread } } : undefined;
  }
  if (place.commit.toLowerCase() !== drawn.at.toLowerCase()) return undefined;
  const file = drawn.files.find((each) => githubPath(each) === place.path);
  if (!file) return undefined;
  if (!place.lines) return { at: { file: file.id } };
  const { start, end } = place.lines;
  const left = start?.side === 'LEFT' || end.side === 'LEFT';
  if (left && (file.since || screen.left.kind !== 'base')) return undefined;
  const side = end.side === 'RIGHT' ? 'new' : 'old';
  if (start && start.side === end.side) {
    return { at: { file: file.id, side, from: start.number, to: end.number } };
  }
  return { at: { file: file.id, side, line: end.number } };
}

/** A line as a line reference names it: the old side's is "removed", and the new side goes unsaid. */
function lineWords(line: CommentLinesRow['end']): string {
  return line.side === 'RIGHT' ? `${line.number}` : `${line.number}, removed`;
}

/**
 * A line reference, as data: what a comment or thread is on. Whatever names lines to the reader
 * holds one, and `lineRefText` is the only place it's put into words.
 *
 * - `lines`: the lines, each with its side, a span from `start` to `end`; `null` for the file
 *   itself; `undefined` where GitHub no longer gives a line.
 * - `revision`: the revision the lines are on, as its label names it, `r2`, where that isn't the
 *   revision on screen.
 */
export interface LineRef {
  readonly lines: CommentLinesRow | null | undefined;
  readonly revision?: string | undefined;
}

/**
 * A line reference in words, the one form a line is named in everywhere: "Line 41", "Lines 39–41",
 * "Line 41, removed", "Line 3, removed, to line 5", "File"; with the revision last where it's
 * given, "Line 9 · r1"; and the revision alone, "r1", where there's no line to name.
 */
export function lineRefText({ lines, revision }: LineRef): string {
  const on = lines === undefined ? undefined : linesText(lines);
  if (on === undefined) return revision ?? '';
  return revision === undefined ? on : `${on} · ${revision}`;
}

function linesText(lines: CommentLinesRow | null): string {
  if (!lines) return 'File';
  const { start, end } = lines;
  if (!start || (start.side === end.side && start.number === end.number)) {
    return `Line ${lineWords(end)}`;
  }
  if (start.side === end.side) return `Lines ${start.number}–${lineWords(end)}`;
  return `Line ${lineWords(start)}, to line ${lineWords(end)}`;
}

/**
 * What a box's comment is on, as its head says: its line reference, or "Pull request", "Reply",
 * "Edit".
 */
export function whereText(place: DraftPlaceRow): string {
  if (place.kind === 'conversation') return 'Pull request';
  if (place.kind === 'reply') return 'Reply';
  if (place.kind === 'edit') return 'Edit';
  return lineRefText({ lines: place.lines });
}

/** What a box's note offers to do about what it says. */
export type Offer = 'showLatest' | 'loadNewer' | 'onFile' | 'sendAgain' | 'checkAgain' | 'discard';

/**
 * The words on an offer's button. Sending again is "Try again" there, under a title that says what
 * wasn't sent.
 */
export const offerLabels: Readonly<Record<Offer, string>> = {
  showLatest: 'Show latest',
  loadNewer: 'Show latest',
  onFile: 'Comment on file',
  sendAgain: 'Try again',
  checkAgain: 'Check again',
  discard: 'Discard draft',
};

/** A note in a box's frame, before it's drawn. */
export interface BoxNote {
  readonly key: string;
  readonly tone: 'info' | 'warning';
  readonly icon?: 'clock' | 'blocked' | undefined;
  /** What wasn't done, for a send that failed: `text` is then why. */
  readonly title?: string | undefined;
  readonly text: string;
  readonly offers?: readonly Offer[] | undefined;
}

/** A refusal's note. */
function note(text: string, offers?: readonly Offer[], title?: string): BoxNote {
  return { key: 'refusal', tone: 'warning', icon: 'blocked', title, text, offers };
}

/** What a box's note is titled once its text, a comment or an edit, wasn't sent. */
const COULDNT: Readonly<Record<'comment' | 'edit', string>> = {
  comment: 'Couldn’t send the comment',
  edit: 'Couldn’t save the comment',
};

/** What a box's note is titled while nobody knows whether GitHub took its text. */
const NOT_CONFIRMED: Readonly<Record<'comment' | 'edit', string>> = {
  comment: 'Comment not confirmed',
  edit: 'Edit not confirmed',
};

/** Why a send failed, or isn't confirmed, when GitHub's answer never came. */
const NO_ANSWER = 'GitHub didn’t respond.';

/**
 * Why a box's buttons don't send while nobody knows whether its text is on GitHub already: sending
 * it then could post it twice, so "Check again" comes first.
 */
export const CHECK_FIRST = 'Check again first';

/** Why a box's text, or a change to a thread, wasn't sent. */
export type Refusal = SendRefusal | ActRefusal;

/** What was being done: a comment written, an edit saved, or a change to a thread. */
export type Doing = 'comment' | 'edit' | 'resolve' | 'unresolve' | 'delete';

/** How the end of a sentence asks for it again: "Send it then." */
const AGAIN: Readonly<Record<Doing, string>> = {
  comment: 'Send it',
  edit: 'Save it',
  resolve: 'Resolve it',
  unresolve: 'Unresolve it',
  delete: 'Delete it',
};

/** Why GitHub doesn't let you change a comment, by its reasons (`CommentCannotUpdateReason`). */
const CANNOT: Readonly<Record<string, string>> = {
  ARCHIVED: 'the repository is archived',
  LOCKED: 'the conversation is locked',
  INSUFFICIENT_ACCESS: 'your account can’t write there',
  VERIFIED_EMAIL_REQUIRED: 'your account’s email address isn’t verified',
  LOGIN_REQUIRED: 'your account is signed out',
  MAINTENANCE: 'GitHub is under maintenance',
};

/**
 * Why a change to a thread, or to one of your comments, wasn't made, in Lo's words, with what to
 * do. The refusals of a comment written are its box's (`refusalNote`).
 */
export function actText(refusal: ActRefusal, doing: Doing): string {
  switch (refusal.kind) {
    case 'theirs':
      return `It’s ${refusal.author ?? 'a deleted account'}’s comment. You can edit and delete only your own.`;
    case 'notAllowed': {
      const why = refusal.reasons.map((reason) => CANNOT[reason]).find((each) => each);
      const verb = doing === 'delete' ? 'delete' : 'edit';
      return why === undefined
        ? `GitHub doesn’t let you ${verb} it now.`
        : `GitHub doesn’t let you ${verb} it: ${why}.`;
    }
    case 'cantResolve':
      return `GitHub doesn’t let you ${refusal.resolved ? 'resolve' : 'unresolve'} this thread. The pull request’s author and people who can write to the repository can.`;
    case 'changed':
      return doing === 'delete'
        ? 'It changed on GitHub since you asked. Look at it again, then delete it.'
        : 'It was edited on GitHub since you started. Your text is kept here; copy it, then edit again.';
    case 'gone':
      if (doing === 'edit') {
        return 'It was deleted on GitHub. Your text is kept here; copy it, then discard it.';
      }
      return doing === 'delete'
        ? 'It’s gone from GitHub already.'
        : 'The thread is gone from GitHub.';
    case 'busy':
      return 'It’s being sent already, or Lo is still checking whether it went.';
    case 'paused':
      return `GitHub asked Lo to hold off until ${clockOf(refusal.until)}. ${AGAIN[doing]} then.`;
    case 'signIn':
      return SIGN_IN;
    case 'run':
      return IN_A_LAYER;
    case 'github':
      return refusal.message;
    default:
      refusal satisfies never;
      return 'GitHub didn’t take it.';
  }
}

/** What a box says of why its text, a comment or an edit, wasn't sent, and what it offers to do. */
export function refusalNote(refusal: Refusal, doing: 'comment' | 'edit' = 'comment'): BoxNote {
  switch (refusal.kind) {
    case 'notLatest':
      return note('This revision is out of date.', ['showLatest'], COULDNT[doing]);
    case 'headMoved':
      return note('This revision is out of date.', ['loadNewer'], COULDNT[doing]);
    case 'notInDiff':
      return note('Those lines aren’t in the diff.', ['onFile']);
    case 'paused':
      return note(
        `GitHub’s rate limit resets at ${clockOf(refusal.until)}.`,
        undefined,
        COULDNT[doing],
      );
    // Nothing was sent, so sending it again is safe.
    case 'pendingUnknown':
      return note(NO_ANSWER, ['sendAgain'], COULDNT[doing]);
    // Sent before, and nobody knows whether it posted: only a look says whether it can go again.
    case 'unconfirmed':
      return unconfirmed(doing);
    case 'signIn':
      return note(SIGN_IN);
    case 'run':
      return note(IN_A_LAYER);
    case 'github':
      return note(refusal.message, undefined, COULDNT[doing]);
    // An edit's: it's kept, and once it's discarded, an edit starts from GitHub's text.
    case 'changed':
      return note('It was edited elsewhere.', ['discard'], COULDNT.edit);
    case 'gone':
      return note('It was deleted elsewhere.', ['discard'], COULDNT.edit);
    case 'theirs':
    case 'notAllowed':
    case 'cantResolve':
    case 'busy':
      return note(actText(refusal, doing));
    default:
      refusal satisfies never;
      return note('GitHub didn’t take it.');
  }
}

/** What a box says while nobody knows whether GitHub took its text: it offers to look. */
function unconfirmed(doing: 'comment' | 'edit'): BoxNote {
  return {
    key: 'sending',
    tone: 'warning',
    title: NOT_CONFIRMED[doing],
    text: NO_ANSWER,
    offers: ['checkAgain'],
  };
}

/**
 * What a box says of how sending its text stands, once it's the open box again: an edit's, `edit`.
 * While the text is on its way, or Lo is looking whether it went, the box is the comment's card,
 * which says so itself. Known not to have gone, it offers to send it again; not known, only to look
 * again, since sending it then could post it twice.
 */
export function sendingNote(sending: Sending | null, edit = false): BoxNote | undefined {
  const doing = edit ? 'edit' : 'comment';
  switch (sending) {
    case null:
    case 'waiting':
    case 'sending':
    case 'checking':
      return undefined;
    case 'notPosted':
      return {
        key: 'sending',
        tone: 'warning',
        title: COULDNT[doing],
        text: NO_ANSWER,
        offers: ['sendAgain'],
      };
    case 'unknown':
      return unconfirmed(doing);
    case 'changed':
      return note('It was edited elsewhere.', ['discard'], COULDNT.edit);
    case 'gone':
      return note('It was deleted elsewhere.', ['discard'], COULDNT.edit);
    default:
      sending satisfies never;
      return undefined;
  }
}

/** What a box's notes say, in order: a refusal, then how sending stands. */
export function notesOf(state: {
  readonly place?: DraftPlaceRow | undefined;
  readonly refusal: Refusal | undefined;
  readonly sending: Sending | null;
}): BoxNote[] {
  const notes = [
    state.refusal && refusalNote(state.refusal, state.place?.kind === 'edit' ? 'edit' : 'comment'),
    sendingNote(state.sending, state.place?.kind === 'edit'),
  ].filter((each) => each !== undefined);
  // One note for one thing: a refusal that says what the standing does is said once.
  return notes.filter((each, at) => notes.findIndex((other) => other.key === each.key) === at);
}

/** What a sent comment's card says while GitHub hasn't answered for it: an edit's, `edit`. */
export function sentLabel(sending: Sending | null, edit: boolean): string {
  if (sending === 'checking') return 'Checking…';
  return edit ? 'Saving…' : 'Sending…';
}

/** What a box's notes offer to do now, in their order. */
export function offersOf(state: Parameters<typeof notesOf>[0]): Offer[] {
  return notesOf(state).flatMap((each) => each.offers ?? []);
}

/** Why a thread takes no reply. */
export const NO_REPLY = 'GitHub doesn’t let you reply to this thread';

/** Why a line refuses a comment, after `c` on it: what `⏎` does next. */
export const NOT_IN_DIFF =
  'GitHub takes comments only on lines in the pull request’s diff. ⏎ comments on the file instead.';

/** Why a line refuses a comment where Lo couldn't read its file's patch: what `⏎` does next. */
export const NO_LINES =
  'Lo couldn’t read which of this file’s lines GitHub takes comments on. ⏎ comments on the file instead.';

/** Why sending is off while GitHub can't be reached. */
export const OFFLINE = 'Offline';

/** Why a view acting as nobody can't write. */
export const SIGN_IN = 'Sign in to comment';

/** Why a run of a stack's layers can't take a comment. */
export const IN_A_LAYER = 'Show a single layer to comment';

/** Why a box with no text can't send. */
export const BLANK = 'Write a comment first';

/** Why a box with no text has no draft to discard. */
export const NOTHING_TO_DISCARD = 'Nothing to discard';

/** Why "Undo discard" does nothing once the draft discarded is back, or its time is up. */
export const NOTHING_TO_UNDO = 'Nothing to undo';

/** What the toast says of a draft just discarded, and what its button brings it back with. */
export const DISCARDED = 'Discarded draft';
export const UNDO = 'Undo';

/** Why a suggestion can't go on the older side. */
export const NEW_SIDE_ONLY =
  'Suggestions work on the new side only, since GitHub applies them there';

/**
 * Why a comment on a code block's lines goes on their file: GitHub takes line comments only on
 * lines in its diff (`notInDiff`); Lo couldn't read which lines it takes (`noLines`); the lines
 * `changed` since the overview's commit; they're on the `older` side, which Lo doesn't map past
 * that commit; Lo can't tell where they are at the head (`unknown`); or the pull request deletes
 * the file (`deleted`), which GitHub still takes a comment on.
 */
export type OnFileWhy = 'notInDiff' | 'noLines' | FileWhy | 'deleted';

/**
 * Why a comment on a code block's lines goes on the pull request itself: the pull request leaves
 * their file alone (`untouched`), or the file is gone at the head, and GitHub takes no comment on it
 * (`gone`).
 */
export type OnPullWhy = 'untouched' | 'gone';

/** Why a comment on a code block's lines goes elsewhere than those lines, as main keeps it. */
export type BlockWhy = OnFileWhy | OnPullWhy;

/** Why a comment goes where `goes` says, if that's not the block's lines. */
export function whyOf(goes: BlockComment): BlockWhy | null {
  return goes.kind === 'lines' ? null : goes.why;
}

/**
 * What a comment on a code block's lines goes on: the lines at the head on screen they are, a
 * comment on their file, or one on the pull request itself, each saying why.
 */
export type BlockComment =
  | { readonly kind: 'lines'; readonly lines: Lines }
  | { readonly kind: 'file'; readonly why: OnFileWhy }
  | { readonly kind: 'pull'; readonly why: OnPullWhy };

/**
 * Where a comment on a code block's lines goes, as GitHub takes it, from where they are at the head
 * on screen (`onHead`) and what GitHub takes on their file there (`takes`, none where main couldn't
 * read it): on those lines, where they're there unchanged and GitHub takes a comment on them;
 * otherwise on the file, where the pull request changes or deletes it, or where Lo can't tell;
 * otherwise on the pull request itself, as for a file it leaves alone, or one gone.
 */
export function blockComment(
  onHead: CommentOnHead,
  takes: CommentableLines | undefined,
): BlockComment {
  if (onHead.kind === 'gone') {
    return takes?.takesFileComment()
      ? { kind: 'file', why: 'deleted' }
      : { kind: 'pull', why: 'gone' };
  }
  if (takes && !takes.takesFileComment()) return { kind: 'pull', why: 'untouched' };
  if (onHead.kind === 'file') return { kind: 'file', why: onHead.why };
  const { side, from, to } = onHead;
  const at: Place | Span =
    from === to ? { file: '', side, line: to } : { file: '', side, from, to };
  const lines = linesAt(takes, at);
  if (lines) return { kind: 'lines', lines };
  return { kind: 'file', why: takes ? 'notInDiff' : 'noLines' };
}

/**
 * What the reader calls the revisions a comment on a code block is between: the one the overview
 * describes (`written`) and the head on screen (`now`), as `r1` and `r2`.
 */
export interface BlockRevisions {
  readonly written: string;
  readonly now: string;
}

/** `text` with its first letter lowered, to follow a comma. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * What a box's head says where its place doesn't say it all: what the comment is on, and, under
 * it, why that's not what was picked.
 */
export interface BoxWhere {
  readonly head: string;
  readonly why?: string | undefined;
}

/** What a box on a code block's lines says of a comment on their file, as GitHub refused them. */
export const ON_FILE_NOT_IN_DIFF: BoxWhere = {
  head: 'File',
  why: 'Those lines aren’t in the diff.',
};

/**
 * What a box on a code block's lines says of where its comment, at `place`, goes, when that's not
 * those lines at the overview's commit: their file or the pull request, and `why`; or, with no
 * `why`, the lines at a newer head, "Line 3 · r5". Nothing when its place says it all.
 */
export function blockWhere(
  why: BlockWhy | null,
  place: DraftPlaceRow,
  names: BlockRevisions,
): BoxWhere | undefined {
  if (why === null) {
    const onLines = place.kind === 'thread' && place.lines !== null;
    return !onLines || names.written === names.now
      ? undefined
      : { head: lineRefText({ lines: place.lines, revision: names.now }) };
  }
  return whyWords(why, names);
}

/** What a box on a code block's lines says of a comment on their file or the pull request, and why. */
function whyWords(why: BlockWhy, names: BlockRevisions): BoxWhere {
  switch (why) {
    case 'untouched':
      return { head: 'Pull request', why: 'This pull request doesn’t change this file.' };
    case 'gone':
      return { head: 'Pull request', why: `This file is deleted in ${names.now}.` };
    case 'notInDiff':
      return ON_FILE_NOT_IN_DIFF;
    case 'noLines':
      return { head: 'File', why: 'Couldn’t check which lines take comments.' };
    case 'changed':
      return { head: 'File', why: `These lines changed since ${names.written}.` };
    // Where the lines are at the head isn't known: whether they changed since isn't either.
    case 'unknown':
      return { head: 'File', why: `Couldn’t follow these lines to ${names.now}.` };
    case 'older':
      return { head: 'File', why: `Removed lines can’t be followed to ${names.now}.` };
    case 'deleted':
      return { head: 'File', why: 'This pull request deletes this file.' };
    default:
      why satisfies never;
      throw new Error(`Lo doesn't know why a comment goes elsewhere: ${String(why)}`);
  }
}

/**
 * What's said once a comment written on a code block is sent, where it won't show under the block:
 * on the pull request, on the file, or on lines of a newer head than `written`, the overview's
 * commit. `pending` when it went into your pending review. Nothing when it shows under the block.
 */
export function sentFromBlock(
  place: DraftPlaceRow,
  written: string,
  pending: boolean,
  names: BlockRevisions,
): { readonly title: string; readonly body: string } | undefined {
  if (place.kind === 'conversation') {
    return { title: 'Posted on the pull request', body: 'It shows in the timeline.' };
  }
  if (place.kind !== 'thread') return undefined;
  if (!place.lines) {
    return {
      title: pending ? 'Added to your review, on the file' : 'Posted on the file',
      body: `${place.path}. It shows under the file’s header in the diff.`,
    };
  }
  if (place.commit.toLowerCase() === written.toLowerCase()) return undefined;
  return {
    title: pending ? `Added to your review, at ${names.now}` : `Posted at ${names.now}`,
    body: `${place.path}, ${lowerFirst(whereText(place))}. It shows in the diff; this block shows ${names.written}.`,
  };
}
