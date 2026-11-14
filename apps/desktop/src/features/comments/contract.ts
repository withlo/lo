// Comments on a pull request, as main reads them for the window: each view's review threads and
// your pending review, which main reads for the view on screen and sends each time they change;
// and the HTML GitHub renders for posts, which threads and the timeline show in place of their
// Markdown. The comments you write: the drafts main keeps of each comment box, which lines GitHub
// takes a comment on, and sending one, which only the reader does. The window asks for the posts on
// screen or near it, and keeps what comes back in its memory only. It loads the images in posts,
// and avatars, on the image scheme (`ipc/images.ts`), which the feature serves in main, so nothing
// of that goes through a request.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { comparisonKey } from '../diff/contract.ts';
import { oid, tabId } from '../tab/contract.ts';

/**
 * The most posts one ask names: what one read asks GitHub for (`RenderedBodies`' `nodes(ids:)`
 * takes 100).
 */
export const POSTS_AN_ASK = 100;

/**
 * A post's node ID, as GitHub gives it: a comment's, a review's or a review comment's. They're
 * written in base64's letters, with a prefix such as `IC_` or `PRR_`.
 */
export const postId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\w+/=-]+$/);

/** A post's HTML, as GitHub renders it, by its node ID. */
export interface RenderedPost {
  id: string;
  html: string;
}

/**
 * The HTML GitHub rendered for the posts asked about: the description's, when asked for and
 * GitHub gave it; each post's GitHub gave; and the posts GitHub gave none for, deleted since or
 * not ones the account can see.
 */
export interface Bodies {
  description: string | null;
  posts: RenderedPost[];
  gone: string[];
}

/** A node ID, as GitHub gives one. */
const nodeId = z.string().min(1).max(256);

/** A login, as GitHub gives one. */
const login = z.string().min(1).max(100);

/** A line of a file, from 1. */
const lineNumber = z
  .number()
  .int()
  .positive()
  .max(2 ** 31 - 1);

/** A side of a pull request's diff, by GraphQL's names: the base's (`LEFT`) or the head's. */
const diffSide = z.enum(['LEFT', 'RIGHT']);

/**
 * The most of a comment's text main sends: four times GitHub's own limit on a comment, so a body
 * GitHub takes is never cut.
 */
export const BODY_LIMIT = 262_144;

/**
 * A comment in a review thread, as `@lo/review`'s `ThreadComment` has it, with `null` for what
 * GitHub didn't give, and its author's kind of account (`__typename`), which says whether it has an
 * avatar of its own.
 */
export const threadComment = z.strictObject({
  id: nodeId,
  author: login.nullable(),
  authorType: z.string().max(64).nullable(),
  body: z.string().max(BODY_LIMIT),
  state: z.enum(['PENDING', 'SUBMITTED']),
  createdAt: z.string().max(64),
  url: z.string().max(2048),
  hidden: z.string().max(64).nullable(),
  viewerCanUpdate: z.boolean(),
  viewerCanDelete: z.boolean(),
});
export type ThreadCommentRow = z.output<typeof threadComment>;

/** A review thread, as `@lo/review`'s `Thread` has it, with `null` for what GitHub didn't give. */
export const reviewThread = z.strictObject({
  id: nodeId,
  path: z.string().min(1).max(4096),
  subject: z.enum(['LINE', 'FILE']),
  side: diffSide,
  startSide: diffSide.nullable(),
  line: lineNumber.nullable(),
  startLine: lineNumber.nullable(),
  originalLine: lineNumber.nullable(),
  originalStartLine: lineNumber.nullable(),
  outdated: z.boolean(),
  resolved: z.boolean(),
  currentOn: oid.nullable(),
  writtenOn: oid.nullable(),
  comments: z.array(threadComment),
  viewerCanReply: z.boolean(),
  viewerCanResolve: z.boolean(),
  viewerCanUnresolve: z.boolean(),
});
export type ThreadRow = z.output<typeof reviewThread>;

/**
 * The comparison of two revisions a view shows, as the revisions feature made it: by its key, as
 * the diff names it, from the older revision's head, and whether the older side is that revision
 * replayed onto the newer one's base, so its lines are no commit's.
 */
export const compared = z.strictObject({ key: comparisonKey, from: oid, replayed: z.boolean() });
export type Compared = z.output<typeof compared>;

/**
 * A view's review threads, sent each time they change:
 *
 * - `status`: `signIn` for a view that acts as nobody, which reads none; `run` for a run of a
 *   stack's layers, which has none; `loading` until they're read, which they are once the view
 *   has been on screen; `ready`; `failed` when they couldn't be read, with why in `problem`.
 * - `threads`, in GitHub's order, your pending review's among them.
 * - `missing`: how many threads and comments GitHub left out with an error.
 * - `compared`: the comparison of revisions the view shows, if it shows one.
 */
export const threadsView = z.strictObject({
  id: tabId,
  status: z.enum(['signIn', 'run', 'loading', 'ready', 'failed']),
  threads: z.array(reviewThread),
  missing: z.number().int().nonnegative(),
  compared: compared.nullable(),
  problem: z.string().max(4096).nullable(),
});
export type ThreadsView = z.output<typeof threadsView>;

/**
 * Your pending review on a view's pull request: `loading` until it's read, `none`, `unknown` when
 * GitHub left it out, so Lo can't tell, or `pending`, with the revision it's on (none once GitHub
 * no longer has it) and how many comments it holds.
 */
export const pendingReview = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('loading') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({
    kind: z.literal('pending'),
    id: nodeId,
    commit: oid.nullable(),
    comments: z.number().int().nonnegative(),
  }),
]);
export type PendingReviewRow = z.output<typeof pendingReview>;

/** Your pending review on a view's pull request, sent each time it changes. */
export const reviewView = z.strictObject({ id: tabId, review: pendingReview });
export type ReviewView = z.output<typeof reviewView>;

/**
 * A line of a pull request's diff as a comment names it: its side, by GraphQL's names, and number.
 */
export const commentLine = z.strictObject({ side: diffSide, number: lineNumber });

/** The lines a new thread is on: one, or a range from `start`, which may be on the other side. */
export const commentLines = z.strictObject({ start: commentLine.nullable(), end: commentLine });
export type CommentLinesRow = z.output<typeof commentLines>;

/** The longest path a comment may be on: none of the diff's is longer. */
const path = z.string().min(1).max(4096);

/**
 * Where a comment box is, which its draft is kept by: a new thread on lines of the revision whose
 * head is `commit`, the newer column's when it was written, or on the file when it has no lines.
 * Boxes of other kinds come with the features that open them.
 */
export const draftPlace = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('thread'),
    commit: oid,
    path,
    lines: commentLines.nullable(),
  }),
]);
export type DraftPlaceRow = z.output<typeof draftPlace>;

/**
 * Where sending a draft stands, when it's been sent: `waiting` for the answer to the last write to
 * its pull request, since one goes at a time; `sending`; `checking`, after GitHub's answer was
 * lost, whether it posted, by reading your comments once the write's read-back lands; `notPosted`,
 * when it found it didn't; `unknown`, when it couldn't read them.
 */
export const sending = z.enum(['waiting', 'sending', 'checking', 'notPosted', 'unknown']);
export type Sending = z.output<typeof sending>;

/**
 * A comment box's draft: where it is, its text, when it was last saved, whether it was saved before
 * Lo started, and how sending it stands, with the text sent when GitHub's answer was lost.
 */
export const draftRow = z.strictObject({
  place: draftPlace,
  text: z.string().max(BODY_LIMIT),
  savedAt: z.number().int().nonnegative(),
  restored: z.boolean(),
  sending: sending.nullable(),
  sent: z.string().max(BODY_LIMIT).nullable(),
});
export type DraftRow = z.output<typeof draftRow>;

/** The drafts of a view's account on its pull request, sent each time they change. */
export const draftsView = z.strictObject({ id: tabId, drafts: z.array(draftRow) });
export type DraftsView = z.output<typeof draftsView>;

/**
 * A hunk of a file's patch, as comments find their lines in it: its first row on each side, from 0,
 * and its lines' kinds in order, `' '` unchanged, `-` deleted and `+` added.
 */
export interface HunkRow {
  old: number;
  new: number;
  kinds: string;
}

/**
 * Which comments GitHub takes on a file at a revision: line comments on the lines of `hunks`, and
 * a comment on the file (`diff`, with no hunks for a file whose patch has none, such as a binary
 * one); none, for a file not in the pull request's diff there (`notInDiff`); or a comment on the
 * file only, when Lo has neither GitHub's patch nor the local copy's (`unknown`).
 */
export type Commentable =
  { kind: 'diff'; hunks: HunkRow[] } | { kind: 'notInDiff' } | { kind: 'unknown' };

/**
 * Why a comment wasn't sent, as the box says it, with what to do:
 *
 * - `notLatest`: a new line comment would join your pending review, whose threads GitHub puts on
 *   the latest head, `head`, while an older revision is on screen;
 * - `headMoved`: someone pushed since, and GitHub put it on the newer push, so Lo took it back;
 * - `notInDiff`: GitHub takes no comment on those lines;
 * - `paused`: GitHub asked Lo to hold off writing until `until`;
 * - `pendingUnknown`: Lo couldn't tell whether you have a pending review;
 * - `signIn`: the view acts as nobody; `run`: it shows a run of a stack's layers;
 * - `github`: anything else GitHub refused, or that went wrong, in a sentence.
 */
export type SendRefusal =
  | { kind: 'notLatest'; head: string }
  | { kind: 'headMoved'; head: string | null }
  | { kind: 'notInDiff' }
  | { kind: 'paused'; until: number }
  | { kind: 'pendingUnknown' }
  | { kind: 'signIn' }
  | { kind: 'run' }
  | { kind: 'github'; message: string };

/**
 * What came of sending a draft: `sent`, with whether it went into your pending review, whether it
 * did so though it was asked to post at once (`joined`), the thread it added when GitHub named it,
 * and, for a line thread GitHub put on a newer push that couldn't be taken back from it
 * (`landedOn`), that push's head when GitHub named it; `refused`, the draft kept; or `lost`, when
 * GitHub's answer was lost, and Lo checks whether it posted, as its draft says.
 */
export type SendOutcome =
  | {
      kind: 'sent';
      pending: boolean;
      joined: boolean;
      thread: string | null;
      landedOn: { head: string | null } | null;
    }
  | { kind: 'refused'; refusal: SendRefusal }
  | { kind: 'lost' };

export const contract = defineContract('comments', {
  requests: {
    /**
     * The HTML GitHub renders for the posts on view `id`'s pull request named by `posts`, and for
     * its description when `description` is set, read as the view's account at the front of its
     * queue. Main never keeps it: its images' addresses are signed afresh on every read. Fails as
     * `missing` for no such view, as `refused` for one that acts as nobody or shows a run of a
     * stack's layers, and as `failed`, with why, when GitHub couldn't be read.
     */
    bodies: {
      input: z.strictObject({
        id: tabId,
        posts: z.array(postId).max(POSTS_AN_ASK),
        description: z.boolean(),
      }),
      reply: reply<Bodies>(),
    },
    /**
     * What main has of a view's review threads, your pending review and your drafts now, which
     * `threads`, `review` and `drafts` then keep up to date: nothing for a view main doesn't
     * follow.
     */
    current: {
      input: z.strictObject({ id: tabId }),
      reply: reply<{
        threads: ThreadsView | undefined;
        review: ReviewView | undefined;
        drafts: DraftsView | undefined;
      }>(),
    },
    /**
     * Keeps `text` as the draft of the comment box at `place` on view `id`'s pull request, for its
     * account: blank text removes it. Fails as `missing` for no such view, and as `refused` for one
     * that acts as nobody.
     */
    draft: {
      input: z.strictObject({ id: tabId, place: draftPlace, text: z.string().max(BODY_LIMIT) }),
      reply: reply<void>(),
    },
    /** Removes the draft at `place` on view `id`'s pull request, as "Discard" does. */
    discard: { input: z.strictObject({ id: tabId, place: draftPlace }), reply: reply<void>() },
    /**
     * Which comments GitHub takes on the file at `path` (at `previous` in the base, when the pull
     * request renames it) at revision `commit`, as view `id` shows it: from GitHub's patch at the
     * latest head, or else the local copy's from where that revision branched off.
     */
    commentable: {
      input: z.strictObject({ id: tabId, commit: oid, path, previous: path.nullable() }),
      reply: reply<Commentable>(),
    },
    /**
     * Sends `text` as the comment at `place` on view `id`'s pull request, as its account: added to
     * your pending review (`review`), or posted at once (`now`). It's kept as the draft until
     * GitHub takes it. One write to a pull request goes at a time: this one waits for the last
     * one's answer. Never sent again by itself.
     */
    send: {
      input: z.strictObject({
        id: tabId,
        place: draftPlace,
        text: z.string().min(1).max(BODY_LIMIT),
        how: z.enum(['review', 'now']),
      }),
      reply: reply<SendOutcome>(),
    },
  },
  topics: {
    /** A view's review threads, each time they change. */
    threads: threadsView,
    /** Your pending review on a view's pull request, each time it changes. */
    review: reviewView,
    /** The drafts of a view's account on its pull request, each time they change. */
    drafts: draftsView,
  },
});
