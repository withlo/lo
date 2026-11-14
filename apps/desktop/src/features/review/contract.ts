// Submitting your review of a pull request: what the submit dialog shows, which main reads as the
// dialog opens; its summary, kept on this computer as comment boxes' drafts are; and submitting,
// which only the reader does, through the same one-at-a-time writes as comments. When GitHub's
// answer is lost, main reads your reviews to find out whether it was submitted, and says how that
// stands on `submitted`, as it says of every review submitted.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { BODY_LIMIT, type PendingReviewRow } from '../comments/contract.ts';
import { tabId } from '../tab/contract.ts';

/** What submitting a review does, by GraphQL's names: `@lo/review`'s `ReviewEvent`. */
export const reviewEvent = z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
export type ReviewEventRow = z.output<typeof reviewEvent>;

/**
 * Where submitting from a view stands, while it does: `sending`, while it waits its turn or for
 * GitHub's answer; `checking`, once GitHub's answer was lost, until a read of your reviews says
 * whether it was submitted; `notSubmitted`, when it found it wasn't; `unknown`, when it couldn't
 * tell.
 */
export const submitting = z.enum(['sending', 'checking', 'notSubmitted', 'unknown']);
export type Submitting = z.output<typeof submitting>;

/**
 * How submitting from a view stands, sent each time it changes, with the view's pull request's
 * number, and, once a review is submitted, what it was: its verdict, or `null` for a review found
 * among yours whose verdict Lo can't name.
 */
export const submission = z.strictObject({
  id: tabId,
  number: z
    .number()
    .int()
    .positive()
    .max(2 ** 31 - 1),
  state: submitting.nullable(),
  submitted: z.strictObject({ event: reviewEvent.nullable() }).nullable(),
});
export type Submission = z.output<typeof submission>;

/** Why a view acting as nobody can't submit, as the dialog and the status bar say it. */
export const SIGN_IN = 'Sign in to submit a review';

/** Why a run of a stack's layers can't take a review: each layer takes its own. */
export const IN_A_LAYER = 'Submit a review in a layer';

/** A comment of your pending review, as the dialog lists it. */
export interface PendingCommentRow {
  /** Its file's name, as the list shows it. */
  file: string;
  /** Where in the file: `new 41`, `old 30`, or `null` for a comment on the file. */
  line: string | null;
  /** Whether it replies to a thread. */
  reply: boolean;
  /** Its first line of text. */
  opening: string;
}

/**
 * What the submit dialog shows for a view:
 *
 * - who it's from (`login`), and the pull request, by its repository's owner and name and its
 *   number;
 * - `own`: the reader opened it, so GitHub takes comments only;
 * - `on`: the revision on screen, the newer column's head; `head`: GitHub's newest head;
 * - `pending`: your pending review, and `comments`, those of its comments main has read;
 * - `summary`: the summary kept from before, if any, and whether it was kept before Lo started;
 * - `submitting`: how submitting stands; `pausedUntil`: until when GitHub asked Lo to hold off
 *   writing, if it has.
 */
export interface DialogView {
  login: string;
  owner: string;
  repo: string;
  number: number;
  own: boolean;
  on: string;
  head: string;
  pending: PendingReviewRow;
  comments: PendingCommentRow[];
  summary: { text: string; savedAt: number; restored: boolean } | null;
  submitting: Submitting | null;
  pausedUntil: number | null;
}

/**
 * Why a review wasn't submitted:
 *
 * - `otherRevision`: your pending review is on another revision, `reviewOn` (`null` once GitHub no
 *   longer has it), so it can only go as a comment from the one on screen;
 * - `nothingToSubmit`: a comment or a request for changes with no summary and no pending comment;
 * - `pendingUnknown`: Lo couldn't tell whether you have a pending review;
 * - `ownPullRequest`: you opened it, and GitHub takes only comments from its author;
 * - `paused`: GitHub asked Lo to hold off writing until `until`;
 * - `busy`: one is being sent, Lo is checking whether one whose answer was lost was submitted, or
 *   couldn't tell (`unknown`), which only "Submit anyway" sends past;
 * - `signIn`: the view acts as nobody; `run`: it shows a run of a stack's layers;
 * - `github`: anything else GitHub refused, or that went wrong, in a sentence.
 */
export type SubmitRefusal =
  | { kind: 'otherRevision'; reviewOn: string | null }
  | { kind: 'nothingToSubmit' }
  | { kind: 'pendingUnknown' }
  | { kind: 'ownPullRequest' }
  | { kind: 'paused'; until: number }
  | { kind: 'busy'; why: 'sending' | 'checking' | 'unknown' }
  | { kind: 'signIn' }
  | { kind: 'run' }
  | { kind: 'github'; message: string };

/**
 * What came of submitting: `submitted`, with its verdict; `refused`, the summary kept; or `lost`,
 * when GitHub's answer was lost, and Lo checks whether it was submitted, as `submitted` says.
 */
export type SubmitOutcome =
  | { kind: 'submitted'; event: ReviewEventRow }
  | { kind: 'refused'; refusal: SubmitRefusal }
  | { kind: 'lost' };

export const contract = defineContract('review', {
  requests: {
    /**
     * What the submit dialog shows for view `id`, read as it opens. Fails as `missing` for no such
     * view, and as `refused`, saying why, for one that acts as nobody, shows a run of a stack's
     * layers, or whose pull request Lo hasn't read yet.
     */
    dialog: { input: z.strictObject({ id: tabId }), reply: reply<DialogView>() },
    /**
     * Keeps `text` as the summary on view `id`'s pull request, for its account: blank text removes
     * it. Fails as `missing` for no such view, and as `refused` for one that can't submit.
     */
    draft: {
      input: z.strictObject({ id: tabId, text: z.string().max(BODY_LIMIT) }),
      reply: reply<void>(),
    },
    /**
     * Submits your review of view `id`'s pull request, as its account: your pending review with
     * `event` and `body` as its summary, or a review with no comments. The summary is kept until
     * GitHub takes it. It goes once the last write to the pull request has its answer, and is never
     * sent again by itself: once GitHub's answer is lost, it's refused until Lo knows whether it
     * was submitted, and, when Lo can't tell, unless `anyway`.
     */
    submit: {
      input: z.strictObject({
        id: tabId,
        event: reviewEvent,
        body: z.string().max(BODY_LIMIT),
        anyway: z.boolean(),
      }),
      reply: reply<SubmitOutcome>(),
    },
  },
  topics: {
    /** How submitting from a view stands, and each review submitted, as it changes. */
    submitted: submission,
  },
});
