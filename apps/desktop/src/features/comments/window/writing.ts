// Writing comments in a view's diff, worked out: where a comment on the cursor's line, the lines
// `v` selected or a file goes, as GitHub takes it and as main keeps its draft; where one on an
// overview's code block goes; where a draft's box goes in the diff as drawn, a reply's or an
// edit's in its thread; and what a box's frame says of where it is and how sending it stands, and
// why a change to a thread wasn't made.

import { CommentableLines, Line, type Lines, type Screen } from '@lo/review';
import type { OnFile, Place, Span } from '@lo/ui/code';

import { clockOf, savedWhen } from '../../../window/time.ts';
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
    case 'edit':
      return JSON.stringify([place.kind, place.thread, place.comment]);
    case 'conversation':
      return JSON.stringify([place.kind]);
    default:
      throw new Error(`a draft's place Lo doesn't know: ${JSON.stringify(place satisfies never)}`);
  }
}

/**
 * Where a draft's box goes in a diff as drawn: under the last of its lines, or under its file's
 * header, or, for a reply or an edit, in its thread, when the diff places it (`placed`). Nowhere
 * when the diff shows another head than the one it was written at, or not its file, or, for one on
 * the older side, another commit than the base there, as between revisions.
 */
export function boxAt(
  drawn: DrawnDiff,
  screen: Screen,
  place: DraftPlaceRow,
  placed: (thread: string) => boolean = () => false,
): { at: Place | Span | OnFile | { thread: string } } | undefined {
  // The pull request's own box isn't in the diff.
  if (place.kind === 'conversation') return undefined;
  if (place.kind !== 'thread')
    return placed(place.thread) ? { at: { thread: place.thread } } : undefined;
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

/** A side as the box's head says it. */
function sideWords(side: 'LEFT' | 'RIGHT'): string {
  return side === 'RIGHT' ? 'new side' : 'old side';
}

/**
 * Where a box's comment goes, as its head says: "On line 41, new side", "On lines 39–41, new side",
 * "On the file", "Reply to mira-chen's thread", "Edit your comment", "On the pull request".
 * `author` started the thread a reply is in, if GitHub still has the account.
 */
export function whereText(place: DraftPlaceRow, author?: string | null): string {
  if (place.kind === 'conversation') return 'On the pull request';
  if (place.kind === 'reply') {
    return author ? `Reply to ${author}’s thread` : 'Reply to the thread';
  }
  if (place.kind === 'edit') return 'Edit your comment';
  const { lines } = place;
  if (!lines) return 'On the file';
  const { start, end } = lines;
  if (!start) return `On line ${end.number}, ${sideWords(end.side)}`;
  if (start.side === end.side) {
    return `On lines ${start.number}–${end.number}, ${sideWords(end.side)}`;
  }
  return `On line ${start.number}, ${sideWords(start.side)}, to line ${end.number}, ${sideWords(end.side)}`;
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
      return note(
        'Your pending review is on the latest push, and GitHub adds its comments there, not to the revision on screen.',
        ['showLatest'],
      );
    case 'headMoved':
      return note('Someone pushed since, so GitHub would put it on the newer push.', ['loadNewer']);
    case 'notInDiff':
      return note('GitHub takes comments only on lines in the pull request’s diff.', ['onFile']);
    case 'paused':
      return note(actText(refusal, doing));
    case 'pendingUnknown':
      return note('Lo couldn’t tell whether you have a pending review. Send it again in a moment.');
    case 'signIn':
      return note('Sign in to comment');
    case 'run':
      return note('Comment in a layer');
    case 'github':
      return note(refusal.message);
    // An edit's: it's kept, and once it's discarded, an edit starts from GitHub's text.
    case 'changed':
    case 'gone':
      return note(actText(refusal, doing), ['discard']);
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

/** What a box says of how sending its text stands, if anything: an edit's, `edit`. */
export function sendingNote(sending: Sending | null, edit = false): BoxNote | undefined {
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
        text: edit
          ? 'GitHub’s answer was lost. Lo is checking whether it saved the edit.'
          : 'GitHub’s answer was lost. Lo is checking whether it posted.',
      };
    case 'notPosted':
      return {
        key: 'sending',
        tone: 'warning',
        text: edit ? 'It wasn’t saved. Save it again.' : 'It didn’t post. Send it again.',
      };
    case 'unknown':
      return {
        key: 'sending',
        tone: 'warning',
        text: edit ? 'Lo can’t tell whether it saved.' : 'Lo can’t tell whether it posted.',
        offers: ['sendAnyway'],
      };
    case 'changed':
    case 'gone':
      return {
        key: 'sending',
        tone: 'warning',
        text: actText({ kind: sending }, 'edit'),
        offers: ['discard'],
      };
    default:
      sending satisfies never;
      return undefined;
  }
}

/** What a box's notes say, in order: a restored draft, a refusal, how sending stands. */
export function notesOf(
  state: {
    readonly place?: DraftPlaceRow | undefined;
    readonly restored: number | undefined;
    readonly refusal: Refusal | undefined;
    readonly sending: Sending | null;
  },
  now: number,
): BoxNote[] {
  return [
    state.restored === undefined ? undefined : restoredNote(state.restored, now),
    state.refusal && refusalNote(state.refusal, state.place?.kind === 'edit' ? 'edit' : 'comment'),
    sendingNote(state.sending, state.place?.kind === 'edit'),
  ].filter((each) => each !== undefined);
}

/** What a box's notes offer to do now, in their order. */
export function offersOf(state: Parameters<typeof notesOf>[0]): Offer[] {
  return notesOf(state, 0).flatMap((each) => each.offers ?? []);
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

/** Why a thread takes no reply. */
export const NO_REPLY = 'GitHub doesn’t let you reply to this thread';

/** Why a line refuses a comment, after `c` on it: what `⏎` does next. */
export const NOT_IN_DIFF =
  'GitHub takes comments only on lines in the pull request’s diff. ⏎ comments on the file instead.';

/** Why a line refuses a comment where Lo couldn't read its file's patch: what `⏎` does next. */
export const NO_LINES =
  'Lo couldn’t read which of this file’s lines GitHub takes comments on. ⏎ comments on the file instead.';

/** Why sending is off while GitHub can't be reached. */
export const OFFLINE = 'Offline. Lo keeps this as a draft until you send it.';

/** Why a view acting as nobody can't write. */
export const SIGN_IN = 'Sign in to comment';

/** Why a run of a stack's layers can't take a comment. */
export const IN_A_LAYER = 'Comment in a layer';

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

/** What a box on a code block's lines says of a comment on their file, as GitHub refused them. */
export const ON_FILE_NOT_IN_DIFF = 'On the file, since GitHub takes line comments only in the diff';

/**
 * What a box on a code block's lines says of where its comment goes, when that's not those lines
 * at the overview's commit: their file or the pull request, and why; or the lines at a newer head.
 * Nothing when its place says it all.
 */
export function blockWhere(
  goes: BlockComment,
  place: DraftPlaceRow,
  names: BlockRevisions,
): string | undefined {
  switch (goes.kind) {
    case 'lines':
      return names.written === names.now ? undefined : `${whereText(place)}, at ${names.now}`;
    case 'pull':
      return goes.why === 'untouched'
        ? 'On the pull request, since it doesn’t change this file'
        : `On the pull request, since this file is gone at ${names.now}`;
    case 'file':
      return onFileWords(goes.why, names);
    default:
      goes satisfies never;
      return undefined;
  }
}

/** What a box on a code block's lines says of a comment on their file, and why it's there. */
function onFileWords(why: OnFileWhy, names: BlockRevisions): string {
  switch (why) {
    case 'notInDiff':
      return ON_FILE_NOT_IN_DIFF;
    case 'noLines':
      return 'On the file, since Lo couldn’t read which lines GitHub takes comments on';
    case 'changed':
      return `On the file, since these lines changed after ${names.written}`;
    case 'older':
      return `On the file, since Lo maps only new-side lines from ${names.written} to ${names.now}`;
    case 'unknown':
      return `On the file, since Lo can’t tell where these lines are at ${names.now}`;
    case 'deleted':
      return 'On the file, which this pull request deletes';
    default:
      why satisfies never;
      throw new Error(`Lo doesn't know why a comment goes on the file: ${String(why)}`);
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
