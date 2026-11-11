/**
 * The writes that merge, run in an account's queue like any of the poller's writes: async merges,
 * the merge queue, auto-merge, GitHub stacks and base branches. Each makes what it changes out of
 * date, whatever its outcome, so it's read again.
 *
 * None is ever sent again by Lo itself. A write that failed may still have been done, when its
 * answer was lost or GitHub's server failed ({@link GithubError.mayHavePosted}), and the reads that
 * follow it show what GitHub has.
 *
 * The open pull request's check sees a merge, a queue entry and a base branch change. Auto-merge
 * shows in it only as a timeline event, so turning it on or off also reads the merge facts again. A
 * GitHub stack shows in the repository's list of open pull requests, which every stack write lists
 * again, and in each of its pull requests.
 *
 * While GitHub has asked Lo to hold off writing (the poller's `writesHeldUntil`), a merge, a change
 * to the merge queue or to auto-merge isn't sent: it's refused (`paused`), and the person asks again
 * once GitHub allows, on what's on screen then. Lo doesn't merge by itself minutes after the click.
 * A write to a GitHub stack or a base branch waits instead, and is sent once the pause is over: it's
 * a step of a plan Lo runs in order (making a stack, rolling one back, merging a chain a layer at a
 * time), and a refusal partway would leave the stack half changed, with the writes that would put it
 * back refused by the same pause. Each is checked against its plan when it's sent, however long it
 * waited: a base branch change and an unstack read what they change first, in the same turn, and
 * GitHub checks a stack made or added to as it does it. Each can be given up on through a signal.
 */

import type { GithubClient } from '../client.ts';
import {
  addToStack,
  createStack,
  dequeueNamed,
  disableAutoMerge,
  enableAutoMerge,
  enqueue,
  jump,
  mergeAsync,
  mergeAsyncResult,
  retarget,
  runConversionStep,
  unstackHolding,
  type AsyncMerge,
  type AutoMergeRequest,
  type AutoMergeState,
  type ConversionStep,
  type Dequeued,
  type GithubStack,
  type Jumped,
  type MergeRefusal,
  type MergeRequest,
  type QueueEntry,
  type Retarget,
  type StepDone,
  type Submitted,
} from '../merge-writes.ts';
import type { PullSummary } from '../pulls.ts';
import { PullRef, type RepoRef, type Target } from '../refs.ts';
import type { WriteOptions } from './poller.ts';
import { MERGE_FACTS } from './reads.ts';

/** What these writes need of the poller. */
export interface MergeWriter {
  writeChanging<T>(
    targets: readonly Target[],
    request: (client: GithubClient) => Promise<T>,
    options?: WriteOptions<T>,
  ): Promise<T>;
  readOnce<T>(request: (client: GithubClient) => Promise<T>, signal?: AbortSignal): Promise<T>;
  readonly writeSpacing: number;
}

/** The merge facts' read, for a change the check doesn't see. */
const FACTS = [{ name: MERGE_FACTS.name, afresh: false }];

/** Lo's refusal of a write while GitHub has asked it to hold off, until `until`. */
function paused(until: number): MergeRefusal {
  return { refusal: 'paused', until };
}

/** What a write to a GitHub stack, or to a base branch, changes: the repository's list of open pull requests, and each pull request named. */
function stackTargets(repo: RepoRef, prs: readonly number[]): Target[] {
  return [repo, ...prs.map((number) => PullRef.of(repo, number))];
}

/**
 * Asks GitHub to merge `pull` as `request` says, in the background. The answer names the UUID to
 * follow with {@link mergeAsyncResultOf}: only `MergeJobs` sends one, running one merge per pull
 * request and following it. One given up on through `signal` while it waits for its turn is never
 * sent. Never sent again by itself.
 */
export function mergeAsyncOn(
  writer: MergeWriter,
  pull: PullRef,
  request: MergeRequest,
  signal?: AbortSignal,
): Promise<Submitted | MergeRefusal> {
  return writer.writeChanging([pull], (client) => mergeAsync(client, pull, request), {
    whilePaused: paused,
    signal,
  });
}

/** Where the async merge `uuid` on `pull` stands: a read, in the account's queue. */
export function mergeAsyncResultOf(
  writer: MergeWriter,
  pull: PullRef,
  uuid: string,
  signal?: AbortSignal,
): Promise<AsyncMerge> {
  return writer.readOnce((client) => mergeAsyncResult(client, pull, uuid), signal);
}

/**
 * Adds `pull`, whose node ID is `pullRequestId`, to its base branch's merge queue, only while its
 * head is `expectedHead`; `jumping` puts it at the front. A GitHub stack's layer with open layers
 * below is refused, since this can't name them. Never sent again by itself.
 */
export function enqueueOn(
  writer: MergeWriter,
  pull: PullRef,
  pullRequestId: string,
  expectedHead: string,
  jumping: boolean,
): Promise<QueueEntry | MergeRefusal> {
  return writer.writeChanging(
    [pull],
    (client) => enqueue(client, pull, pullRequestId, expectedHead, jumping),
    { whilePaused: paused },
  );
}

/**
 * Takes `pull`, whose node ID is `pullRequestId`, out of `branch`'s merge queue, with `above`, the
 * layers above it in its GitHub stack that are in the queue, which GitHub takes out with it. It
 * reads the stack, and the queue, in the same turn first, and refuses when the layers above in the
 * queue aren't `above`. Never sent again by itself.
 */
export function dequeueOn(
  writer: MergeWriter,
  pull: PullRef,
  pullRequestId: string,
  branch: string,
  above: readonly number[],
): Promise<Dequeued | MergeRefusal> {
  return writer.writeChanging(
    [pull],
    (client) => dequeueNamed(client, pull, pullRequestId, branch, above),
    { whilePaused: paused },
  );
}

/**
 * Moves `pull`, whose node ID is `pullRequestId`, to the front of its base branch's merge queue at
 * `expectedHead`: in one turn of the account's queue, it checks that `pull` isn't a layer of a
 * GitHub stack with other open layers, takes it out, waits as long as between writes, and adds it
 * again with `jump`. Never sent again by itself.
 */
export function jumpOn(
  writer: MergeWriter,
  pull: PullRef,
  pullRequestId: string,
  expectedHead: string,
): Promise<Jumped | MergeRefusal> {
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, writer.writeSpacing));
  return writer.writeChanging(
    [pull],
    (client) => jump(client, pull, pullRequestId, expectedHead, pause),
    { whilePaused: paused },
  );
}

/**
 * Turns on auto-merge for `pull`, whose node ID is `pullRequestId`. A GitHub stack's layer with open
 * layers below is refused, since this can't name them. Never sent again by itself.
 */
export function enableAutoMergeOn(
  writer: MergeWriter,
  pull: PullRef,
  pullRequestId: string,
  request: AutoMergeRequest,
): Promise<AutoMergeState | MergeRefusal> {
  return writer.writeChanging(
    [pull],
    (client) => enableAutoMerge(client, pull, pullRequestId, request),
    { again: () => FACTS, whilePaused: paused },
  );
}

/** Turns auto-merge off for `pull`, whose node ID is `pullRequestId`. Never sent again by itself. */
export function disableAutoMergeOn(
  writer: MergeWriter,
  pull: PullRef,
  pullRequestId: string,
): Promise<AutoMergeState | MergeRefusal> {
  return writer.writeChanging([pull], (client) => disableAutoMerge(client, pullRequestId), {
    again: () => FACTS,
    whilePaused: paused,
  });
}

/**
 * Makes `prs`, bottom to top, a GitHub stack in `repo`. GitHub checks the plan as it makes it: each
 * pull request open, in no other stack, and based on the head branch of the one below. Given up on
 * through `signal`, it's never sent. Never sent again by itself.
 */
export function createStackIn(
  writer: MergeWriter,
  repo: RepoRef,
  prs: readonly number[],
  signal?: AbortSignal,
): Promise<GithubStack | MergeRefusal> {
  return writer.writeChanging(stackTargets(repo, prs), (client) => createStack(client, repo, prs), {
    signal,
  });
}

/**
 * Adds `prs`, bottom to top, to the top of GitHub stack `stack` in `repo`. GitHub checks the plan as
 * it adds them: the first based on the head branch of the stack's top, as it is then. Given up on
 * through `signal`, it's never sent. Never sent again by itself.
 */
export function addToStackIn(
  writer: MergeWriter,
  repo: RepoRef,
  stack: number,
  prs: readonly number[],
  signal?: AbortSignal,
): Promise<GithubStack | MergeRefusal> {
  return writer.writeChanging(
    stackTargets(repo, prs),
    (client) => addToStack(client, repo, stack, prs),
    { signal },
  );
}

/**
 * Takes every pull request that isn't merged or queued out of GitHub stack `stack` in `repo`, as
 * rolling back a stack Lo made does. `prs` are every pull request Lo knows is in it, bottom to top:
 * it reads the stack first, in the same turn, and refuses (`stackChanged`) when it holds others, as
 * after layers were added while the write waited, since GitHub's unstack would take those out too.
 * Given up on through `signal`, it's never sent. Never sent again by itself.
 */
export function unstackIn(
  writer: MergeWriter,
  repo: RepoRef,
  stack: number,
  prs: readonly number[],
  signal?: AbortSignal,
): Promise<{ left: GithubStack | undefined } | MergeRefusal> {
  return writer.writeChanging(
    stackTargets(repo, prs),
    (client) => unstackHolding(client, repo, stack, prs),
    { signal },
  );
}

/**
 * Moves a pull request in `repo` from `move.from` to `move.to`, as "Make this a GitHub stack", its
 * rollback and merging a chain a layer at a time do: it reads the pull request first, in the same
 * turn, and leaves it where it is when it's on `to` already, or refuses when it's on another branch
 * than `from`. Given up on through `signal`, it's never sent. Never sent again by itself.
 */
export function retargetIn(
  writer: MergeWriter,
  repo: RepoRef,
  move: Retarget,
  signal?: AbortSignal,
): Promise<PullSummary | MergeRefusal> {
  return writer.writeChanging(
    stackTargets(repo, [move.pr]),
    (client) => retarget(client, repo, move),
    { signal },
  );
}

/**
 * Runs one step of "Make this a GitHub stack", or a base branch change of its rollback, each checked
 * as {@link retargetIn}, {@link createStackIn} and {@link addToStackIn} say. Given up on through
 * `signal`, it's never sent. Never sent again by itself.
 */
export function runConversionStepIn(
  writer: MergeWriter,
  repo: RepoRef,
  step: ConversionStep,
  signal?: AbortSignal,
): Promise<StepDone | MergeRefusal> {
  const prs = step.kind === 'retarget' ? [step.retarget.pr] : step.prs;
  return writer.writeChanging(
    stackTargets(repo, prs),
    (client) => runConversionStep(client, repo, step),
    { signal },
  );
}
