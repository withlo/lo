/**
 * A pull request's push history (`docs/design.md`, "Revisions"): what GitHub says about the pushes
 * to its head branch, and about where its base branch was over time. `@lo/review` builds the pull
 * request's revisions from it, and finds each one's base.
 *
 * It's read from GraphQL's `PullRequestRevisions` query, and from the activity API for the head
 * branch, in the head's repository, which can be a fork, and for each branch the pull request
 * targeted. When GraphQL has lost the head of a force-push, the REST issue timeline names it.
 */

import {
  activityEntries,
  branchActivity,
  failedActivity,
  isDeletion,
  noActivity,
  unavailableActivity,
  type ActivityEntry,
  type BranchActivity,
} from './activity.ts';
import type { GithubClient, RestResponse } from './client.ts';
import { GithubError } from './errors.ts';
import { nextLink } from './files.ts';
import {
  PullRequestRevisionsDocument,
  type PullRequestRevisionsQuery,
} from './generated/graphql.ts';
import { unchecked } from './json.ts';
import { notFound, PAGE_SIZE, Pager } from './pager.ts';
import { RepoRef, type PullRef } from './refs.ts';

/**
 * The most pages of the head branch's pushes read, newest first back to the one the pull request
 * opened with: a thousand pushes.
 */
export const MAX_HEAD_PAGES = 10;

/**
 * The most pages of a base branch's pushes read, newest first back to the pull request's first
 * revision. A busy base branch's older pushes are left out; a base that only moved forward doesn't
 * need them.
 */
export const MAX_BASE_PAGES = 3;

/** The most pages of the issue timeline read for the heads of force-pushes GitHub lost. */
const MAX_LOST_HEAD_PAGES = 10;

/**
 * The fields of the cheap check (`PullRequestCheck`) whose change means the push history may have:
 * a push changes the head, a retarget the base, a merge or close the state, and a submitted review
 * the count of submitted reviews; force-pushes and retargets are among the revision events. A
 * comment, which moves the timeline, changes none of them. Each is a JSON pointer into the check.
 */
export const PUSH_HISTORY_WATCHED: readonly string[] = [
  '/headRefOid',
  '/baseRefName',
  '/state',
  '/submittedReviews/totalCount',
  '/revisionEvents/filteredCount',
];

/** What GitHub says about a pull request's pushes. Times are GitHub's, such as `2026-11-06T19:27:51Z`. */
export interface PushHistory {
  /** When the pull request opened (`createdAt`). */
  openedAt: string;
  /** When it was closed or merged, while it is (`closedAt`). */
  closedAt: string | undefined;
  /** Its head now (`headRefOid`). */
  head: string;
  headBranch: string;
  /** The repository holding the head branch, or nothing once a fork is deleted. */
  headRepo: HeadRepo | undefined;
  /** The branch it targets now (`baseRefName`). */
  baseBranch: string;
  merged: boolean;
  /** The commit that merged it, with its parents: two for a merge commit. */
  mergeCommit: MergeCommit | undefined;
  /**
   * The head branch's pushes, newest first back to the one the pull request opened with, its first
   * revision. Older pushes, to the branch before the pull request, aren't read. Past
   * {@link MAX_HEAD_PAGES} it's `truncated`, holding the latest pushes only.
   */
  headActivity: BranchActivity;
  /**
   * The pushes of each branch it targeted, newest first back to its first revision: today's base
   * branch first, then those it targeted before, latest first.
   */
  baseActivity: BranchActivity[];
  /** `HeadRefForcePushedEvent`s. */
  headForcePushes: ForcePushEvent[];
  /** `BaseRefForcePushedEvent`s: force-pushes of the branch it targeted at the time. */
  baseForcePushes: ForcePushEvent[];
  /** `BaseRefChangedEvent`s and `AutomaticBaseChangeSucceededEvent`s. */
  retargets: RetargetEvent[];
  /** Submitted reviews: approvals, change requests, comments and dismissed reviews. */
  reviews: SubmittedReview[];
  /** The signed-in user's last submitted review. */
  viewerLastReview: SubmittedReview | undefined;
  /** The pushes that started check suites on the latest 100 commits. */
  checkSuites: CheckSuitePush[];
  /** Heads of force-pushes GitHub no longer has, named by the issue timeline. */
  lostHeads: string[];
  /** The issue timeline's force-pushes, read only when GraphQL's events lost a head. */
  lostHeadTimeline: TimelineForcePushes | undefined;
}

/** The REST issue timeline's force-pushes of the head branch, page by page with ETags. */
export interface TimelineForcePushes {
  pages: TimelinePage[];
  /**
   * Why the latest read failed, for a reason that may pass. The pages from the one that failed on
   * are an earlier read's, if there was one.
   */
  failed: string | undefined;
}

/** One page of the issue timeline. */
export interface TimelinePage {
  /** The URL it was read from. */
  url: string;
  etag: string | undefined;
  /** The next page's URL, from the `Link` header, which a `304` leaves out. */
  next: string | undefined;
  /** How many events of every kind it holds, which says whether it was full. */
  events: number;
  /** Its `head_ref_force_pushed` events. */
  forcePushes: NamedForcePush[];
}

/** A force-push of the head, as the issue timeline names it. */
export interface NamedForcePush {
  at: string;
  /** Its head (`commit_id`), named even when GitHub no longer has it. */
  commit: string;
}

/** A repository holding a head branch. */
export interface HeadRepo {
  owner: string;
  name: string;
}

/** The commit that merged a pull request. */
export interface MergeCommit {
  oid: string;
  /** Its first two parents: the base branch's tip before the merge first. */
  parents: string[];
}

/** A force-push from the timeline. Its commits are missing once GitHub no longer has them. */
export interface ForcePushEvent {
  /** A few seconds after the push. */
  at: string;
  before: string | undefined;
  after: string | undefined;
}

/** A change of the base branch. */
export interface RetargetEvent {
  at: string;
  from: string;
  to: string;
  /** Whether GitHub did it, when the branch it targeted was merged and deleted. */
  automatic: boolean;
}

/** A submitted review. */
export interface SubmittedReview {
  at: string;
  /** The commit it was on, unless GitHub no longer has it. */
  commit: string | undefined;
  /**
   * Its author's login, unless GitHub no longer has the account. Not read for the signed-in user's
   * own last review.
   */
  author: string | undefined;
}

/** The push that started a check suite on one of the pull request's commits. */
export interface CheckSuitePush {
  /** The commit the suite ran on. */
  commit: string;
  /** When the suite was made, up to a minute after the push. */
  at: string;
  /** The branch it ran for, or nothing once that branch is deleted. */
  branch: string | undefined;
  /** The push's `previousSha` and `nextSha`. */
  previous: string | undefined;
  next: string | undefined;
}

/** What `PullRequestRevisions` reads of a pull request. */
export type PullRequestRevisions = NonNullable<
  NonNullable<PullRequestRevisionsQuery['repository']>['pullRequest']
>;

/**
 * What a pull request's revisions come from in GraphQL, with every force-push and retarget event
 * and every submitted review. `login` is the signed-in user's, whose last review is one of the
 * markers revisions open from.
 */
export function pullRequestRevisions(
  client: GithubClient,
  owner: string,
  name: string,
  number: number,
  login: string,
): Promise<PullRequestRevisions> {
  return pullRequestRevisionsPaged(client, owner, name, number, login, PAGE_SIZE);
}

/**
 * {@link pullRequestRevisions}, reading `pageSize` events and reviews a page. While one of the two
 * has pages left, the other is asked for after its last cursor, and what comes back for it is
 * ignored.
 */
export async function pullRequestRevisionsPaged(
  client: GithubClient,
  owner: string,
  name: string,
  number: number,
  login: string,
  pageSize: number,
): Promise<PullRequestRevisions> {
  const fetch = async (
    timelineAfter: string | null,
    reviewsAfter: string | null,
  ): Promise<PullRequestRevisions> => {
    // `repository.pullRequest` is what was asked for; errors below it only leave out what
    // they're about.
    const { data } = await client.graphqlWithErrors(
      PullRequestRevisionsDocument,
      { owner, name, number, login, first: pageSize, timelineAfter, reviewsAfter },
      2,
    );
    const found = data.repository?.pullRequest;
    if (!found) throw notFound(`pull request ${owner}/${name}#${number}`);
    return found;
  };
  const pull = await fetch(null, null);
  let timeline = pull.timelineItems;
  const events = [...(timeline.nodes ?? [])];
  const timelinePager = new Pager('timeline events', timeline.filteredCount, pageSize);
  let timelineAfter = timelinePager.next(
    timeline.pageInfo.hasNextPage,
    timeline.pageInfo.endCursor,
  );
  let reviews = pull.reviews;
  const submitted = [...(reviews?.nodes ?? [])];
  const reviewsPager = new Pager('reviews', reviews?.totalCount ?? 0, pageSize);
  let reviewsAfter = reviews
    ? reviewsPager.next(reviews.pageInfo.hasNextPage, reviews.pageInfo.endCursor)
    : undefined;
  while (timelineAfter !== undefined || reviewsAfter !== undefined) {
    const page = await fetch(
      timelineAfter ?? timeline.pageInfo.endCursor,
      reviewsAfter ?? reviews?.pageInfo.endCursor ?? null,
    );
    if (timelineAfter !== undefined) {
      timeline = page.timelineItems;
      events.push(...(timeline.nodes ?? []));
      timelineAfter = timelinePager.next(
        timeline.pageInfo.hasNextPage,
        timeline.pageInfo.endCursor,
      );
    }
    if (reviewsAfter !== undefined) {
      if (!page.reviews) {
        throw new GithubError({ kind: 'decode', message: 'a page of reviews went missing' });
      }
      reviews = page.reviews;
      submitted.push(...(reviews.nodes ?? []));
      reviewsAfter = reviewsPager.next(reviews.pageInfo.hasNextPage, reviews.pageInfo.endCursor);
    }
  }
  return {
    ...pull,
    timelineItems: { ...pull.timelineItems, nodes: events, pageInfo: timeline.pageInfo },
    reviews: pull.reviews && {
      ...pull.reviews,
      nodes: submitted,
      pageInfo: (reviews ?? pull.reviews).pageInfo,
    },
  };
}

/** One of the timeline events `PullRequestRevisions` reads. */
type RevisionEvent = NonNullable<
  NonNullable<PullRequestRevisions['timelineItems']['nodes']>[number]
>;

/** Whether `event` is a `type`. */
function isEvent<T extends RevisionEvent['__typename']>(
  event: RevisionEvent,
  type: T,
): event is Extract<RevisionEvent, { __typename: T }> {
  const { __typename: typename } = event;
  return typename === type;
}

/** The pull request's push history as GraphQL tells it, without the activity API's. */
function fromGraphql(data: PullRequestRevisions): PushHistory {
  const history: PushHistory = {
    openedAt: data.createdAt,
    closedAt: data.closed ? (data.closedAt ?? undefined) : undefined,
    head: data.headRefOid,
    headBranch: data.headRefName,
    headRepo: data.headRepository
      ? { owner: data.headRepository.owner.login, name: data.headRepository.name }
      : undefined,
    baseBranch: data.baseRefName,
    merged: data.merged,
    mergeCommit: data.mergeCommit
      ? {
          oid: data.mergeCommit.oid,
          parents: (data.mergeCommit.parents.nodes ?? []).flatMap((parent) =>
            parent ? [parent.oid] : [],
          ),
        }
      : undefined,
    headActivity: noActivity(data.headRefName, 'desc'),
    baseActivity: [],
    headForcePushes: [],
    baseForcePushes: [],
    retargets: [],
    // A pending review has no time, and isn't submitted.
    reviews: (data.reviews?.nodes ?? []).flatMap((review) =>
      review?.submittedAt
        ? [
            {
              at: review.submittedAt,
              commit: review.commit?.oid,
              author: review.author?.login,
            },
          ]
        : [],
    ),
    viewerLastReview: (data.viewerLastReview?.nodes ?? [])
      .flatMap((review) =>
        review?.submittedAt
          ? [{ at: review.submittedAt, commit: review.commit?.oid, author: undefined }]
          : [],
      )
      .at(-1),
    checkSuites: [],
    lostHeads: [],
    lostHeadTimeline: undefined,
  };
  for (const event of data.timelineItems.nodes ?? []) {
    if (!event) continue;
    if (isEvent(event, 'HeadRefForcePushedEvent')) {
      history.headForcePushes.push({
        at: event.createdAt,
        before: event.beforeCommit?.oid,
        after: event.afterCommit?.oid,
      });
    } else if (isEvent(event, 'BaseRefForcePushedEvent')) {
      history.baseForcePushes.push({
        at: event.createdAt,
        before: event.beforeCommit?.oid,
        after: event.afterCommit?.oid,
      });
    } else if (isEvent(event, 'BaseRefChangedEvent')) {
      history.retargets.push({
        at: event.createdAt,
        from: event.previousRefName,
        to: event.currentRefName,
        automatic: false,
      });
    } else if (isEvent(event, 'AutomaticBaseChangeSucceededEvent')) {
      history.retargets.push({
        at: event.createdAt,
        from: event.oldBase,
        to: event.newBase,
        automatic: true,
      });
    }
  }
  for (const node of data.commits.nodes ?? []) {
    if (!node) continue;
    const { commit } = node;
    for (const suite of commit.checkSuites?.nodes ?? []) {
      if (!suite) continue;
      history.checkSuites.push({
        commit: commit.oid,
        at: suite.createdAt,
        branch: suite.branch?.name,
        previous: suite.push?.previousSha ?? undefined,
        next: suite.push?.nextSha ?? undefined,
      });
    }
  }
  return history;
}

/** The commit of the signed-in user's last review: the "your last review" marker. */
export function lastReview(history: PushHistory): string | undefined {
  return history.viewerLastReview?.commit;
}

/**
 * The heads GitHub no longer has, which its force-push events name only through the issue
 * timeline. The revisions show them as no longer available. The local copy can still have one it
 * fetched before, so a caller marks only those it lacks too.
 */
export function unavailableHeads(history: PushHistory): readonly string[] {
  return history.lostHeads;
}

/**
 * Whether every branch's pushes were read, or GitHub has none to show. When one wasn't, the rest
 * is still worth keeping and showing, and the whole is read again after a wait.
 */
export function pushHistoryIsComplete(history: PushHistory): boolean {
  return (
    [history.headActivity, ...history.baseActivity].every(
      (activity) => activity.failed === undefined,
    ) && history.lostHeadTimeline?.failed === undefined
  );
}

/**
 * `pull`'s push history, read as `login`. Each page of pushes `known` holds is asked about with its
 * ETag, so an unchanged one is free. A head repository that's gone, such as a deleted fork, or one
 * the account can't read, leaves the head branch with no pushes and `unavailable` saying why, and
 * so does a base branch the account can't read.
 *
 * Only the network, the rate limit and the token fail the whole read. Any other error reading a
 * branch's pushes, or the issue timeline, keeps what `known` had for it and flags it `failed`
 * ({@link pushHistoryIsComplete}).
 */
export async function readPushHistory(
  client: GithubClient,
  pull: PullRef,
  login: string,
  known?: PushHistory,
): Promise<PushHistory> {
  const { owner, name } = pull.repo;
  const history = fromGraphql(await pullRequestRevisions(client, owner, name, pull.number, login));
  if (history.headForcePushes.some((push) => push.after === undefined)) {
    const timeline = await timelineForcePushes(client, pull, known?.lostHeadTimeline);
    nameLostHeads(history, timeline);
    history.lostHeadTimeline = timeline;
  }
  // Newest first, back to the push the pull request opened with: a long-lived branch, or one a bot
  // reuses for every release, can have far more pushes from before.
  const opened = Date.parse(history.openedAt);
  history.headActivity = history.headRepo
    ? await readBranch(
        client,
        new RepoRef(history.headRepo.owner, history.headRepo.name),
        history.headBranch,
        known?.headActivity,
        MAX_HEAD_PAGES,
        (entry) => Date.parse(entry.timestamp) <= opened,
      )
    : unavailableActivity(
        history.headBranch,
        'desc',
        "GitHub shows no repository for its head branch: it was deleted, or the account can't see it",
      );
  const since = sinceFirstRevision(history);
  for (const branch of baseBranches(history)) {
    const knownBase = known?.baseActivity.find((activity) => activity.branch === branch);
    history.baseActivity.push(
      await readBranch(
        client,
        pull.repo,
        branch,
        knownBase,
        MAX_BASE_PAGES,
        (entry) => Date.parse(entry.timestamp) <= since,
      ),
    );
  }
  return history;
}

/**
 * Names the heads of force-pushes GitHub lost from the issue timeline's force-pushes, by time. A
 * timeline force-push whose head another event already names is left out first, so two in the same
 * second can't give a lost one the head of one GitHub kept; the rest pair up in order.
 */
function nameLostHeads(history: PushHistory, timeline: TimelineForcePushes): void {
  const named = new Set(history.headForcePushes.flatMap((push) => push.after ?? []));
  const candidates = timeline.pages
    .flatMap((page) => page.forcePushes)
    .filter((push) => !named.has(push.commit));
  history.lostHeads = [];
  history.headForcePushes = history.headForcePushes.map((push) => {
    if (push.after !== undefined) return push;
    const at = Date.parse(push.at);
    const index = candidates.findIndex((candidate) => Date.parse(candidate.at) === at);
    const [found] = index < 0 ? [] : candidates.splice(index, 1);
    if (found === undefined) return push;
    history.lostHeads.push(found.commit);
    return { ...push, after: found.commit };
  });
}

/**
 * The earliest time a base branch's pushes are needed from: when the head the pull request opened
 * with was pushed, its first revision.
 */
function sinceFirstRevision(history: PushHistory): number {
  const opened = Date.parse(history.openedAt);
  const pushed = activityEntries(history.headActivity)
    .filter((entry) => !isDeletion(entry))
    .map((entry) => Date.parse(entry.timestamp))
    .filter((at) => at <= opened);
  return pushed.length === 0 ? opened : Math.max(...pushed);
}

/** Every branch the pull request targeted: today's first, then the earlier ones, latest first. */
function baseBranches(history: PushHistory): string[] {
  const retargets = history.retargets.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const branches = [history.baseBranch];
  for (const retarget of retargets) {
    if (!branches.includes(retarget.from)) branches.push(retarget.from);
  }
  return branches;
}

/**
 * `branch`'s pushes, newest first. An error that isn't the network's, the rate limit's or the
 * token's fails only this branch's read: it keeps what `known` read before, flagged `failed`.
 */
async function readBranch(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
  known: BranchActivity | undefined,
  maxPages: number,
  enough: (entry: ActivityEntry) => boolean,
): Promise<BranchActivity> {
  try {
    return await branchActivity(client, repo, branch, {
      direction: 'desc',
      known,
      maxPages,
      enough,
    });
  } catch (error) {
    if (!(error instanceof GithubError) || error.stopsTheRead()) throw error;
    return failedActivity(known, branch, 'desc', error.message);
  }
}

/** The REST path of the first page of `pull`'s issue timeline. */
function timelinePath(pull: PullRef): string {
  const path = ['repos', pull.repo.owner, pull.repo.name, 'issues', String(pull.number), 'timeline']
    .map(encodeURIComponent)
    .join('/');
  return `/${path}?per_page=${PAGE_SIZE}`;
}

/**
 * The force-pushes of `pull`'s head in the REST issue timeline, whose `head_ref_force_pushed`
 * events keep `commit_id` when GraphQL's `afterCommit` is null. Each page `known` has is asked
 * about with its ETag. Only the network, the rate limit and the token fail the read; anything else,
 * a page that isn't a list of events included, keeps the pages read and what `known` had for the
 * rest, and flags the read `failed`.
 */
async function timelineForcePushes(
  client: GithubClient,
  pull: PullRef,
  known: TimelineForcePushes | undefined,
): Promise<TimelineForcePushes> {
  const knownPages = known?.pages ?? [];
  const read: TimelineForcePushes = { pages: [], failed: undefined };
  let url: string | undefined = timelinePath(pull);
  while (url !== undefined && read.pages.length < MAX_LOST_HEAD_PAGES) {
    const index = read.pages.length;
    const current: string = url;
    const atIndex = knownPages[index];
    const knownPage = atIndex?.url === current ? atIndex : undefined;
    // A 304 leaves out the Link header, so a full last page is asked for in full.
    const refetchInFull =
      knownPage !== undefined && knownPage.next === undefined && knownPage.events >= PAGE_SIZE;
    const etag = refetchInFull ? undefined : knownPage?.etag;
    let page: TimelinePage | string;
    try {
      const response = await client.send('GET', current, {
        condition: etag === undefined ? undefined : { ifNoneMatch: etag },
      });
      page =
        response.status === 304
          ? (knownPage ?? `GitHub said ${current} hadn't changed, but Lo never read it`)
          : timelinePage(response, current);
    } catch (error) {
      if (!(error instanceof GithubError) || error.stopsTheRead()) throw error;
      page = error.message;
    }
    if (typeof page === 'string') {
      read.pages.push(...knownPages.slice(index));
      read.failed = page;
      break;
    }
    url = page.next;
    read.pages.push(page);
  }
  return read;
}

/** What Lo reads of an issue timeline event. */
interface IssueEvent {
  event?: unknown;
  created_at?: unknown;
  commit_id?: unknown;
}

/** A page of the issue timeline from GitHub's answer, or why it isn't one. */
function timelinePage(response: RestResponse, url: string): TimelinePage | string {
  let events: unknown;
  try {
    events = JSON.parse(response.text());
  } catch (error) {
    return `couldn't read GitHub's answer: ${String(error)}`;
  }
  if (!Array.isArray(events)) return 'the issue timeline answered without a list of events';
  const forcePushes = events.flatMap((value: unknown): NamedForcePush[] => {
    if (typeof value !== 'object' || value === null) return [];
    const event = unchecked<IssueEvent>(value);
    const { created_at: at, commit_id: commit } = event;
    if (event.event !== 'head_ref_force_pushed') return [];
    if (typeof at !== 'string' || typeof commit !== 'string' || Number.isNaN(Date.parse(at))) {
      return [];
    }
    return [{ at, commit }];
  });
  const link = response.header('link');
  return {
    url,
    etag: response.etag,
    next: link === undefined ? undefined : nextLink(link),
    events: events.length,
    forcePushes,
  };
}
