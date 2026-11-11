/**
 * What Lo writes to merge (`docs/design.md`, "Merging", "Stacks" and "The merge queue", and
 * "Turning chains into GitHub stacks"): GitHub's async merges, the merge queue, auto-merge, GitHub
 * stacks and pull requests' base branches, among them the steps of `@lo/stacks`' conversion and
 * merge plans. The poller runs each in the account's queue and reads back what it changes, and
 * `MergeJobs` follows an async merge until GitHub says how it ended.
 *
 * Every merge goes through `merge-async` with the head on screen as its `sha`, and every enqueue
 * and auto-merge with it as `expectedHeadOid`, so GitHub refuses one when someone pushed since
 * (`docs/design.md`, "Acting on what you saw"). GitHub merges a GitHub stack's open layers below the
 * one asked for in the same request, checking only that one's head, so a merge of a stack's layer
 * names every layer below with its head as seen, and Lo reads the stack before every merge: it
 * refuses one that would merge a layer it doesn't name ({@link withLayersBelow}).
 *
 * GitHub's refusals, and Lo's, come back as values ({@link MergeRefusal}), whose sentences
 * ({@link describeMergeRefusal}) the UI can show as they are. Anything else that goes wrong throws a
 * {@link GithubError}.
 *
 * Lo never sends a write again by itself. One that failed may still have been done, when its answer
 * was lost or GitHub's server failed ({@link GithubError.mayHavePosted}). A stack made or added to
 * whose answer was lost is looked for with a read.
 */

import type { GithubClient } from './client.ts';
import { GithubError, type GithubErrorDetail } from './errors.ts';
import { nextLink } from './files.ts';
import {
  DequeuePullRequestDocument,
  DisablePullRequestAutoMergeDocument,
  EnablePullRequestAutoMergeDocument,
  EnqueuePullRequestDocument,
  QueueViewDocument,
  type DequeuePullRequestMutation,
  type PullRequestMergeMethod,
  type TypedDocumentString,
} from './generated/graphql.ts';
import { isBelow } from './graphql.ts';
import { Fields } from './json.ts';
import { readPullSummary, type PullSummary } from './pulls.ts';
import { PullRef, type RepoRef } from './refs.ts';
import { validationMessage } from './review-writes.ts';

/** The write that would take a GitHub stack's layers below the pull request with it. */
export type Via =
  /** A merge straight in: the layers below would merge with it. */
  | 'merge'
  /** Into the merge queue, as an async merge or an enqueue: they would join the queue with it. */
  | 'queue'
  /** Auto-merge: they would merge with it when it merges. */
  | 'autoMerge'
  /** A merge past the rules, which GitHub allows only for a stack's bottom layer. */
  | 'adminOverride';

/**
 * Why GitHub, or Lo before asking it, refused a merge write. Nothing was done. GitHub's words decide
 * which it is, matched by the fixed start of each message GitHub sends, so text GitHub quotes, such
 * as a pull request's title, never does; those not listed are kept as they are (`other`).
 */
export type MergeRefusal =
  /**
   * The pull request's head isn't the commit Lo sent: someone pushed after Lo showed it. An async
   * merge's answer is a `400`, "Pull request head branch was modified."; an enqueue's, "Failed to
   * add PR #36: expected head oid does not match the current head oid".
   */
  | { refusal: 'headMoved' }
  /**
   * A lower layer of the GitHub stack being merged, `pr`, has another head, `now`, than the one Lo
   * showed, so Lo didn't send the merge: GitHub merges the layers below with the one asked for,
   * checking only that one's head.
   */
  | { refusal: 'layerMoved'; pr: number; now: string }
  /**
   * The GitHub stack being merged isn't the one Lo showed: a layer below was merged, closed, added
   * or taken out, or the pull request isn't in it any more. Lo didn't send the merge.
   */
  | { refusal: 'stackChanged' }
  /**
   * The pull request is a layer of a GitHub stack, and `below`, its open layers below it, bottom to
   * top, would go with it `via` the write, but the write didn't name them, so its confirmation
   * couldn't have listed them, or it can't name them at all: an enqueue or turning auto-merge on. Lo
   * didn't send it.
   */
  | { refusal: 'unnamedLayers'; below: number[]; via: Via }
  /**
   * The pull request is a layer of a GitHub stack whose other open layers are `others`, bottom to
   * top, so Lo didn't move it to the front of the merge queue: GitHub queues a stack's layers in
   * order and takes the layers above out with one taken out, and adding it back can't name them.
   */
  | { refusal: 'stacked'; others: number[] }
  /**
   * The pull request is a layer of a GitHub stack, and `above`, its layers above it in the merge
   * queue, bottom to top, would leave the queue with it, but the dequeue didn't name them. Lo didn't
   * send it.
   */
  | { refusal: 'unnamedAbove'; above: number[] }
  /**
   * Lo couldn't read whether the pull request is in a GitHub stack, or which of its layers are in
   * the merge queue, so it didn't change the queue. `read` is why, such as GitHub out of reach, a
   * rate limit or single sign-on.
   */
  | { refusal: 'queueUnchecked'; read: GithubErrorDetail }
  /**
   * GitHub won't merge the stack until it's rebased: a layer isn't based on the head of the one
   * below, as after a push to a lower layer. An async merge `failed`, "Stack needs to be rebased:
   * PR #57's branch is not a linear descendant of PR #56's branch."
   */
  | { refusal: 'stackNeedsRebase'; message: string }
  /**
   * Lo couldn't read whether the pull request is in a GitHub stack, or its layers' heads, so it
   * didn't send the merge. `read` is why.
   */
  | { refusal: 'unchecked'; read: GithubErrorDetail }
  /**
   * A head Lo was asked to expect, `sha`, isn't a full commit SHA, such as one not read yet. Lo
   * didn't send it: GitHub reads a missing head as whatever the head is then.
   */
  | { refusal: 'notACommit'; sha: string }
  /**
   * The base branch's rules aren't met, each as GitHub words it. An async merge is refused this way
   * only when it runs, as a `failed` status: "Repository rule violations found", then the rules, on
   * lines of their own or after a colon.
   */
  | { refusal: 'rules'; rules: string[] }
  /** It's a draft: an async merge's `400`, "Pull request is in draft." */
  | { refusal: 'draft' }
  /** It's closed: an async merge's `400`, "Pull request is closed." */
  | { refusal: 'closed' }
  /** It's merged already. */
  | { refusal: 'merged' }
  /** It conflicts with its base branch: an async merge `failed`, "Pull Request has merge conflicts". */
  | { refusal: 'conflict' }
  /**
   * GitHub won't turn on auto-merge because nothing blocks the merge now ("clean status" or
   * "unstable status"): read the pull request again, and merge it.
   */
  | { refusal: 'canMergeNow' }
  /**
   * The repository doesn't allow auto-merge, a setting on GitHub: "Auto merge is not allowed for
   * this repository". GitHub says so on a branch with a merge queue too, for "Merge when ready".
   */
  | { refusal: 'autoMergeNotAllowed' }
  /**
   * The base branch has no merge queue: "No merge queue found for branch …" to an enqueue or a
   * dequeue, and an async merge into a queue `failed`, "Cannot perform a merge queue merge for a
   * branch with no merge queue".
   */
  | { refusal: 'noMergeQueue' }
  /** The account may not do it here, such as merging past the branch's rules or jumping the queue, in GitHub's words. */
  | { refusal: 'noPermission'; message: string }
  /** A pull request is in a GitHub stack already, and can be in only one: "Pull requests #45, #46 are already part of a stack". */
  | { refusal: 'alreadyStacked'; message: string }
  /**
   * The pull requests don't form a chain: each one's base branch must be the head branch of the one
   * below it, for a stack made or added to.
   */
  | { refusal: 'notAChain' }
  /** GitHub is changing the stack for another request: the Stacks API's `409`. It can be sent again once that's finished. */
  | { refusal: 'stackBusy' }
  /** The base branch isn't the one the plan expected, but `now`: it was changed elsewhere since Lo read it. Lo leaves it as it is. */
  | { refusal: 'baseChanged'; now: string }
  /**
   * GitHub asked Lo to hold off writing, by a rate limit or by turning a write away as sent too
   * fast, so Lo didn't send it. It can be asked for again from `until`, a wall-clock time in
   * milliseconds since the Unix epoch.
   */
  | { refusal: 'paused'; until: number }
  /** Any other refusal, in GitHub's words, such as a dequeue of a pull request that isn't queued, or a `409` Lo can't read. */
  | { refusal: 'other'; message: string };

/** Whether `value` is a refusal rather than what a write answered. */
export function isRefusal(value: unknown): value is { refusal: string } {
  return typeof value === 'object' && value !== null && 'refusal' in value;
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop();
  if (last === undefined) return '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/** The refusal as a sentence for the person who asked, as in "Couldn't merge: …". */
export function describeMergeRefusal(refusal: MergeRefusal): string {
  switch (refusal.refusal) {
    case 'headMoved':
      return 'Someone pushed to the pull request since Lo showed it';
    case 'layerMoved':
      return `Someone pushed to #${refusal.pr}, a layer below, since Lo showed it`;
    case 'stackChanged':
      return 'The stack changed since Lo showed it';
    case 'unnamedLayers': {
      const below = numbers(refusal.below);
      switch (refusal.via) {
        case 'merge':
          return `${below}, below it in its GitHub stack, would merge with it, so Lo didn't merge`;
        case 'queue':
          return `${below}, below it in its GitHub stack, would join the merge queue with it, so Lo didn't add it`;
        case 'autoMerge':
          return `${below}, below it in its GitHub stack, would merge with it when auto-merge merges it, so Lo didn't turn auto-merge on`;
        case 'adminOverride':
          return `GitHub merges past the rules only a stack's bottom layer, and ${below} is below it, so Lo didn't merge`;
        default:
          throw new Error(
            `a way to merge Lo doesn't know: ${JSON.stringify(refusal.via satisfies never)}`,
          );
      }
    }
    case 'stacked':
      return `${numbers(refusal.others)} ${refusal.others.length === 1 ? 'is' : 'are'} in its GitHub stack, which GitHub queues in order, so Lo didn't move it to the front`;
    case 'unnamedAbove':
      return `${numbers(refusal.above)}, above it in its GitHub stack, would leave the merge queue with it, so Lo didn't take it out`;
    case 'queueUnchecked':
      return `Lo couldn't read the pull request's GitHub stack, so it didn't change the queue: ${new GithubError(refusal.read).message}`;
    case 'stackNeedsRebase':
      return "The stack needs a rebase: a layer isn't based on the head of the one below";
    case 'unchecked':
      return `Lo couldn't read the pull request's stack, so it didn't merge: ${new GithubError(refusal.read).message}`;
    case 'notACommit':
      return `${JSON.stringify(refusal.sha)} isn't a full commit SHA, so Lo didn't send it`;
    case 'rules':
      return `GitHub's rules for the branch aren't met: ${refusal.rules.join(' ')}`;
    case 'draft':
      return "GitHub doesn't merge a draft";
    case 'closed':
      return 'The pull request is closed';
    case 'merged':
      return 'The pull request is merged already';
    case 'conflict':
      return 'The pull request conflicts with its base branch';
    case 'canMergeNow':
      return 'GitHub turns on auto-merge only while something blocks the merge, and nothing does';
    case 'autoMergeNotAllowed':
      return "This repository doesn't allow auto-merge";
    case 'noMergeQueue':
      return 'The base branch has no merge queue';
    case 'noPermission':
      return `GitHub doesn't let this account do that: ${refusal.message}`;
    case 'alreadyStacked':
      return `A pull request is in a GitHub stack already: ${refusal.message}`;
    case 'notAChain':
      return "The pull requests don't form a chain, each based on the head of the one below";
    case 'stackBusy':
      return 'GitHub is changing this stack for another request';
    case 'baseChanged':
      return `The pull request's base branch is now ${refusal.now}, changed since Lo read it`;
    case 'paused':
      return "GitHub asked Lo to hold off writing for a while, so Lo didn't send it";
    case 'other':
      return `GitHub refused it: ${refusal.message}`;
    default:
      throw new Error(
        `a refusal of a merge Lo doesn't know: ${JSON.stringify(refusal satisfies never)}`,
      );
  }
}

/** "Repository rule violations found", then each rule on a line of its own, or after a colon on the same line. */
function rulesIn(message: string): MergeRefusal {
  const after = message.slice('repository rule violations found'.length).replace(/^:+/, '');
  const rules = after
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return { refusal: 'rules', rules };
}

/**
 * The fixed starts of GitHub's messages, ignoring case, and what each means. A message is sorted by
 * its start alone, so anything GitHub quotes later in it, such as a title, decides nothing.
 */
const MESSAGES: readonly [string, (message: string) => MergeRefusal][] = [
  ['pull request head branch was modified', () => ({ refusal: 'headMoved' })],
  ['expected head oid does not match', () => ({ refusal: 'headMoved' })],
  ['repository rule violations found', rulesIn],
  ['pull request pull request is in clean status', () => ({ refusal: 'canMergeNow' })],
  ['pull request pull request is in unstable status', () => ({ refusal: 'canMergeNow' })],
  ['pull request is in clean status', () => ({ refusal: 'canMergeNow' })],
  ['pull request is in unstable status', () => ({ refusal: 'canMergeNow' })],
  ['auto merge is not allowed for this repository', () => ({ refusal: 'autoMergeNotAllowed' })],
  ['no merge queue found for branch', () => ({ refusal: 'noMergeQueue' })],
  [
    'cannot perform a merge queue merge for a branch with no merge queue',
    () => ({ refusal: 'noMergeQueue' }),
  ],
  ['pull request is in draft', () => ({ refusal: 'draft' })],
  ['pull request is a draft', () => ({ refusal: 'draft' })],
  ['pull request is closed', () => ({ refusal: 'closed' })],
  ['pull request is already merged', () => ({ refusal: 'merged' })],
  ['pull request has merge conflicts', () => ({ refusal: 'conflict' })],
  // GitHub's documented `failed` answer to an async merge.
  ['merge conflict', () => ({ refusal: 'conflict' })],
  ['stack is currently being modified', () => ({ refusal: 'stackBusy' })],
  ['pull requests must form a stack', () => ({ refusal: 'notAChain' })],
  ['stack needs to be rebased', (message) => ({ refusal: 'stackNeedsRebase', message })],
];

/**
 * Sorts GitHub's message, from a refusal or a failed async merge, by its fixed start. A queue's
 * refusal names the pull request first ("Failed to add PR #36: …"), and only what follows the colon
 * is GitHub's reason; one that quotes a title instead ("Failed to remove PR #36 "…"") has no reason
 * Lo can read. "Pull request #45 is already part of a stack" and "Pull requests #45, #46 are …" are
 * known by their fixed end, after the numbers.
 */
export function mergeRefusalFrom(message: string): MergeRefusal {
  const trimmed = message.trim();
  const reason = queueReason(trimmed) ?? trimmed;
  const lower = reason.toLowerCase();
  const known = MESSAGES.find(([start]) => lower.startsWith(start));
  if (known) return known[1](reason);
  if (numbered(lower, 'already part of a stack')) {
    return { refusal: 'alreadyStacked', message: trimmed };
  }
  return { refusal: 'other', message: trimmed };
}

/** The most telling of several messages: the first Lo can say more about than GitHub's words, or else all of them. */
function fromMessages(messages: readonly string[]): MergeRefusal {
  const words = messages.map((message) => message.trim()).filter((message) => message !== '');
  return (
    words.map(mergeRefusalFrom).find((refusal) => refusal.refusal !== 'other') ?? {
      refusal: 'other',
      message: words.join('; '),
    }
  );
}

/**
 * The reason in a merge queue's refusal, "Failed to add PR #<number>: <reason>" or "Failed to remove
 * PR #<number>: <reason>": what follows the number and its colon. Nothing for any other message,
 * including one that quotes the pull request's title after its number.
 */
function queueReason(message: string): string | undefined {
  const match = /^failed to (?:add|remove) pr #\d+:/i.exec(message);
  return match ? message.slice(match[0].length).trimStart() : undefined;
}

/**
 * Whether `lower` is "pull request #<n> is <end>" or "pull requests #<n>, #<n> are <end>", with
 * nothing but numbers between.
 */
function numbered(lower: string, end: string): boolean {
  const rest = lower.startsWith('pull requests ')
    ? lower.slice('pull requests '.length)
    : lower.startsWith('pull request ')
      ? lower.slice('pull request '.length)
      : undefined;
  if (rest === undefined || !rest.endsWith(end)) return false;
  const middle = rest.slice(0, rest.length - end.length).trimEnd();
  const listed = middle.endsWith(' are')
    ? middle.slice(0, -' are'.length)
    : middle.endsWith(' is')
      ? middle.slice(0, -' is'.length)
      : undefined;
  return listed !== undefined && listed.split(',').every((number) => /^#\d+$/.test(number.trim()));
}

/**
 * GitHub's refusal of a merge write in `detail`, as a value: GraphQL errors of type `UNPROCESSABLE`
 * (or `FORBIDDEN`, for permission), and REST's `400`, `403`, `405`, `409` and `422`, explained by
 * their messages. Nothing for any other error, such as "not found", a rate limit or a server error.
 */
export function mergeRefusal(detail: GithubErrorDetail): MergeRefusal | undefined {
  if (detail.kind === 'graphql') {
    const of = (type: string) =>
      detail.errors.filter((error) => error.type === type).map((error) => error.message);
    const [unprocessable, forbidden] = [of('UNPROCESSABLE'), of('FORBIDDEN')];
    if (unprocessable.length > 0) return fromMessages(unprocessable);
    if (forbidden.length > 0) return { refusal: 'noPermission', message: forbidden.join('; ') };
    return undefined;
  }
  if (detail.kind === 'api' && [400, 403, 405, 409, 422].includes(detail.status)) {
    // GitHub's `errors` say what failed its validation; its message only that something did
    // ("Validation Failed").
    let messages = detail.errors.map(mergeValidationMessage);
    if (messages.every((message) => message.trim() === '')) messages = [detail.message];
    const refusal = fromMessages(messages);
    return refusal.refusal === 'other' && detail.status === 403
      ? { refusal: 'noPermission', message: refusal.message }
      : refusal;
  }
  return undefined;
}

/**
 * One of a REST error's `errors`, as {@link validationMessage} reads it, with the value a `field`
 * and `code` name, such as the Stacks API's `missing` for a pull request that doesn't exist.
 */
function mergeValidationMessage(error: unknown): string {
  const message = validationMessage(error);
  if (typeof error !== 'object' || error === null || 'message' in error) return message;
  const value: unknown = Reflect.get(error, 'value');
  return message !== '' && value !== undefined ? `${message} ${JSON.stringify(value)}` : message;
}

/** `error`'s refusal, if it's GitHub refusing a merge write; else `error` thrown again. */
function refusedOrThrow(error: unknown): MergeRefusal {
  if (error instanceof GithubError) {
    const refusal = mergeRefusal(error.detail);
    if (refusal) return refusal;
  }
  throw error;
}

/** Whether `sha` is a full commit SHA: 40 hex digits, or 64 in a SHA-256 repository. */
export function isFullSha(sha: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha);
}

type NotACommit = Extract<MergeRefusal, { refusal: 'notACommit' }>;

/** Refuses a head that isn't a full commit SHA: GitHub reads a missing head as whatever the head is then. */
function expectCommit(sha: string): NotACommit | undefined {
  return isFullSha(sha) ? undefined : { refusal: 'notACommit', sha };
}

/**
 * What an async merge asks for: `PUT /repos/{owner}/{repo}/pulls/{number}/merge-async`. Its heads
 * are full commit SHAs, checked when it's made, and it always names its way in: Lo never sends
 * GitHub's `default`, so GitHub never takes the other way without saying so. Make one with
 * {@link directMerge}, {@link queueMerge} or {@link adminOverride}.
 */
export interface MergeRequest {
  /** The head on screen it expects. */
  readonly sha: string;
  /** The method, for a direct merge. A queue's settings choose its own. */
  readonly method: PullRequestMergeMethod | undefined;
  /** REST's `merge_action`: straight into the base branch, or into its merge queue. */
  readonly action: 'direct_merge' | 'merge_queue';
  /** The merge commit's title and message, such as an edited squash commit's, for a direct merge. */
  readonly commitTitle: string | undefined;
  readonly commitMessage: string | undefined;
  /** Whether it merges past the branch's rules, for those allowed to. */
  readonly bypassRules: boolean;
  /** For a GitHub stack's merge, the open layers below and their heads as shown, bottom to top. */
  readonly layersBelow: readonly { readonly pr: number; readonly head: string }[];
}

/**
 * Merges `sha`, the head on screen, straight into the base branch with `method`. GitHub merges only
 * while it's the pull request's head, and cancels the merge if someone pushes before it runs. In a
 * GitHub stack with open layers below the pull request, GitHub merges them too, so the request must
 * name them ({@link withLayersBelow}), or Lo refuses it.
 */
export function directMerge(
  sha: string,
  method: PullRequestMergeMethod,
): MergeRequest | NotACommit {
  return (
    expectCommit(sha) ?? {
      sha,
      method,
      action: 'direct_merge',
      commitTitle: undefined,
      commitMessage: undefined,
      bypassRules: false,
      layersBelow: [],
    }
  );
}

/** Adds `sha`, the head on screen, to the base branch's merge queue, whose settings choose the method and message. */
export function queueMerge(sha: string): MergeRequest | NotACommit {
  const request = directMerge(sha, 'MERGE');
  return isRefusal(request) ? request : { ...request, method: undefined, action: 'merge_queue' };
}

/**
 * Merges `sha` straight in with `method`, past the branch's rules, for those allowed to
 * (`docs/design.md`, "Admin override"). In a GitHub stack, only the bottom layer can merge this way,
 * so it can't name layers below.
 */
export function adminOverride(
  sha: string,
  method: PullRequestMergeMethod,
): MergeRequest | NotACommit {
  const request = directMerge(sha, method);
  return isRefusal(request) ? request : { ...request, bypassRules: true };
}

/** `request` with the merge commit's title and message. A queue uses its own, so they're never sent with a queue's. */
export function withCommit(
  request: MergeRequest,
  title: string | undefined,
  message: string | undefined,
): MergeRequest {
  return { ...request, commitTitle: title, commitMessage: message };
}

/**
 * Makes `request` a GitHub stack's merge: `layers` are the open layers below the pull request, bottom
 * to top, each with its head as Lo showed it, as its confirmation listed them. GitHub merges them
 * too, checking only the top's head, so before sending, Lo reads the stack in the same turn and
 * refuses when a layer moved or the stack's open layers aren't these. An admin override can't have
 * any: GitHub merges past the rules only a stack's bottom layer.
 */
export function withLayersBelow(
  request: MergeRequest,
  layers: readonly { pr: number; head: string }[],
): MergeRequest | NotACommit | { refusal: 'adminOverrideLayers' } {
  if (request.bypassRules && layers.length > 0) return { refusal: 'adminOverrideLayers' };
  for (const { head } of layers) {
    const refused = expectCommit(head);
    if (refused) return refused;
  }
  return { ...request, layersBelow: layers.map(({ pr, head }) => ({ pr, head })) };
}

/** Whether `request` merges a GitHub stack's layers below the pull request too. */
export function isStackMerge(request: MergeRequest): boolean {
  return request.layersBelow.length > 0;
}

/** The way `request` would take a stack's layers below with it. */
function via(request: MergeRequest): Via {
  if (request.bypassRules) return 'adminOverride';
  return request.action === 'merge_queue' ? 'queue' : 'merge';
}

/** The JSON `merge-async` takes, in GitHub's documented order, which the recorded requests were written in. */
export function mergeAsyncBody(request: MergeRequest): string {
  const direct = request.action === 'direct_merge';
  const body: Record<string, unknown> = { sha: request.sha };
  if (direct && request.method !== undefined) body['merge_method'] = request.method.toLowerCase();
  body['merge_action'] = request.action;
  if (direct && request.commitTitle !== undefined) body['commit_title'] = request.commitTitle;
  if (direct && request.commitMessage !== undefined) body['commit_message'] = request.commitMessage;
  if (request.bypassRules) body['bypass_rules'] = true;
  return JSON.stringify(body);
}

/**
 * An async merge's `status`: `pending` while GitHub runs it; `merged`; `enqueued`, in the merge
 * queue, which is final for the request; or `failed`, for the reason the details give. Branch rules
 * are checked only as it runs, so a refusal can come this way, late. Any other is one GitHub added
 * since Lo was written, and is never read as merged.
 */
export type AsyncMergeStatus = 'pending' | 'merged' | 'enqueued' | 'failed' | { unknown: string };

/** Where an async merge stands: REST's `pull-request-merge-async-result`. */
export interface AsyncMerge {
  status: AsyncMergeStatus;
  details: AsyncMergeDetails;
}

/** An async merge's `details`. Which fields GitHub fills depends on the status. */
export interface AsyncMergeDetails {
  /** GitHub's words, such as "Merge request enqueued." or why it failed. */
  message: string;
  /** The request's UUID, while it's pending. */
  uuid?: string | undefined;
  /** The commit a merged request made. */
  sha?: string | undefined;
  /**
   * What a pending request asked for: `merge_method` (`default`, `merge`, `squash` or `rebase`),
   * `merge_action` and the head it expects. Answers once it's ended don't say.
   */
  merge_method?: string | undefined;
  merge_action?: string | undefined;
  expected_head_sha?: string | undefined;
  bypass_rules?: boolean | undefined;
}

/** The status's name as GitHub gave it. */
export function statusName(status: AsyncMergeStatus): string {
  return typeof status === 'string' ? status : status.unknown;
}

/** GitHub's answer about an async merge, read. */
export function readAsyncMerge(json: unknown): AsyncMerge {
  const answer = new Fields(json, 'merge');
  const status = answer.text('status');
  const known = ['pending', 'merged', 'enqueued', 'failed'] as const;
  const details = answer.maybeFields('details');
  const flag = details?.maybeFlag('bypass_rules');
  return {
    status: known.find((name) => name === status) ?? { unknown: status },
    details: {
      message: details?.maybeText('message') ?? '',
      uuid: details?.maybeText('uuid'),
      sha: details?.maybeText('sha'),
      merge_method: details?.maybeText('merge_method'),
      merge_action: details?.maybeText('merge_action'),
      expected_head_sha: details?.maybeText('expected_head_sha'),
      bypass_rules: flag,
    },
  };
}

/** GitHub's answer to an async merge. */
export type Submitted =
  /** `202`: GitHub took it and runs it in the background. Ask about `uuid` until it's done. */
  | { kind: 'accepted'; uuid: string; answer: AsyncMerge }
  /**
   * `409`: a merge GitHub took earlier is still running for this pull request, from Lo or from
   * elsewhere, and nothing new was started. Its `uuid` says how it goes; `answer.details` name the
   * head, method and way it asked for, which may not be this request's.
   */
  | { kind: 'alreadyRunning'; uuid: string; answer: AsyncMerge }
  /**
   * `200`: nothing to do. It's merged already (`merged`, with the commit), or in the merge queue
   * already (`enqueued`). Or, with any other status, an answer Lo doesn't know, which keeps its UUID
   * if it gave one.
   */
  | { kind: 'done'; answer: AsyncMerge };

/** An entry in a merge queue, as GitHub answers adding a pull request to the queue or taking it out. */
export interface QueueEntry {
  id: string;
  number: number | undefined;
  /** 1 is the front. */
  position: number;
  /** GitHub's `MergeQueueEntryState`: `QUEUED`, `AWAITING_CHECKS`, `MERGEABLE`, `UNMERGEABLE` or `LOCKED`. */
  state: string;
  /** Whether it jumped the queue. */
  jump: boolean;
  /** Whether it's tested on its own. */
  solo: boolean;
  /** The head it was added at. */
  head: string | undefined;
  /** How long GitHub expects until it merges, in seconds. */
  estimatedTimeToMerge: number | undefined;
}

/** How a move to the front of the merge queue ended once Lo took the entry out ({@link jump}). */
export type Jumped =
  /** Added again at the front, or as near it as GitHub puts it, behind entries it's testing. */
  | { kind: 'moved'; entry: QueueEntry }
  /**
   * Taken out, but adding it again failed: GitHub refused, so it's out of the queue, or the answer
   * was lost, so it may be ({@link GithubError.mayHavePosted}).
   */
  | { kind: 'notBack'; failure: MergeRefusal | GithubErrorDetail };

/** What taking a pull request out of the merge queue answered: the entry it had, if GitHub named it. */
export interface Dequeued {
  entry: QueueEntry | undefined;
}

/** What turning auto-merge on asks for: `enablePullRequestAutoMerge`. */
export interface AutoMergeRequest {
  /** The head on screen, a full commit SHA. GitHub refuses when it's no longer the head. */
  expectedHead: string;
  /** The method. On a branch with a merge queue, the queue's is used instead. */
  method: PullRequestMergeMethod;
  /** The commit's title and message; GitHub's are used without them, and always on a branch with a merge queue. */
  commitHeadline?: string | undefined;
  commitBody?: string | undefined;
}

/** Auto-merge as GitHub has it after turning it on or off. */
export interface AutoMergeState {
  number: number;
  /** The pull request's head. */
  head: string;
  /** Auto-merge, when it's on: its method, nothing for one Lo doesn't know, and who turned it on, when GitHub says. */
  autoMerge:
    { method: PullRequestMergeMethod | undefined; enabledBy: string | undefined } | undefined;
  /** Whether the pull request is in the merge queue: "Merge when ready" on a pull request that's ready adds it at once. */
  inQueue: boolean;
}

/** A pull request in a GitHub stack, as the Stacks API answers. */
export interface StackedPull {
  number: number;
  /** `open` or `closed`. */
  state: string;
  draft: boolean;
  merged_at: string | undefined;
  head: { ref: string; sha: string };
}

/** A GitHub stack, as the Stacks API answers. */
export interface GithubStack {
  /** Stack numbers share the repository's sequence of issue and pull request numbers. */
  number: number;
  node_id: string;
  /** The branch it merges into. */
  base: { ref: string };
  /** False once every pull request in it is merged or closed. */
  open: boolean;
  /** Bottom to top. */
  pull_requests: StackedPull[];
}

/** A stack's pull requests' numbers, bottom to top. */
export function stackNumbers(stack: GithubStack): number[] {
  return stack.pull_requests.map((pull) => pull.number);
}

/** A stack's pull requests that are open, bottom to top: neither merged nor closed. */
export function openLayers(stack: GithubStack): StackedPull[] {
  return stack.pull_requests.filter(
    (pull) => pull.state === 'open' && pull.merged_at === undefined,
  );
}

/** A repository's open GitHub stacks, as {@link stacks} lists them. */
export interface StackList {
  stacks: GithubStack[];
  /**
   * Whether Lo stopped reading after 1,000 stacks, open or closed, with more to come: GitHub lists
   * the newest first, so an older open stack may be missing.
   */
  cutShort: boolean;
}

/** Whether a pull request is merged, as REST's `GET /pulls/{number}` says. */
export interface MergedState {
  merged: boolean;
  merged_at: string | undefined;
  /** The commit it merged as, once it's merged. GitHub fills it for an open pull request too, with its test merge, so it's read only when merged. */
  merge_commit_sha: string | undefined;
}

export function isMerged(state: MergedState): boolean {
  return state.merged || state.merged_at !== undefined;
}

/** A change to a pull request's base branch: `PATCH /repos/{owner}/{repo}/pulls/{pr}` with `{"base": to}`. */
export interface Retarget {
  readonly pr: number;
  /** Its base branch now. */
  readonly from: string;
  /** The base branch it gets. */
  readonly to: string;
}

/** One step of "Make this a GitHub stack", as `@lo/stacks` plans it. */
export type ConversionStep =
  /**
   * Change a pull request's base branch to the head branch of the layer below it, or to the root
   * branch for the bottom layer, as each layer of a GitHub stack must have.
   */
  | { readonly kind: 'retarget'; readonly retarget: Retarget }
  /** Create a GitHub stack from these pull requests, bottom to top: `POST /repos/{owner}/{repo}/stacks`. */
  | { readonly kind: 'createStack'; readonly prs: readonly number[] }
  /** Add these pull requests, bottom to top, to the top of GitHub stack `stack`: `POST /repos/{owner}/{repo}/stacks/{stack}/add`. */
  | { readonly kind: 'addToStack'; readonly stack: number; readonly prs: readonly number[] };

/** What a step of "Make this a GitHub stack" did. */
export type StepDone =
  /** A pull request's base branch changed. */
  | { kind: 'retargeted'; pull: PullSummary }
  /** A pull request's base branch was already the one the step wanted: nothing was sent, so rolling back leaves it. */
  | { kind: 'alreadyThere'; pull: PullSummary }
  /** The stack was created, or pull requests were added to it. Rolling back by unstacking needs its number. */
  | { kind: 'stacked'; stack: GithubStack };

/** The most pages of a repository's stacks Lo reads, 100 a page. */
const MAX_STACK_PAGES = 10;

function repoPath(repo: RepoRef): string {
  return `/repos/${repo.owner}/${repo.name}`;
}

/**
 * Asks GitHub to merge `pull` as `request` says, in the background
 * (`PUT /repos/{owner}/{repo}/pulls/{number}/merge-async`). Follow the answer's UUID with
 * {@link mergeAsyncResult}, as `MergeJobs` does.
 *
 * It reads the GitHub stack holding `pull` first, and refuses, sending nothing, when the open layers
 * below aren't the ones `request` names, at the heads it names: GitHub would merge them too.
 * GitHub's state checks refuse at once with a `400`; its branch rules only when the merge runs, so
 * those come back as a `failed` status. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function mergeAsync(
  client: GithubClient,
  pull: PullRef,
  request: MergeRequest,
): Promise<Submitted | MergeRefusal> {
  const checked = await checkLayers(client, pull, request.layersBelow, request.sha, via(request));
  if (checked) return checked;
  let response;
  try {
    response = await client.send('PUT', `${pull.restPath()}/merge-async`, {
      body: mergeAsyncBody(request),
      answers: [400, 409],
    });
  } catch (error) {
    return refusedOrThrow(error);
  }
  const { status } = response;
  let answer: AsyncMerge;
  try {
    answer = response.json(readAsyncMerge);
  } catch {
    // A 400 or 409 that isn't an async merge's answer is an ordinary error.
    if (status === 400 || status === 409) {
      return refusedOrThrow(GithubError.fromResponse(status, response.headers, response.text()));
    }
    throw new GithubError({
      kind: 'decode',
      message: `GitHub's answer to the merge, a ${status}, isn't an async merge's`,
    });
  }
  const { uuid } = answer.details;
  const pending = answer.status === 'pending';
  if (status === 400) return mergeRefusalFrom(answer.details.message);
  if (status === 409) {
    return uuid === undefined
      ? { refusal: 'other', message: answer.details.message }
      : { kind: 'alreadyRunning', uuid, answer };
  }
  // Taken and running, GitHub's `202`: follow it by its UUID.
  if (pending && uuid !== undefined) return { kind: 'accepted', uuid, answer };
  // Running, with nothing to follow it by: an answer Lo doesn't understand, though GitHub may have
  // taken the merge.
  if (pending) {
    throw new GithubError({
      kind: 'decode',
      message: `GitHub answered the merge with a ${status} and no UUID to follow`,
    });
  }
  // Nothing to do, GitHub's `200`: merged or queued already. Or a status Lo doesn't know, kept
  // with its UUID.
  return { kind: 'done', answer };
}

/**
 * Checks that the GitHub stack holding `pull`, if any, has below it exactly the open layers
 * `expected` names, at the heads it names, and `pull` at `head`. A pull request in no open stack,
 * or in a repository without the Stacks API, passes when `expected` names no layer. `via` is the way
 * the write would take unnamed layers with it. A refusal here sends nothing.
 */
async function checkLayers(
  client: GithubClient,
  pull: PullRef,
  expected: readonly { pr: number; head: string }[],
  head: string,
  way: Via,
): Promise<MergeRefusal | undefined> {
  const top = pull.number;
  const changed = (): MergeRefusal | undefined =>
    expected.length > 0 ? { refusal: 'stackChanged' } : undefined;
  let holding: GithubStack[] | undefined;
  try {
    holding = await stacksHolding(client, pull.repo, top);
  } catch (error) {
    if (error instanceof GithubError) return { refusal: 'unchecked', read: error.detail };
    throw error;
  }
  const stack = holding?.find((found) => openLayers(found).some((layer) => layer.number === top));
  if (!stack) return changed();
  const open = openLayers(stack);
  const at = open.findIndex((layer) => layer.number === top);
  const below = open.slice(0, at);
  if (expected.length === 0 && below.length > 0) {
    return { refusal: 'unnamedLayers', below: below.map((layer) => layer.number), via: way };
  }
  const same =
    below.length === expected.length &&
    below.every((layer, index) => layer.number === expected[index]?.pr);
  if (!same) return { refusal: 'stackChanged' };
  for (const [index, layer] of below.entries()) {
    const shown = expected[index];
    if (shown && layer.head.sha.toLowerCase() !== shown.head.toLowerCase()) {
      return { refusal: 'layerMoved', pr: shown.pr, now: layer.head.sha };
    }
  }
  if (open[at]?.head.sha.toLowerCase() !== head.toLowerCase()) return { refusal: 'headMoved' };
  return undefined;
}

/**
 * Where the async merge `uuid` on `pull` stands
 * (`GET /repos/{owner}/{repo}/pulls/{number}/merge-async/{uuid}`). GitHub answers "not found" for a
 * UUID it doesn't know, and for one whose result it no longer keeps, 24 hours after its last change.
 */
export async function mergeAsyncResult(
  client: GithubClient,
  pull: PullRef,
  uuid: string,
): Promise<AsyncMerge> {
  // A UUID is hex digits and dashes; anything else would change the path.
  if (!/^[0-9a-f-]+$/i.test(uuid)) {
    throw new GithubError({
      kind: 'decode',
      message: `${JSON.stringify(uuid)} isn't an async merge's UUID`,
    });
  }
  return client.get(`${pull.restPath()}/merge-async/${uuid}`, readAsyncMerge);
}

/** Whether `pull` is merged, and as which commit: a read, to tell what an async merge that answered `failed` did. */
export function mergedState(client: GithubClient, pull: PullRef): Promise<MergedState> {
  return client.get(pull.restPath(), (json) => {
    const fields = new Fields(json, 'pull');
    return {
      merged: fields.flag('merged'),
      merged_at: fields.maybeText('merged_at'),
      merge_commit_sha: fields.maybeText('merge_commit_sha'),
    };
  });
}

/**
 * Runs a mutation that changes a merge. An error at the mutation's own field, or about the whole
 * request, is a refusal, and then GitHub answered no payload. An error below it, such as a field of
 * the answer this account may not read, leaves the change made: the data is returned as GitHub gave
 * it, or, without data, an error that may have posted.
 */
async function mergeMutation<TResult, TVariables>(
  client: GithubClient,
  document: TypedDocumentString<TResult, TVariables>,
  variables: TVariables,
): Promise<{ data: TResult } | MergeRefusal> {
  const { data, errors, headers } = await client.graphqlPartial(document, variables);
  if (errors.some((error) => !isBelow(error, 1))) {
    return refusedOrThrow(GithubError.fromGraphQL(errors, headers));
  }
  if (data === undefined) {
    throw new GithubError({
      kind: 'decode',
      message: 'GitHub answered the change with errors and no data',
    });
  }
  return { data };
}

/** A mutation that answered nothing, without an error: an answer Lo doesn't understand, so it isn't taken as done or as refused. */
function unexplained(what: string): GithubError {
  return new GithubError({ kind: 'decode', message: `GitHub didn't say what it ${what} as` });
}

type EntryAnswer = NonNullable<
  NonNullable<DequeuePullRequestMutation['dequeuePullRequest']>['mergeQueueEntry']
>;

function queueEntry(entry: EntryAnswer): QueueEntry {
  return {
    id: entry.id,
    number: entry.pullRequest?.number,
    position: entry.position,
    state: entry.state,
    jump: entry.jump,
    solo: entry.solo,
    head: entry.headCommit?.oid,
    estimatedTimeToMerge: entry.estimatedTimeToMerge ?? undefined,
  };
}

/**
 * Adds `pull`, whose node ID is `pullRequestId`, to its base branch's merge queue, only while its
 * head is `expectedHead`, a full commit SHA; `jump` puts it at the front. GitHub's queue takes a
 * GitHub stack's layers below with it, and this write can't name them, so it reads the stack
 * holding `pull` first and refuses a layer with open layers below: a stack's layer goes into the
 * queue as a {@link queueMerge} that names them. Never sent again by itself
 * ({@link GithubError.mayHavePosted}).
 */
export async function enqueue(
  client: GithubClient,
  pull: PullRef,
  pullRequestId: string,
  expectedHead: string,
  jumping: boolean,
): Promise<QueueEntry | MergeRefusal> {
  const refused =
    expectCommit(expectedHead) ?? (await checkLayers(client, pull, [], expectedHead, 'queue'));
  return refused ?? sendEnqueue(client, pullRequestId, expectedHead, jumping);
}

/** `enqueuePullRequest`, sent as it is: {@link enqueue} and {@link jump} check first. */
async function sendEnqueue(
  client: GithubClient,
  pullRequestId: string,
  expectedHead: string,
  jumping: boolean,
): Promise<QueueEntry | MergeRefusal> {
  const answer = await mergeMutation(client, EnqueuePullRequestDocument, {
    pullRequestId,
    expectedHeadOid: expectedHead,
    jump: jumping,
  });
  if (isRefusal(answer)) return answer;
  const entry = answer.data.enqueuePullRequest?.mergeQueueEntry;
  if (!entry) throw unexplained('added it to the queue');
  return queueEntry(entry);
}

/**
 * Moves `pull`, whose node ID is `pullRequestId`, to the front of its base branch's merge queue, at
 * `expectedHead`, a full commit SHA. GitHub moves an entry only as it joins, so this takes it out,
 * waits for `pause`, and adds it again with `jump`, all in the caller's one turn of the account's
 * queue.
 *
 * Before anything is sent, it reads the GitHub stack holding `pull`, and refuses a layer with other
 * open layers (`stacked`): GitHub queues a stack's layers in order and takes the layers above out
 * with one taken out, and adding one back can't name them. A stack it can't read is refused too
 * (`queueUnchecked`), and so is a stack that shows another head than `expectedHead`.
 *
 * A refusal, or the dequeue's error, means nothing changed, or, when the dequeue's answer was lost
 * ({@link GithubError.mayHavePosted}), it may be out of the queue, and it wasn't added again. An
 * answer without the entry taken out counts as lost. Once it's out, the re-add's outcome is
 * {@link Jumped}. Never sent again by itself.
 */
export async function jump(
  client: GithubClient,
  pull: PullRef,
  pullRequestId: string,
  expectedHead: string,
  pause: () => Promise<void>,
): Promise<Jumped | MergeRefusal> {
  const refused = expectCommit(expectedHead) ?? (await checkAlone(client, pull, expectedHead));
  if (refused) return refused;
  const out = await dequeue(client, pullRequestId);
  if (isRefusal(out)) return out;
  if (out.entry === undefined) {
    // GitHub answers taking an entry out with the entry, and refuses one not in the queue: without
    // it, Lo can't tell what happened, so it adds nothing back.
    throw new GithubError({
      kind: 'decode',
      message: 'GitHub answered taking it out of the queue without its entry',
    });
  }
  await pause();
  try {
    const back = await sendEnqueue(client, pullRequestId, expectedHead, true);
    return isRefusal(back) ? { kind: 'notBack', failure: back } : { kind: 'moved', entry: back };
  } catch (error) {
    if (!(error instanceof GithubError)) throw error;
    return { kind: 'notBack', failure: error.detail };
  }
}

/**
 * Refuses, sending nothing, when `pull` is a layer of an open GitHub stack with other open layers,
 * when the stack can't be read, or when the stack shows `pull` at another head than `head`. A
 * repository without the Stacks API passes.
 */
async function checkAlone(
  client: GithubClient,
  pull: PullRef,
  head: string,
): Promise<MergeRefusal | undefined> {
  let holding: GithubStack[] | undefined;
  try {
    holding = await stacksHolding(client, pull.repo, pull.number);
  } catch (error) {
    if (error instanceof GithubError) return { refusal: 'queueUnchecked', read: error.detail };
    throw error;
  }
  const stack = holding?.find((found) =>
    openLayers(found).some((layer) => layer.number === pull.number),
  );
  if (!stack) return undefined;
  const open = openLayers(stack);
  const others = open.map((layer) => layer.number).filter((number) => number !== pull.number);
  if (others.length > 0) return { refusal: 'stacked', others };
  const moved = open.some(
    (layer) => layer.number === pull.number && layer.head.sha.toLowerCase() !== head.toLowerCase(),
  );
  return moved ? { refusal: 'headMoved' } : undefined;
}

/**
 * Takes `pull`, whose node ID is `pullRequestId`, out of `branch`'s merge queue, with `above`: the
 * layers above it in its GitHub stack that are in the queue, bottom to top, which GitHub takes out
 * with it, as the question named them. GitHub takes a stack's layers out only from the bottom open
 * one: for a layer above, it answers that the layer's own base branch has no merge queue.
 *
 * In the same turn it first reads the stack holding `pull`, and the queue when the stack has open
 * layers above it, and refuses, sending nothing, when the layers above in the queue aren't `above`
 * (`unnamedAbove` when it named none, else `stackChanged`), when `pull` has open layers below
 * (`stackChanged`: it was asked about as the bottom), or when it can't read them
 * (`queueUnchecked`). Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function dequeueNamed(
  client: GithubClient,
  pull: PullRef,
  pullRequestId: string,
  branch: string,
  above: readonly number[],
): Promise<Dequeued | MergeRefusal> {
  let holding: GithubStack[] | undefined;
  try {
    holding = await stacksHolding(client, pull.repo, pull.number);
  } catch (error) {
    return queueUnchecked(error);
  }
  const stack = holding?.find((found) =>
    openLayers(found).some((layer) => layer.number === pull.number),
  );
  const open = stack ? openLayers(stack).map((layer) => layer.number) : [];
  if (open.indexOf(pull.number) > 0) return { refusal: 'stackChanged' };
  const layersAbove = open.slice(1);
  let queuedAbove: number[] = [];
  if (layersAbove.length > 0) {
    let queued: { numbers: number[]; cutShort: boolean };
    try {
      queued = await queuedNumbers(client, pull.repo, branch);
    } catch (error) {
      return queueUnchecked(error);
    }
    // Past the 100 entries read, a layer above may be queued all the same.
    queuedAbove = layersAbove.filter((layer) => queued.numbers.includes(layer) || queued.cutShort);
  }
  const same =
    queuedAbove.length === above.length &&
    queuedAbove.every((layer, index) => layer === above[index]);
  if (!same) {
    return above.length === 0
      ? { refusal: 'unnamedAbove', above: queuedAbove }
      : { refusal: 'stackChanged' };
  }
  return dequeue(client, pullRequestId);
}

/** A queue write Lo didn't send for want of a read, which failed with `error`. */
function queueUnchecked(error: unknown): MergeRefusal {
  if (error instanceof GithubError) return { refusal: 'queueUnchecked', read: error.detail };
  throw error;
}

/** The pull requests in `branch`'s merge queue, by number, and whether there were more than Lo read. */
async function queuedNumbers(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
): Promise<{ numbers: number[]; cutShort: boolean }> {
  const data = await client.graphql(QueueViewDocument, {
    owner: repo.owner,
    name: repo.name,
    branch,
  });
  const entries = data.repository?.mergeQueue?.entries;
  const nodes = (entries?.nodes ?? []).filter((node) => node != null);
  return {
    numbers: nodes.flatMap((node) => (node.pullRequest ? [node.pullRequest.number] : [])),
    cutShort: (entries?.totalCount ?? 0) > nodes.length,
  };
}

/**
 * Takes the pull request whose node ID is `pullRequestId` out of its merge queue, as it is:
 * {@link dequeueNamed} checks a GitHub stack's layers above first. Answers with the entry it had,
 * as GitHub answers. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function dequeue(
  client: GithubClient,
  pullRequestId: string,
): Promise<Dequeued | MergeRefusal> {
  const answer = await mergeMutation(client, DequeuePullRequestDocument, { id: pullRequestId });
  if (isRefusal(answer)) return answer;
  const payload = answer.data.dequeuePullRequest;
  if (!payload) throw unexplained('took it out');
  const entry = payload.mergeQueueEntry;
  return { entry: entry ? queueEntry(entry) : undefined };
}

/** The merge methods Lo knows. */
const METHODS: readonly PullRequestMergeMethod[] = ['MERGE', 'SQUASH', 'REBASE'];

/** A merge method GitHub named, or nothing for one Lo doesn't know, which is never read as any it does. */
export function knownMethod(name: string): PullRequestMergeMethod | undefined {
  return METHODS.find((method) => method === name);
}

type AutoMergeAnswer = {
  number: number;
  headRefOid: string;
  isInMergeQueue: boolean;
  autoMergeRequest: { mergeMethod: string; enabledBy: { login: string } | null } | null;
};

function autoMergeState(pull: AutoMergeAnswer): AutoMergeState {
  const request = pull.autoMergeRequest;
  return {
    number: pull.number,
    head: pull.headRefOid,
    autoMerge: request
      ? { method: knownMethod(request.mergeMethod), enabledBy: request.enabledBy?.login }
      : undefined,
    inQueue: pull.isInMergeQueue,
  };
}

/**
 * Turns on auto-merge for `pull`, whose node ID is `pullRequestId`, as `request` says. When
 * auto-merge merges a GitHub stack's layer, the layers below may merge with it, and this write can't
 * name them, so it reads the stack holding `pull` first and refuses a layer with open layers below.
 * Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function enableAutoMerge(
  client: GithubClient,
  pull: PullRef,
  pullRequestId: string,
  request: AutoMergeRequest,
): Promise<AutoMergeState | MergeRefusal> {
  const refused =
    expectCommit(request.expectedHead) ??
    (await checkLayers(client, pull, [], request.expectedHead, 'autoMerge'));
  if (refused) return refused;
  const answer = await mergeMutation(client, EnablePullRequestAutoMergeDocument, {
    pullRequestId,
    mergeMethod: request.method,
    expectedHeadOid: request.expectedHead,
    commitHeadline: request.commitHeadline,
    commitBody: request.commitBody,
  });
  if (isRefusal(answer)) return answer;
  const changed = answer.data.enablePullRequestAutoMerge?.pullRequest;
  if (!changed) throw unexplained('turned auto-merge on');
  return autoMergeState(changed);
}

/** Turns auto-merge off for the pull request whose node ID is `pullRequestId`. Never sent again by itself ({@link GithubError.mayHavePosted}). */
export async function disableAutoMerge(
  client: GithubClient,
  pullRequestId: string,
): Promise<AutoMergeState | MergeRefusal> {
  const answer = await mergeMutation(client, DisablePullRequestAutoMergeDocument, {
    pullRequestId,
  });
  if (isRefusal(answer)) return answer;
  const changed = answer.data.disablePullRequestAutoMerge?.pullRequest;
  if (!changed) throw unexplained('turned auto-merge off');
  return autoMergeState(changed);
}

/** A stack as the Stacks API answers it, read. */
export function readGithubStack(json: unknown): GithubStack {
  const stack = new Fields(json, 'stack');
  const pulls: unknown = stack.raw('pull_requests');
  if (!Array.isArray(pulls))
    throw new GithubError({ kind: 'decode', message: "stack.pull_requests isn't a list" });
  return {
    number: stack.integer('number'),
    node_id: stack.text('node_id'),
    base: { ref: stack.fields('base').text('ref') },
    open: stack.flag('open'),
    pull_requests: pulls.map((pull: unknown, index) => {
      const fields = new Fields(pull, `stack.pull_requests[${index}]`);
      const head = fields.fields('head');
      return {
        number: fields.integer('number'),
        state: fields.text('state'),
        draft: fields.flag('draft'),
        merged_at: fields.maybeText('merged_at'),
        head: { ref: head.text('ref'), sha: head.text('sha') },
      };
    }),
  };
}

function readStacks(json: unknown): GithubStack[] {
  if (!Array.isArray(json))
    throw new GithubError({ kind: 'decode', message: "the stacks aren't a list" });
  return json.map(readGithubStack);
}

/**
 * `repo`'s open GitHub stacks, or only the open one holding pull request `of`
 * (`GET /repos/{owner}/{repo}/stacks`), following GitHub's pages, up to 1,000 stacks, and saying
 * when there were more. GitHub lists closed stacks too, whatever `state` asks, so they're left out
 * here. Nothing when GitHub answers "not found": the repository doesn't have the Stacks API, as on a
 * GitHub Enterprise Server without stacks. github.com has no setting that turns it off.
 */
export async function stacks(
  client: GithubClient,
  repo: RepoRef,
  of?: number,
): Promise<StackList | undefined> {
  let list: StackList | undefined;
  if (of === undefined) {
    list = await allStacks(client, repo);
  } else {
    const holding = await stacksHolding(client, repo, of);
    list = holding && { stacks: holding, cutShort: false };
  }
  return list && { ...list, stacks: list.stacks.filter((stack) => stack.open) };
}

/**
 * The GitHub stack holding pull request `number`: the open one, or once none is, the newest closed
 * one, as after every layer merged. Nothing when no stack holds it, or without the Stacks API. A
 * read, to follow a stack's merge layer by layer.
 */
export async function stackHolding(
  client: GithubClient,
  repo: RepoRef,
  number: number,
): Promise<GithubStack | undefined> {
  const holding = await stacksHolding(client, repo, number);
  if (!holding) return undefined;
  return (
    holding.find((stack) => stack.open) ??
    holding.reduce<GithubStack | undefined>(
      (newest, stack) => (newest && newest.number >= stack.number ? newest : stack),
      undefined,
    )
  );
}

/** Every stack, open or closed, that holds pull request `number`, or nothing without the Stacks API. */
export async function stacksHolding(
  client: GithubClient,
  repo: RepoRef,
  number: number,
): Promise<GithubStack[] | undefined> {
  try {
    return await client.get(`${repoPath(repo)}/stacks?pull_request=${number}`, readStacks);
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound') return undefined;
    throw error;
  }
}

/** Up to {@link MAX_STACK_PAGES} pages of `repo`'s stacks, open or closed, saying whether there were more, or nothing without the Stacks API. */
async function allStacks(client: GithubClient, repo: RepoRef): Promise<StackList | undefined> {
  let path = `${repoPath(repo)}/stacks?per_page=100`;
  const list: StackList = { stacks: [], cutShort: false };
  for (let page = 1; page <= MAX_STACK_PAGES; page++) {
    let response;
    try {
      response = await client.send('GET', path);
    } catch (error) {
      const missing = error instanceof GithubError && error.detail.kind === 'notFound';
      if (missing && list.stacks.length === 0) return undefined;
      throw error;
    }
    list.stacks.push(...response.json(readStacks));
    const next = nextLink(response.header('link') ?? '');
    if (next === undefined) break;
    if (page === MAX_STACK_PAGES) list.cutShort = true;
    else path = next;
  }
  return list;
}

/**
 * Makes `prs`, bottom to top, a GitHub stack (`POST /repos/{owner}/{repo}/stacks`). Each one's base
 * branch must be the head branch of the one below. When its answer is lost, Lo looks for an open
 * stack of exactly `prs` before saying it may have been made. Never sent again by itself
 * ({@link GithubError.mayHavePosted}).
 */
export function createStack(
  client: GithubClient,
  repo: RepoRef,
  prs: readonly number[],
): Promise<GithubStack | MergeRefusal> {
  const made = postStack(client, `${repoPath(repo)}/stacks`, prs);
  return settled(client, repo, prs, made, (stack) => sameNumbers(stackNumbers(stack), prs));
}

/**
 * Adds `prs`, bottom to top, to the top of GitHub stack `stack`
 * (`POST /repos/{owner}/{repo}/stacks/{stack}/add`). The first one's base branch must be the head
 * branch of the stack's top. When its answer is lost, Lo looks for `stack` ending in `prs` before
 * saying they may have been added. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export function addToStack(
  client: GithubClient,
  repo: RepoRef,
  stack: number,
  prs: readonly number[],
): Promise<GithubStack | MergeRefusal> {
  const added = postStack(client, `${repoPath(repo)}/stacks/${stack}/add`, prs);
  return settled(client, repo, prs, added, (found) => {
    const layers = stackNumbers(found);
    return found.number === stack && sameNumbers(layers.slice(layers.length - prs.length), prs);
  });
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((number, index) => number === b[index]);
}

/** The Stacks API's create or add, with GitHub's refusals as values. */
async function postStack(
  client: GithubClient,
  path: string,
  prs: readonly number[],
): Promise<GithubStack | MergeRefusal> {
  try {
    return await client.write(
      'POST',
      path,
      JSON.stringify({ pull_requests: prs }),
      readGithubStack,
    );
  } catch (error) {
    return refusedOrThrow(error);
  }
}

/**
 * A stack write's result, or, when its answer was lost, the open stack holding `prs`' bottom that
 * `done` says the write made, found by a read. Without one, or when the read fails, the write's error
 * as it was.
 */
async function settled(
  client: GithubClient,
  repo: RepoRef,
  prs: readonly number[],
  written: Promise<GithubStack | MergeRefusal>,
  done: (stack: GithubStack) => boolean,
): Promise<GithubStack | MergeRefusal> {
  try {
    return await written;
  } catch (error) {
    const bottom = prs[0];
    if (!(error instanceof GithubError) || !error.mayHavePosted() || bottom === undefined)
      throw error;
    let found: StackList | undefined;
    try {
      found = await stacks(client, repo, bottom);
    } catch {
      throw error;
    }
    const made = found?.stacks.find(done);
    if (made) return made;
    throw error;
  }
}

/**
 * {@link unstack}, only while GitHub stack `stack` holds exactly `prs`, bottom to top, as when Lo
 * made it: it reads the stack first, and refuses (`stackChanged`) when the stack holds other pull
 * requests, such as layers added since, which unstacking would take out too, or it's gone or
 * closed. With no pull requests named there's nothing to check it against, and it's refused too.
 */
export async function unstackHolding(
  client: GithubClient,
  repo: RepoRef,
  stack: number,
  prs: readonly number[],
): Promise<{ left: GithubStack | undefined } | MergeRefusal> {
  const bottom = prs[0];
  if (bottom === undefined) return { refusal: 'stackChanged' };
  const holding = await stacksHolding(client, repo, bottom);
  const found = holding?.find((held) => held.number === stack && held.open);
  if (!found || !sameNumbers(stackNumbers(found), prs)) return { refusal: 'stackChanged' };
  return unstack(client, repo, stack);
}

/**
 * Takes every pull request that isn't merged or queued out of GitHub stack `stack`
 * (`POST /repos/{owner}/{repo}/stacks/{stack}/unstack`). Answers with what's left of it, or nothing
 * when GitHub dissolved it. Never sent again by itself ({@link GithubError.mayHavePosted}).
 */
export async function unstack(
  client: GithubClient,
  repo: RepoRef,
  stack: number,
): Promise<{ left: GithubStack | undefined } | MergeRefusal> {
  let response;
  try {
    response = await client.send('POST', `${repoPath(repo)}/stacks/${stack}/unstack`);
  } catch (error) {
    return refusedOrThrow(error);
  }
  if (response.status === 204 || response.body.length === 0) return { left: undefined };
  return { left: response.json(readGithubStack) };
}

/**
 * Changes `pull`'s base branch to `base` (`PATCH /repos/{owner}/{repo}/pulls/{number}`), from
 * whatever it is. {@link retarget} checks it first. Never sent again by itself
 * ({@link GithubError.mayHavePosted}).
 */
export async function changeBase(
  client: GithubClient,
  pull: PullRef,
  base: string,
): Promise<PullSummary | MergeRefusal> {
  try {
    return await client.write('PATCH', pull.restPath(), JSON.stringify({ base }), readPullSummary);
  } catch (error) {
    return refusedOrThrow(error);
  }
}

/**
 * Moves a pull request's base branch from `retarget.from` to `retarget.to`, as a step of "Make this
 * a GitHub stack", of rolling one back, or of merging a chain a layer at a time. It reads the pull
 * request first: one already on `to` is left as it is, which is how a rollback treats a change that
 * may not have happened, and one on any other branch than `from` was changed elsewhere since the
 * plan was made, so it's refused (`baseChanged`) rather than moved again.
 */
export async function retarget(
  client: GithubClient,
  repo: RepoRef,
  move: Retarget,
): Promise<PullSummary | MergeRefusal> {
  const moved = await retargetMoving(client, repo, move);
  return isRefusal(moved) ? moved : moved.pull;
}

/** {@link retarget}, saying whether it changed the base: not when it was on `move.to` already. */
export async function retargetMoving(
  client: GithubClient,
  repo: RepoRef,
  move: Retarget,
): Promise<{ pull: PullSummary; moved: boolean } | MergeRefusal> {
  const pull = PullRef.of(repo, move.pr);
  const now = await client.get(pull.restPath(), readPullSummary);
  if (now.base.ref === move.to) return { pull: now, moved: false };
  if (now.base.ref !== move.from) return { refusal: 'baseChanged', now: now.base.ref };
  const changed = await changeBase(client, pull, move.to);
  return isRefusal(changed) ? changed : { pull: changed, moved: true };
}

/**
 * Runs one step of "Make this a GitHub stack". Run the steps in order, and stop at the first that
 * fails; `@lo/stacks`' `rollback` says how to undo those that ran.
 */
export async function runConversionStep(
  client: GithubClient,
  repo: RepoRef,
  step: ConversionStep,
): Promise<StepDone | MergeRefusal> {
  switch (step.kind) {
    case 'retarget': {
      const moved = await retargetMoving(client, repo, step.retarget);
      if (isRefusal(moved)) return moved;
      return { kind: moved.moved ? 'retargeted' : 'alreadyThere', pull: moved.pull };
    }
    case 'createStack': {
      const made = await createStack(client, repo, step.prs);
      return isRefusal(made) ? made : { kind: 'stacked', stack: made };
    }
    case 'addToStack': {
      const added = await addToStack(client, repo, step.stack, step.prs);
      return isRefusal(added) ? added : { kind: 'stacked', stack: added };
    }
    default:
      throw new Error(
        `a step of a stack conversion Lo doesn't know: ${JSON.stringify(step satisfies never)}`,
      );
  }
}
