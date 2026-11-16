/**
 * What the merge queue view reads (`docs/design.md`, "The merge queue"): a base branch's queue with
 * the checks each entry runs ({@link queueView}), the pull requests waiting to join it with
 * auto-merge on ({@link queueWaiting}), and why a pull request last left its queue
 * ({@link queueRemoval}). Each is read only while it's shown, outside the poller's cache, which keys
 * reads by pull request or repository and not by branch.
 *
 * GitHub's enum values are kept as GitHub names them, so one newer than Lo survives to be read as
 * one. A part GitHub leaves out with an error is noted by its path, so a list missing an item never
 * reads as GitHub's whole answer, nor a queue left out as none: {@link queueViewCutShort} and
 * {@link queueWaitingCutShort} say so. A part that can't be null failing nulls the repository or the
 * pull request, which fails the read with GitHub's errors rather than reading as not found.
 */

import type { GithubClient } from './client.ts';
import {
  QueueRemovalDocument,
  QueueViewDocument,
  QueueWaitingDocument,
  type QueueCheckFragment,
  type QueueRemovalQuery,
  type QueueViewQuery,
  type QueueWaitingQuery,
} from './generated/graphql.ts';
import type { GraphQLError } from './graphql.ts';
import { fieldPath, present, type CheckFacts } from './merge.ts';
import type { PullRef, RepoRef } from './refs.ts';

/**
 * The path, from the repository, of the queue's settings, which GitHub shows only to those who can
 * write to the repository: an OAuth token gets null, other tokens a `FORBIDDEN` error, which is
 * GitHub's answer too, not a part left out.
 */
const HIDDEN_SETTINGS = 'mergeQueue.configuration';

/** A base branch's merge queue, as the queue view shows it. */
export interface QueueView {
  /** The branch. */
  branch: string;
  /**
   * `Repository.viewerPermission`: `READ`, `TRIAGE`, `WRITE`, `MAINTAIN` or `ADMIN`, which decides
   * whether the account may take an entry out or move one to the front. Nothing when GitHub
   * doesn't say.
   */
  viewerPermission: string | undefined;
  /**
   * The queue, or nothing when the branch has none, or when GitHub left it out with an error
   * (`mergeQueue` in {@link leftOut}): {@link queueLeftOut} tells the two apart.
   */
  queue: QueueFacts | undefined;
  /**
   * The parts GitHub left out with an error, by their path from the repository, such as
   * `mergeQueue.entries.nodes.2.headCommit.statusCheckRollup`, but for the settings it hides from
   * those who can't write. An entry left out is missing from {@link QueueFacts.entries}, and the
   * entries left out leave none, with a {@link QueueFacts.total} of 0.
   */
  leftOut: string[];
}

/** A merge queue's settings and entries. */
export interface QueueFacts {
  /** `url`: the queue's page on GitHub. */
  url: string;
  /** `nextEntryEstimatedTimeToMerge`, in seconds, when GitHub has an estimate. */
  nextEstimate: number | undefined;
  /** `configuration`, which GitHub shows only to those who can write to the repository. */
  settings: QueueSettings | undefined;
  /** The entries read, in the queue's order: the first merges next. */
  entries: QueueEntryFacts[];
  /**
   * `entries.totalCount`: more than `entries` holds when the queue is longer than the 100 read, or
   * GitHub left an entry out. 0 when GitHub left the entries out, which isn't an empty queue.
   */
  total: number;
}

/** A merge queue's settings: `MergeQueueConfiguration`. */
export interface QueueSettings {
  /** `mergeMethod`. */
  method: string | undefined;
  /**
   * `mergingStrategy`: `ALLGREEN`, every entry's own commit must pass, or `HEADGREEN`, only the
   * commit at the head of what's tested together.
   */
  strategy: string | undefined;
  /** `maximumEntriesToBuild`: how many entries GitHub tests at once. */
  building: number | undefined;
}

/** An entry in a merge queue: `MergeQueueEntry`. */
export interface QueueEntryFacts {
  /** `id`. */
  id: string;
  /** `position`: 1 merges next. */
  position: number;
  /** `state`: `QUEUED`, `AWAITING_CHECKS`, `MERGEABLE`, `UNMERGEABLE` or `LOCKED`. */
  state: string;
  /** `enqueuedAt`. */
  enqueuedAt: string;
  /** `estimatedTimeToMerge`, in seconds, when GitHub has an estimate. */
  estimate: number | undefined;
  /** `jump`: it was put at the front. */
  jump: boolean;
  /** `solo`: it's tested by itself. */
  solo: boolean;
  /** `enqueuer.login`: who added it. */
  enqueuer: string | undefined;
  /**
   * `baseCommit.oid`: the commit GitHub builds it on, the branch's tip for the first entry and the
   * commit the entry ahead is tested on for the others. Nothing until GitHub builds it.
   */
  base: string | undefined;
  /**
   * `headCommit.oid`: the commit GitHub tests it on, the pull request's changes on {@link base}.
   * Nothing until GitHub builds it.
   */
  tested: string | undefined;
  /** The first 50 checks on {@link tested}, in GitHub's order, but those of a kind newer than Lo. */
  checks: CheckFacts[];
  /** The pull request, or nothing when GitHub didn't give it. */
  pullRequest: QueuedPullRequest | undefined;
}

/** The pull request a merge queue's entry merges. */
export interface QueuedPullRequest {
  /** `id`: its node ID. */
  id: string;
  /** `number`. */
  number: number;
  /** `title`. */
  title: string;
  /** `url`. */
  url: string;
  /** `headRefOid`. */
  head: string;
  /** `author.login`, or nothing for a deleted account. */
  author: string | undefined;
  /** `viewerDidAuthor`. */
  viewerDidAuthor: boolean;
}

/** The items GitHub gave of `nodes`, without those it left out as nulls. */
function given<T>(nodes: readonly (T | null)[] | null | undefined): T[] {
  return (nodes ?? []).filter((node): node is T => node !== null);
}

/** A check on a commit, or nothing for one of a kind newer than Lo. */
function queueCheck(node: QueueCheckFragment): CheckFacts | undefined {
  const { __typename: typename } = node;
  switch (typename) {
    case 'CheckRun':
      return {
        kind: 'checkRun',
        name: node.name,
        status: node.status,
        conclusion: node.conclusion ?? undefined,
        url: node.detailsUrl ?? node.url,
      };
    case 'StatusContext':
      return {
        kind: 'status',
        context: node.context,
        state: node.state,
        url: node.targetUrl ?? undefined,
      };
    default:
      typename satisfies never;
      return undefined;
  }
}

/** The checks on a commit, as `QueueCheck` reads them. */
function queueChecks(
  commit: {
    statusCheckRollup: { contexts: { nodes: (QueueCheckFragment | null)[] | null } } | null;
  } | null,
): CheckFacts[] {
  return given(commit?.statusCheckRollup?.contexts.nodes).flatMap((node) => {
    const check = queueCheck(node);
    return check ? [check] : [];
  });
}

/** The paths of `errors` from the repository, but `hidden`. */
function leftOutBy(errors: readonly GraphQLError[], hidden: readonly string[]): string[] {
  const paths: string[] = [];
  for (const error of errors) {
    const path = fieldPath(error.path);
    if (error.type === 'FORBIDDEN' && hidden.includes(path)) continue;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

type QueueData = NonNullable<NonNullable<QueueViewQuery['repository']>['mergeQueue']>;
type EntryData = NonNullable<NonNullable<NonNullable<QueueData['entries']>['nodes']>[number]>;

function entryFacts(entry: EntryData): QueueEntryFacts {
  const pull = entry.pullRequest;
  return {
    id: entry.id,
    position: entry.position,
    state: entry.state,
    enqueuedAt: entry.enqueuedAt,
    estimate: entry.estimatedTimeToMerge ?? undefined,
    jump: entry.jump,
    solo: entry.solo,
    enqueuer: entry.enqueuer.login,
    base: entry.baseCommit?.oid,
    tested: entry.headCommit?.oid,
    checks: queueChecks(entry.headCommit),
    pullRequest: pull
      ? {
          id: pull.id,
          number: pull.number,
          title: pull.title,
          url: pull.url,
          head: pull.headRefOid,
          author: pull.author?.login,
          viewerDidAuthor: pull.viewerDidAuthor,
        }
      : undefined,
  };
}

function queueFacts(queue: QueueData): QueueFacts {
  const settings = queue.configuration;
  return {
    url: queue.url,
    nextEstimate: queue.nextEntryEstimatedTimeToMerge ?? undefined,
    settings: settings
      ? {
          method: settings.mergeMethod ?? undefined,
          strategy: settings.mergingStrategy ?? undefined,
          building: settings.maximumEntriesToBuild ?? undefined,
        }
      : undefined,
    entries: given(queue.entries?.nodes)
      .map(entryFacts)
      .toSorted((a, b) => a.position - b.position),
    total: queue.entries?.totalCount ?? 0,
  };
}

/**
 * `repo`'s merge queue for `branch`, with its first 100 entries, each with the commits GitHub
 * builds and tests it on and the first 50 checks on the one it tests, and what the account may do
 * to it.
 */
export async function queueView(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
): Promise<QueueView> {
  const { data, errors } = await client.graphqlWithErrors(
    QueueViewDocument,
    { owner: repo.owner, name: repo.name, branch },
    2,
  );
  const repository = present(data.repository, errors, `repository ${repo.toString()}`);
  return {
    branch,
    viewerPermission: repository.viewerPermission ?? undefined,
    queue: repository.mergeQueue ? queueFacts(repository.mergeQueue) : undefined,
    leftOut: leftOutBy(errors, [HIDDEN_SETTINGS]),
  };
}

/**
 * Whether GitHub left part of the queue out with an error: the queue itself, so the branch may
 * have one though {@link QueueView.queue} is nothing, its entries, so the queue may hold some
 * though none were read, an entry, or an entry's commits, checks or pull request. Its settings or
 * estimate left out are only missing.
 */
export function queueLeftOut(view: QueueView): boolean {
  return view.leftOut.some((path) =>
    // A part of the queue that can't be null failing nulls the queue.
    view.queue === undefined
      ? path === 'mergeQueue' || path.startsWith('mergeQueue.')
      : path.startsWith('mergeQueue.entries'),
  );
}

/**
 * Whether the view may not be the whole queue: it holds entries past the 100 read, or GitHub left
 * part of it out with an error ({@link queueLeftOut}), which may be the queue, its entries or an
 * entry. A view cut short is never an empty queue or a branch without one.
 */
export function queueViewCutShort(view: QueueView): boolean {
  const queue = view.queue;
  return queueLeftOut(view) || (queue !== undefined && queue.total > queue.entries.length);
}

/** Why a pull request last left its merge queue, as `QueueRemoval` reads it. */
export interface QueueRemoval {
  /** `number`. */
  number: number;
  /** `state`: `OPEN`, `CLOSED` or `MERGED`. */
  state: string;
  /** `isInMergeQueue`: it's in the queue again, or still. */
  inQueue: boolean;
  /**
   * The last time it left (`RemovedFromMergeQueueEvent`), or nothing when GitHub lists none, or
   * left it out with an error ({@link leftOut} isn't empty): a part of it that can't be null
   * failing, such as `createdAt`, leaves out the whole event.
   */
  removal: QueueRemovalEvent | undefined;
  /**
   * The parts GitHub left out with an error, by their path from the repository: all within the
   * pull request's timeline, such as `pullRequest.timelineItems.nodes.0.reason`.
   */
  leftOut: string[];
}

/** A pull request leaving its merge queue: `RemovedFromMergeQueueEvent`. */
export interface QueueRemovalEvent {
  /** `createdAt`. */
  at: string;
  /** `reason`, as GitHub words it, such as `failed_checks` or `manual`. */
  reason: string | undefined;
  /** `actor.login`: who took it out, or GitHub's own account when the queue did. */
  by: string | undefined;
  /** `beforeCommit.oid`: the commit the queue tested it on. */
  tested: string | undefined;
  /**
   * The first 50 checks on {@link tested}, in GitHub's order, but those of a kind newer than Lo:
   * when checks failed, the failed one among them.
   */
  checks: CheckFacts[];
}

type TimelineData = NonNullable<
  NonNullable<
    NonNullable<
      NonNullable<QueueRemovalQuery['repository']>['pullRequest']
    >['timelineItems']['nodes']
  >[number]
>;

/** The removal a timeline item is, or nothing for any other item. */
function removalEvent(node: TimelineData): QueueRemovalEvent[] {
  const { __typename: typename } = node;
  if (typename !== 'RemovedFromMergeQueueEvent') return [];
  return [
    {
      at: node.createdAt,
      reason: node.reason ?? undefined,
      by: node.actor?.login,
      tested: node.beforeCommit?.oid,
      checks: queueChecks(node.beforeCommit),
    },
  ];
}

/** Why `pull` last left its merge queue, and whether it's merged or in the queue again. */
export async function queueRemoval(client: GithubClient, pull: PullRef): Promise<QueueRemoval> {
  const { data, errors } = await client.graphqlWithErrors(
    QueueRemovalDocument,
    { owner: pull.repo.owner, name: pull.repo.name, number: pull.number },
    2,
  );
  const repository = present(data.repository, errors, `repository ${pull.repo.toString()}`);
  // The timeline can't be null: an error on it nulls the pull request, and fails the read.
  const found = present(repository.pullRequest, errors, `pull request ${pull.toString()}`);
  const removals = given(found.timelineItems.nodes).flatMap(removalEvent);
  return {
    number: found.number,
    state: found.state,
    inQueue: found.isInMergeQueue,
    removal: removals.at(-1),
    leftOut: leftOutBy(errors, []),
  };
}

/** The open pull requests into a base branch, as `QueueWaiting` reads them. */
export interface QueueWaiting {
  /** The branch. */
  branch: string;
  /** The open pull requests into it read, the 100 updated most recently, latest first. */
  pullRequests: WaitingPullRequest[];
  /**
   * How many are open into it (`totalCount`). With more than were read, one waiting with
   * auto-merge on may be among those left out.
   */
  total: number;
  /**
   * The parts GitHub left out with an error, by their path from the repository: a pull request
   * left out is missing from {@link pullRequests}, and one whose auto-merge is reads as off.
   */
  leftOut: string[];
}

/** An open pull request into a branch with a merge queue, and its auto-merge. */
export interface WaitingPullRequest {
  /** `id`: its node ID. */
  id: string;
  /** `number`. */
  number: number;
  /** `title`. */
  title: string;
  /** `url`. */
  url: string;
  /** `headRefOid`. */
  head: string;
  /** `isInMergeQueue`. */
  inQueue: boolean;
  /** `author.login`, or nothing for a deleted account. */
  author: string | undefined;
  /** `viewerDidAuthor`. */
  viewerDidAuthor: boolean;
  /** `reviewDecision`: nothing when the branch's rules don't require reviews. */
  reviewDecision: string | undefined;
  /** `statusCheckRollup.state`: its checks together, or nothing when it has none. */
  checks: string | undefined;
  /** `autoMergeRequest`, when auto-merge is on: it joins the queue once it's ready. */
  autoMerge: WaitingAutoMerge | undefined;
}

/** Auto-merge, turned on: `autoMergeRequest`. */
export interface WaitingAutoMerge {
  /** `mergeMethod`. The queue's own method applies once it joins. */
  method: string;
  /** `enabledBy.login`. */
  enabledBy: string | undefined;
  /** `enabledAt`, when GitHub says. */
  enabledAt: string | undefined;
}

type WaitingData = NonNullable<
  NonNullable<NonNullable<QueueWaitingQuery['repository']>['pullRequests']['nodes']>[number]
>;

function waitingFacts(pull: WaitingData): WaitingPullRequest {
  const request = pull.autoMergeRequest;
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    head: pull.headRefOid,
    inQueue: pull.isInMergeQueue,
    author: pull.author?.login,
    viewerDidAuthor: pull.viewerDidAuthor,
    reviewDecision: pull.reviewDecision ?? undefined,
    checks: pull.statusCheckRollup?.state,
    autoMerge: request
      ? {
          method: request.mergeMethod,
          enabledBy: request.enabledBy?.login,
          enabledAt: request.enabledAt ?? undefined,
        }
      : undefined,
  };
}

/**
 * `repo`'s open pull requests into `branch`, the 100 updated most recently, each with its
 * auto-merge: those with it on and not yet in the queue wait to join it.
 */
export async function queueWaiting(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
): Promise<QueueWaiting> {
  const { data, errors } = await client.graphqlWithErrors(
    QueueWaitingDocument,
    { owner: repo.owner, name: repo.name, branch },
    2,
  );
  const repository = present(data.repository, errors, `repository ${repo.toString()}`);
  const { pullRequests } = repository;
  return {
    branch,
    pullRequests: given(pullRequests.nodes).map(waitingFacts),
    total: pullRequests.totalCount,
    leftOut: leftOutBy(errors, []),
  };
}

/**
 * Whether a pull request waiting to join the queue may be missing from `waiting`: the branch has
 * more open than were read, or GitHub left part of one out with an error.
 */
export function queueWaitingCutShort(waiting: QueueWaiting): boolean {
  return waiting.leftOut.length > 0 || waiting.total > waiting.pullRequests.length;
}
