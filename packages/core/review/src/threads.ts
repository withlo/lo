/**
 * Review threads (`docs/design.md`, "Comments", "Threads panel"): what a thread is on, and its
 * comments.
 *
 * {@link threadFromGithub} fills a {@link Thread} from GraphQL's `PullRequestReviewThread`, as
 * `@lo/github` reads it. `./threads/place.ts` says where a thread shows in the diff on screen:
 * under a line of either column, on the file's header, or only in the threads panel. GitHub
 * reports a thread's current lines on its first comment's commit. On each push it moves the
 * thread to the new head while its lines are unchanged, and marks it outdated once they change. An
 * outdated thread still shows where it was written whenever the diff on screen shows that
 * revision. `./threads/panel.ts` lists the threads the threads panel shows.
 *
 * `./threads/commentable.ts` says which lines of a file on screen GitHub takes a new comment on,
 * and whether it takes a file-level comment. `./threads/suggestion.ts` starts a suggested change.
 */

import type { ReviewThread, ReviewThreadComment, ReviewThreadList } from '@lo/github';

/**
 * The sides of a pull request's diff, by GraphQL's `DiffSide` names. `LEFT` is the base's version
 * of a file and `RIGHT` the head's.
 */
export const DIFF_SIDES = ['LEFT', 'RIGHT'] as const;

/** A side of a pull request's diff: GraphQL's `DiffSide`. */
export type DiffSide = (typeof DIFF_SIDES)[number];

/**
 * What a thread can be on, by GraphQL's `PullRequestReviewThreadSubjectType` names: `LINE` for one
 * line or a range of lines, `FILE` for the whole file.
 */
export const SUBJECTS = ['LINE', 'FILE'] as const;

/** What a thread is on: GraphQL's `PullRequestReviewThreadSubjectType`. */
export type Subject = (typeof SUBJECTS)[number];

/**
 * Whether a comment is posted, by GraphQL's `PullRequestReviewCommentState` names: `PENDING` while
 * it's in your pending review, which only you see, and `SUBMITTED` once it's posted.
 */
export const COMMENT_STATES = ['PENDING', 'SUBMITTED'] as const;

/** Whether a comment is posted: GraphQL's `PullRequestReviewCommentState`. */
export type CommentState = (typeof COMMENT_STATES)[number];

/** A 1-based line on one side of a diff. */
export interface Line {
  readonly side: DiffSide;
  readonly number: number;
}

/** Making and comparing {@link Line}s. */
export const Line = {
  /** Line `number` of `side`. */
  of: (side: DiffSide, number: number): Line => ({ side, number }),

  /** A line of the base's version of the file. */
  left: (number: number): Line => ({ side: 'LEFT', number }),

  /** A line of the head's version of the file. */
  right: (number: number): Line => ({ side: 'RIGHT', number }),

  /** Whether `a` and `b` are the same line. */
  equals: (a: Line, b: Line): boolean => a.side === b.side && a.number === b.number,
};

/**
 * The lines a comment is on: one line, or a range that can start on the other side, as GitHub's
 * `startLine` and `startDiffSide` allow.
 */
export interface Lines {
  /** The first line of a range, or nothing for one line. */
  readonly start?: Line | undefined;
  /** The last line, which a thread shows under. */
  readonly end: Line;
}

/** Making and reading {@link Lines}. */
export const Lines = {
  /** One line. */
  one: (line: Line): Lines => ({ end: line }),

  /** The lines from `start` to `end`. A range of one line is that line. */
  range: (start: Line, end: Line): Lines => (Line.equals(start, end) ? { end } : { start, end }),

  /** The first line. */
  first: (lines: Lines): Line => lines.start ?? lines.end,

  /** Whether the lines are a range of more than one line. */
  isRange: (lines: Lines): boolean => lines.start !== undefined,
};

/**
 * A review thread, as GraphQL's `PullRequestReviewThread` describes it. Field docs name the
 * GraphQL field each one comes from.
 *
 * GitHub keeps two places for a line thread: where it is now (`line`, `startLine`, on
 * `currentOn`), while its lines are unchanged since it was written, and where it was written
 * (`originalLine`, `originalStartLine`, on `writtenOn`). Both use the same sides.
 *
 * GitHub gives a one-line thread a `startLine` equal to its `line`, or none, and never a
 * `startDiffSide`; it gives a file-level thread `line: 1`. Neither makes a range.
 */
export interface Thread {
  /** `id`. */
  id: string;
  /** `path`. */
  path: string;
  /** `subjectType`. */
  subject: Subject;
  /** `diffSide`: the side of its last line. */
  side: DiffSide;
  /**
   * `startDiffSide`: the side of its first line, for a range. GitHub sets it for every range; when
   * it's missing and a start line is set, the range starts on `side`.
   */
  startSide: DiffSide | undefined;
  /**
   * `line`: its last line on `currentOn`. Missing once it's outdated. A file-level thread has no
   * lines, whatever GitHub gives here.
   */
  line: number | undefined;
  /** `startLine`: its first line on `currentOn`, for a range. */
  startLine: number | undefined;
  /** `originalLine`: its last line on the revision it was written on. */
  originalLine: number | undefined;
  /** `originalStartLine`: its first line on the revision it was written on, for a range. */
  originalStartLine: number | undefined;
  /** `isOutdated`: its lines changed after it was written. */
  outdated: boolean;
  /** `isResolved`. */
  resolved: boolean;
  /**
   * The revision `line` and `startLine` are on, by head SHA: its first comment's `commit.oid`.
   * GitHub moves a thread to each new head when it's pushed, while the thread's lines are
   * unchanged, so this is usually the latest head. A thread written on an older revision after a
   * newer one was pushed stays on the older one until the next push, and one read just before a
   * push is on the head before it. Once outdated it's `writtenOn`. Missing when GitHub no longer
   * has the commit.
   */
  currentOn: string | undefined;
  /**
   * The revision it was written on, by head SHA: its first comment's `originalCommit.oid`. Missing
   * when GitHub no longer has the commit.
   */
  writtenOn: string | undefined;
  /** `comments`, oldest first. */
  comments: ThreadComment[];
  /** `viewerCanReply`: whether you can reply to it. */
  viewerCanReply: boolean;
  /** `viewerCanResolve`: whether you can resolve it. GitHub says no while it's resolved. */
  viewerCanResolve: boolean;
  /** `viewerCanUnresolve`: whether you can unresolve it. GitHub says no while it isn't resolved. */
  viewerCanUnresolve: boolean;
}

/** A comment in a thread, as GraphQL's `PullRequestReviewComment` describes it. */
export interface ThreadComment {
  /** `id`. */
  id: string;
  /** `author.login`. Missing for a deleted account, which GitHub shows as "ghost". */
  author: string | undefined;
  /** `body`, in Markdown. */
  body: string;
  /** `state`. */
  state: CommentState;
  /** `createdAt`, as GitHub gives it: an ISO 8601 time. */
  createdAt: string;
  /** `url`: where it is on GitHub. */
  url: string;
  /**
   * Why it's hidden, when someone hid it (`isMinimized`): `minimizedReason`, such as `outdated` or
   * `spam`, or an empty string when GitHub gives none. GitHub shows a hidden comment collapsed.
   */
  hidden: string | undefined;
  /** `viewerCanUpdate`: whether you can edit it. */
  viewerCanUpdate: boolean;
  /** `viewerCanDelete`: whether you can delete it. */
  viewerCanDelete: boolean;
}

/** Reading {@link Thread}s. */
export const Thread = {
  /** Its lines on `currentOn`: nothing for a file-level thread, and once it's outdated. */
  currentLines: (thread: Thread): Lines | undefined =>
    linesOf(thread, thread.startLine, thread.line),

  /** Its lines on the revision it was written on, `writtenOn`. Nothing for a file-level thread. */
  writtenLines: (thread: Thread): Lines | undefined =>
    linesOf(thread, thread.originalStartLine, thread.originalLine),

  /**
   * Whether it starts open in the diff: unresolved threads do, and resolved ones start collapsed.
   */
  startsOpen: (thread: Thread): boolean => !thread.resolved,

  /**
   * Whether the person with login `login` started it or replied in it. Logins ignore case, as
   * GitHub's do.
   */
  involves: (thread: Thread, login: string): boolean => {
    const wanted = login.toLowerCase();
    return thread.comments.some((comment) => comment.author?.toLowerCase() === wanted);
  },

  /**
   * Whether it's in your pending review: its first comment isn't posted yet, so only you see it.
   */
  isPending: (thread: Thread): boolean => thread.comments[0]?.state === 'PENDING',
};

function linesOf(
  thread: Thread,
  start: number | undefined,
  end: number | undefined,
): Lines | undefined {
  if (thread.subject === 'FILE' || end === undefined) return undefined;
  const last = Line.of(thread.side, end);
  if (start === undefined) return Lines.one(last);
  return Lines.range(Line.of(thread.startSide ?? thread.side, start), last);
}

/** The threads of `list`, as {@link threadFromGithub} maps each. */
export function threadsFromGithub(list: ReviewThreadList): Thread[] {
  return list.nodes.map(threadFromGithub);
}

/**
 * The thread GitHub's `node` describes. Its first comment's commits say which revisions its lines
 * are on: `commit` for `line` and `startLine`, `originalCommit` for `originalLine` and
 * `originalStartLine`. A comment GitHub left out with an error is skipped.
 *
 * A value GitHub added after this build of Lo reads as the one that shows the thread most safely:
 * an unknown subject as the whole file, an unknown side as the head's, and an unknown comment state
 * as posted.
 */
export function threadFromGithub(node: ReviewThread): Thread {
  const comments = (node.comments.nodes ?? []).filter((comment) => comment !== null);
  const first = comments[0];
  return {
    id: node.id,
    path: node.path,
    subject: node.subjectType === 'LINE' ? 'LINE' : 'FILE',
    side: sideOf(node.diffSide),
    startSide: node.startDiffSide === null ? undefined : sideOf(node.startDiffSide),
    line: node.line ?? undefined,
    startLine: node.startLine ?? undefined,
    originalLine: node.originalLine ?? undefined,
    originalStartLine: node.originalStartLine ?? undefined,
    outdated: node.isOutdated,
    resolved: node.isResolved,
    currentOn: first?.commit?.oid,
    writtenOn: first?.originalCommit?.oid,
    comments: comments.map(commentFromGithub),
    viewerCanReply: node.viewerCanReply,
    viewerCanResolve: node.viewerCanResolve,
    viewerCanUnresolve: node.viewerCanUnresolve,
  };
}

/** The comment GitHub's `comment` describes. */
export function commentFromGithub(comment: ReviewThreadComment): ThreadComment {
  return {
    id: comment.id,
    author: comment.author?.login,
    body: comment.body,
    state: comment.state === 'PENDING' ? 'PENDING' : 'SUBMITTED',
    createdAt: comment.createdAt,
    url: comment.url,
    hidden: comment.isMinimized ? (comment.minimizedReason ?? '') : undefined,
    viewerCanUpdate: comment.viewerCanUpdate,
    viewerCanDelete: comment.viewerCanDelete,
  };
}

function sideOf(side: string): DiffSide {
  return side === 'LEFT' ? 'LEFT' : 'RIGHT';
}
