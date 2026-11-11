/**
 * What decides whether a pull request can merge (`docs/design.md`, "Merge status"), as GitHub
 * reports it: {@link MergeFacts}, which `@lo/review` maps into its merge snapshot.
 *
 * - **GraphQL** (`MergeSnapshot`) gives GitHub's verdict (`mergeable`, `mergeStateStatus`,
 *   `reviewDecision`) and what explains it: the reviews, review requests, review threads and
 *   required checks, the base branch's classic protection, the merge queue, auto-merge, your
 *   pending review, and what the account may do. The checks are paged (`MergeChecks`). The other
 *   lists are read a page each and counted: a longer one means Lo may not see every reason GitHub
 *   blocks the merge.
 * - **REST** gives the active rules of the base branch's rulesets (`./rules.ts`).
 * - **A layer of a GitHub stack** merges into the stack's base, which GitHub checks each layer
 *   against, not the layer's own base (the branch of the layer below). So for a layer the classic
 *   protection, the rulesets and the merge queue are the stack base's ({@link rulesBase}), read
 *   through the stack's bottom entry, whose base is the stack's.
 *
 * Also here: a base branch's merge queue ({@link mergeQueue}), the squash commit's text GitHub
 * would start with ({@link squashText}), and the rules of a branch a pull request merges into once
 * its base moves there ({@link rulesOnto}).
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import {
  BranchProtectionDocument,
  MergeChecksDocument,
  MergeQueueDocument,
  MergeSnapshotDocument,
  MergeTextDocument,
  type MergeCheckFragment,
  type MergeQueueQuery,
  type MergeSnapshotQuery,
} from './generated/graphql.ts';
import type { GraphQLError } from './graphql.ts';
import { notFound, PAGE_SIZE, Pager } from './pager.ts';
import type { ViewerPendingReview } from './pending.ts';
import type { PullRef, RepoRef } from './refs.ts';
import {
  branchRules,
  noBranchRules,
  protectionFrom,
  type BranchRules,
  type Protection,
} from './rules.ts';

/** The most pages of checks read: 1,000 checks. A head with more has them cut short. */
export const MAX_CHECK_PAGES = 10;

/**
 * The names {@link MergeFacts.cutShort} and {@link MergeFacts.leftOut} give the lists they name:
 * the reviews, the teams a review was given for, the review requests, your pending review, the
 * review threads (which are only counted), the head's checks, and the base branch's rules (left
 * out when their answer failed in a way that may pass).
 */
export type MergeList =
  | 'reviews'
  | "reviews' teams"
  | 'review requests'
  | 'your pending review'
  | 'review threads'
  | 'checks'
  | 'rules';

/**
 * The paths, from the repository, of fields GitHub shows only to some accounts: the classic
 * protection's settings, which only admins see, and the merge queue's settings, which only writers
 * see. An OAuth token gets null for them; other tokens get a `FORBIDDEN` error, which is GitHub's
 * answer too, not a part left out.
 */
const HIDDEN_FROM_SOME: readonly string[] = [
  'pullRequest.baseRef.branchProtectionRule',
  'pullRequest.mergeQueue.configuration',
  'pullRequest.stackEntry.stack.entries.nodes.0.pullRequest.baseRef.branchProtectionRule',
  'pullRequest.stackEntry.stack.entries.nodes.0.pullRequest.mergeQueue.configuration',
];

/**
 * What decides whether a pull request can merge, as GitHub reports it to the account it was read
 * as. Field docs name the GraphQL field each comes from, `PullRequest`'s unless they say otherwise.
 * GitHub's enum values are kept as GitHub names them, so one newer than Lo survives to be read as
 * one.
 */
export interface MergeFacts {
  /** The account it was read as. */
  login: string;
  repository: RepositoryFacts;
  pullRequest: PullRequestFacts;
  /**
   * The GitHub stack the pull request is a layer of, if it's in one: its rules are the stack
   * base's ({@link rulesBase}).
   */
  stack: StackFacts | undefined;
  /** The classic branch protection rule of the branch it merges into ({@link rulesBase}), if it has one. */
  protection: Protection | undefined;
  /** The active rules of the rulesets of the branch it merges into ({@link rulesBase}). */
  rules: BranchRules;
  /**
   * The lists longer than the page read of them, by name, such as `reviews`. What explains GitHub's
   * verdict may be past the page, so Lo may not see every rule.
   */
  cutShort: MergeList[];
  /**
   * The parts GitHub left out with an error: each field an error names, by its path from the
   * repository (`pullRequest.statusCheckRollup`), each list GitHub left items out of, by name
   * (`reviews`), and `rules` when the rulesets' answer failed in a way that may pass, such as a
   * `502`. Without them a null could read as GitHub's answer, such as auto-merge reading as off,
   * so the read isn't complete ({@link mergeFactsComplete}), and it's tried again after a wait.
   */
  leftOut: string[];
}

/**
 * The GitHub stack a pull request is a layer of: `stackEntry`. GitHub merges a layer into the
 * stack's base and checks it against that branch's rules, which are read through the stack's
 * bottom entry, whose base is the stack's.
 */
export interface StackFacts {
  /** `stack.number`. */
  number: number;
  /** `position`: 1 is the bottom layer. */
  position: number;
  /** `stack.baseRefName`: the branch every layer merges into. */
  base: string;
  /**
   * Whether the stack base's classic protection and merge queue were read: its bottom entry was
   * given, based on the stack's base. Otherwise Lo may not see every rule.
   */
  baseRead: boolean;
  /** The bottom entry's `isMergeQueueEnabled`: whether the stack's base has a merge queue. */
  queueRequired: boolean;
  /**
   * The bottom entry's `mergeQueue.configuration.mergeMethod`, shown only to those who can write to
   * the repository.
   */
  queueMethod: string | undefined;
}

/** The repository's merge settings, and the account's access to it: `Repository`'s fields. */
export interface RepositoryFacts {
  /** `isArchived`. */
  archived: boolean;
  /** `viewerPermission`: `READ`, `TRIAGE`, `WRITE`, `MAINTAIN` or `ADMIN`. Nothing when GitHub doesn't say. */
  viewerPermission: string | undefined;
  /** `mergeCommitAllowed`. */
  mergeCommitAllowed: boolean;
  /** `squashMergeAllowed`. */
  squashMergeAllowed: boolean;
  /** `rebaseMergeAllowed`. */
  rebaseMergeAllowed: boolean;
  /** `viewerDefaultMergeMethod`. */
  viewerDefaultMergeMethod: string | undefined;
  /**
   * `squashMergeCommitTitle`, where a squash merge's title starts: `PR_TITLE`, or
   * `COMMIT_OR_PR_TITLE` (the commit's title when there's one commit).
   */
  squashTitle: string;
  /**
   * `squashMergeCommitMessage`, where a squash merge's message starts: `PR_BODY`,
   * `COMMIT_MESSAGES` or `BLANK`.
   */
  squashMessage: string;
}

/** The pull request, as it bears on merging it. */
export interface PullRequestFacts {
  /** `url`. */
  url: string;
  /** `state`. */
  state: string;
  /** `isDraft`. */
  draft: boolean;
  /** `locked`. */
  locked: boolean;
  /** `mergeable`. */
  mergeable: string;
  /** `mergeStateStatus`. */
  mergeState: string;
  /** `reviewDecision`. */
  reviewDecision: string | undefined;
  /** `headRefOid`. */
  head: string;
  /** `baseRefName`. */
  base: string;
  /** The base branch's tip now (`baseRef.target.oid`), or nothing once the branch is gone. */
  baseTip: string | undefined;
  /** `author.login`, or nothing for a deleted account. */
  author: string | undefined;
  /** `viewerDidAuthor`. */
  viewerDidAuthor: boolean;
  /** `viewerCanMergeAsAdmin`. */
  viewerCanMergeAsAdmin: boolean;
  /** `viewerCanEnableAutoMerge`. */
  viewerCanEnableAutoMerge: boolean;
  /** `viewerCanDisableAutoMerge`. */
  viewerCanDisableAutoMerge: boolean;
  /** `isMergeQueueEnabled`. */
  queueRequired: boolean;
  /** `isInMergeQueue`. */
  inQueue: boolean;
  /** `mergeQueueEntry.position`. */
  queuePosition: number | undefined;
  /**
   * `mergeQueue.configuration.mergeMethod`, which GitHub shows only to those who can write to the
   * repository.
   */
  queueMethod: string | undefined;
  /** `autoMergeRequest`, when auto-merge is on. */
  autoMerge: AutoMergeFacts | undefined;
  /** `latestOpinionatedReviews`, its first 50. */
  reviews: ReviewFacts[];
  /**
   * `reviewRequests`, its first 25. A request for a team the account can't see is left out: it
   * can't be named, and the account isn't in it.
   */
  reviewRequests: RequestFacts[];
  /** The teams asked to review that the account is in, child teams included, as `org/team`. */
  viewerTeams: string[];
  /** Your pending review (`reviews(states: PENDING, author: $login)`). */
  pendingReview: ViewerPendingReview | undefined;
  /** How many of the first 100 `reviewThreads` aren't resolved. */
  unresolvedThreads: number;
  /**
   * The required check runs and commit statuses on the head (`statusCheckRollup.contexts` with
   * `isRequired(pullRequestNumber:)`), in GitHub's order.
   */
  checks: CheckFacts[];
  /**
   * Whether something on the head can still report a check: a check run that hasn't completed, a
   * pending commit status, a check suite that hasn't completed and either belongs to a workflow
   * run or has started, or more check suites than the page read. GitHub makes a queued suite for
   * every app that may add checks, and one that never adds any stays queued, so a queued suite
   * counts here only for a workflow: for an app, see {@link PullRequestFacts.queuedApps}.
   */
  checksPending: boolean;
  /**
   * The apps (`app.databaseId`) of the check suites on the head that are queued and belong to no
   * workflow run. Such a suite may be an app's build waiting to start, such as a third-party CI's,
   * or one that will never run, so it counts as pending only for a required check pinned to its app
   * that hasn't reported.
   */
  queuedApps: number[];
}

/** `autoMergeRequest`. */
export interface AutoMergeFacts {
  /** `mergeMethod`. */
  method: string;
  /** `enabledBy.login`. */
  enabledBy: string | undefined;
}

/** An entry of `latestOpinionatedReviews`. */
export interface ReviewFacts {
  /** `author.login`, or nothing for a deleted account. */
  author: string | undefined;
  /** `state`. */
  state: string;
  /** `commit.oid`, or nothing once GitHub no longer has the commit. */
  commit: string | undefined;
  /** `authorCanPushToRepository`. */
  authorCanPush: boolean;
  /** `onBehalfOf`'s `combinedSlug`s, its first 10. */
  onBehalfOf: string[];
}

/** An entry of `reviewRequests` the account can see. */
export interface RequestFacts {
  /** A user's, bot's or mannequin's `login`, or a team's `combinedSlug`. */
  reviewer: string;
  /** Whether it's a team. */
  team: boolean;
  /** `asCodeOwner`. */
  asCodeOwner: boolean;
}

/** A required check run or commit status on the head. */
export type CheckFacts =
  /** A `CheckRun`: its `name`, `status`, `conclusion`, and `detailsUrl` (else `url`). */
  | {
      kind: 'checkRun';
      name: string;
      status: string;
      conclusion: string | undefined;
      url: string | undefined;
    }
  /** A `StatusContext`: its `context`, `state` and `targetUrl`. */
  | { kind: 'status'; context: string; state: string; url: string | undefined };

/**
 * The fields of a pull request whose change may move GitHub's verdict or what explains it, each a
 * JSON pointer into the cheap check (`PullRequestCheck`): its state, draft, head and base, its
 * review decision and merge state, its checks' combined state and how many are in each state (a
 * required check finishing moves the counts while a pending or failed combined state stays), its
 * queue entry, a review submitted, a thread resolved or replied to, your pending review, and
 * anything the timeline shows, such as a review requested, auto-merge turned on or a comment. The
 * base branch's rules change on a slower refresh, read again for free when they didn't.
 */
export const MERGE_FACTS_WATCHED: readonly string[] = [
  '/state',
  '/isDraft',
  '/headRefOid',
  '/baseRefName',
  '/baseRefOid',
  '/reviewDecision',
  '/mergeStateStatus',
  '/statusCheckRollup',
  '/checkCounts',
  '/mergeQueueEntry',
  '/submittedReviews/totalCount',
  '/reviewThreads',
  '/viewerPendingReview',
  '/timelineEvents/filteredCount',
];

/** Whether GitHub gave every part: one it left out with an error is read again after a wait. */
export function mergeFactsComplete(facts: MergeFacts): boolean {
  return facts.leftOut.length === 0;
}

/**
 * The branch the pull request merges into, whose rules decide it: a GitHub stack's base for a layer
 * of one, else its own base.
 */
export function rulesBase(facts: MergeFacts): string {
  return facts.stack?.base ?? facts.pullRequest.base;
}

/**
 * An error's path as {@link MergeFacts.leftOut} names it: its fields and list indexes joined by
 * dots, from the repository's fields, such as `pullRequest.statusCheckRollup.contexts.nodes.5`.
 */
export function fieldPath(path: readonly (string | number)[]): string {
  const fromRepository = path[0] === 'repository' ? path.slice(1) : path;
  return fromRepository.join('.');
}

/** Adds `name` to `names` unless it's there. */
function add<T extends string>(names: T[], name: T): void {
  if (!names.includes(name)) names.push(name);
}

/**
 * Adds the fields GitHub's `errors` name to the facts' parts left out, each by its path from the
 * repository, except a field hidden from the account.
 */
function noteErrors(facts: MergeFacts, errors: readonly GraphQLError[]): void {
  for (const error of errors) {
    const path = fieldPath(error.path);
    const hidden = error.type === 'FORBIDDEN' && HIDDEN_FROM_SOME.includes(path);
    if (!hidden) add(facts.leftOut, path);
  }
}

type RepositoryData = NonNullable<MergeSnapshotQuery['repository']>;
type PullRequestData = NonNullable<RepositoryData['pullRequest']>;

/** Lists read a page each: those longer than their page, and those GitHub left items out of. */
class Lists {
  readonly cutShort: MergeList[] = [];
  readonly leftOut: string[] = [];

  /**
   * Notes the list `name`, of which GitHub counted `total` items and gave `read`, leaving out
   * `missing` with an error.
   */
  note(name: MergeList, total: number, read: number, missing: number): void {
    if (total > read + missing) add(this.cutShort, name);
    if (missing > 0) add(this.leftOut, name);
  }

  /** Notes that GitHub left the list `name` out altogether. */
  leftOutAltogether(name: MergeList): void {
    add(this.leftOut, name);
  }
}

/** The items GitHub gave of `nodes`, and how many it left out as nulls. */
function given<T>(nodes: readonly (T | null)[] | null): { read: T[]; missing: number } {
  const all = nodes ?? [];
  const read = all.filter((node): node is T => node !== null);
  return { read, missing: all.length - read.length };
}

/** Where the next page of checks starts, and how many there are. */
interface NextChecks {
  total: number;
  cursor: string | null;
}

/** The facts in GraphQL's answer, read as `login`, and where the next page of checks starts. */
function fromData(
  repository: RepositoryData,
  pull: PullRequestData,
  login: string,
): { facts: MergeFacts; next: NextChecks | undefined } {
  const lists = new Lists();
  const { stack, stackProtection } = stackFacts(pull);
  // A layer above the stack's bottom is checked against the stack's base.
  const protection =
    stack !== undefined && stack.base !== pull.baseRefName
      ? stackProtection
      : protectionFrom(pull.baseRef);
  const { pullRequest, next } = pullRequestFacts(pull, login, lists);
  const facts: MergeFacts = {
    login,
    repository: {
      archived: repository.isArchived,
      viewerPermission: repository.viewerPermission ?? undefined,
      mergeCommitAllowed: repository.mergeCommitAllowed,
      squashMergeAllowed: repository.squashMergeAllowed,
      rebaseMergeAllowed: repository.rebaseMergeAllowed,
      viewerDefaultMergeMethod: repository.viewerDefaultMergeMethod,
      squashTitle: repository.squashMergeCommitTitle,
      squashMessage: repository.squashMergeCommitMessage,
    },
    pullRequest,
    stack,
    protection,
    rules: noBranchRules(stack?.base ?? pull.baseRefName),
    cutShort: lists.cutShort,
    leftOut: lists.leftOut,
  };
  return { facts, next };
}

/** The pull request's facts, and where the next page of its checks starts. */
function pullRequestFacts(
  pull: PullRequestData,
  login: string,
  lists: Lists,
): { pullRequest: PullRequestFacts; next: NextChecks | undefined } {
  const facts: PullRequestFacts = {
    url: pull.url,
    state: pull.state,
    draft: pull.isDraft,
    locked: pull.locked,
    mergeable: pull.mergeable,
    mergeState: pull.mergeStateStatus,
    reviewDecision: pull.reviewDecision ?? undefined,
    head: pull.headRefOid,
    base: pull.baseRefName,
    baseTip: pull.baseRef?.target?.oid,
    author: pull.author?.login,
    viewerDidAuthor: pull.viewerDidAuthor,
    viewerCanMergeAsAdmin: pull.viewerCanMergeAsAdmin,
    viewerCanEnableAutoMerge: pull.viewerCanEnableAutoMerge,
    viewerCanDisableAutoMerge: pull.viewerCanDisableAutoMerge,
    queueRequired: pull.isMergeQueueEnabled,
    inQueue: pull.isInMergeQueue,
    queuePosition: pull.mergeQueueEntry?.position,
    queueMethod: pull.mergeQueue?.configuration?.mergeMethod ?? undefined,
    autoMerge: pull.autoMergeRequest
      ? {
          method: pull.autoMergeRequest.mergeMethod,
          enabledBy: pull.autoMergeRequest.enabledBy?.login,
        }
      : undefined,
    reviews: [],
    reviewRequests: [],
    viewerTeams: [],
    pendingReview: undefined,
    unresolvedThreads: 0,
    checks: [],
    checksPending: false,
    queuedApps: [],
  };

  const reviews = pull.latestOpinionatedReviews;
  if (reviews) {
    const { read, missing } = given(reviews.nodes);
    lists.note('reviews', reviews.totalCount, read.length, missing);
    for (const review of read) {
      const teams = given(review.onBehalfOf.nodes).read.map((team) => team.combinedSlug);
      lists.note("reviews' teams", review.onBehalfOf.totalCount, teams.length, 0);
      facts.reviews.push({
        author: review.author?.login,
        state: review.state,
        commit: review.commit?.oid,
        authorCanPush: review.authorCanPushToRepository,
        onBehalfOf: teams,
      });
    }
  } else {
    lists.leftOutAltogether('reviews');
  }

  const requests = pull.reviewRequests;
  if (requests) {
    const { read, missing } = given(requests.nodes);
    lists.note('review requests', requests.totalCount, read.length, missing);
    for (const request of read) {
      const asked = requestedReviewer(request.requestedReviewer, login);
      // A team the account can't see, or an enterprise team, is left out.
      if (asked === 'hidden') continue;
      // A reviewer of a kind newer than Lo can't be named, but may be what GitHub waits for.
      if (asked === 'unknown') {
        lists.leftOutAltogether('review requests');
        continue;
      }
      if (asked.member && !facts.viewerTeams.includes(asked.reviewer)) {
        facts.viewerTeams.push(asked.reviewer);
      }
      facts.reviewRequests.push({
        reviewer: asked.reviewer,
        team: asked.team,
        asCodeOwner: request.asCodeOwner,
      });
    }
  } else {
    lists.leftOutAltogether('review requests');
  }

  const pending = pull.viewerPendingReview;
  if (pending) {
    facts.pendingReview = given(pending.nodes).read[0];
  } else {
    // Read as none, approve and ship would send an approval GitHub refuses.
    lists.leftOutAltogether('your pending review');
  }

  const threads = given(pull.reviewThreads.nodes);
  lists.note('review threads', pull.reviewThreads.totalCount, threads.read.length, threads.missing);
  facts.unresolvedThreads = threads.read.filter((thread) => !thread.isResolved).length;

  const suites = given(pull.commits.nodes).read[0]?.commit.checkSuites;
  if (suites) {
    const nodes = given(suites.nodes).read;
    // Suites past the page may still be running: wait for them, rather than block on a check one
    // of them will report.
    if (suites.totalCount > nodes.length) facts.checksPending = true;
    for (const suite of nodes) {
      if (suite.status === 'COMPLETED') continue;
      const queued = suite.status === 'QUEUED' || suite.status === 'REQUESTED';
      if (queued && suite.workflowRun === null) {
        const app = suite.app?.databaseId;
        if (app != null && !facts.queuedApps.includes(app)) facts.queuedApps.push(app);
      } else {
        facts.checksPending = true;
      }
    }
  }

  const rollup = pull.statusCheckRollup;
  if (!rollup) return { pullRequest: facts, next: undefined };
  const { contexts } = rollup;
  const running = (contexts.checkRunCountsByState ?? []).some(
    (count) =>
      count.count > 0 &&
      ['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED'].includes(count.state),
  );
  const pendingStatus = (contexts.statusContextCountsByState ?? []).some(
    (count) => count.count > 0 && count.state === 'PENDING',
  );
  if (running || pendingStatus) facts.checksPending = true;
  const nodes = given(contexts.nodes);
  if (nodes.missing > 0) lists.leftOutAltogether('checks');
  const { checks, unknown } = requiredChecks(nodes.read);
  if (unknown) lists.leftOutAltogether('checks');
  facts.checks = checks;
  const next = contexts.pageInfo.hasNextPage
    ? { total: contexts.totalCount, cursor: contexts.pageInfo.endCursor }
    : undefined;
  return { pullRequest: facts, next };
}

type RequestedReviewer = NonNullable<
  NonNullable<NonNullable<PullRequestData['reviewRequests']>['nodes']>[number]
>['requestedReviewer'];

/**
 * Who a review request asks, and for a team, whether the account with login `login` is in it:
 * `hidden` for a team the account can't see, or an enterprise team, and `unknown` for a reviewer
 * of a kind newer than Lo.
 */
function requestedReviewer(
  asked: RequestedReviewer,
  login: string,
): { reviewer: string; team: boolean; member: boolean } | 'hidden' | 'unknown' {
  if (asked === null) return 'hidden';
  const { __typename: typename } = asked;
  switch (typename) {
    case 'User':
    case 'Bot':
    case 'Mannequin':
      return { reviewer: asked.login, team: false, member: false };
    case 'Team':
      return {
        reviewer: asked.combinedSlug,
        team: true,
        // The search matches others' logins and names too, so the login is compared.
        member: given(asked.members.nodes).read.some((user) => sameAsciiCase(user.login, login)),
      };
    case 'EnterpriseTeam':
      return 'hidden';
    default:
      typename satisfies never;
      return 'unknown';
  }
}

/**
 * A required check run or commit status, or none for one that isn't required. Nothing at all for a
 * check of a kind newer than Lo, which may be a required one.
 */
function requiredCheck(node: MergeCheckFragment): CheckFacts[] | undefined {
  const { __typename: typename } = node;
  switch (typename) {
    case 'CheckRun':
      if (!node.isRequired) return [];
      return [
        {
          kind: 'checkRun',
          name: node.name,
          status: node.status,
          conclusion: node.conclusion ?? undefined,
          url: node.detailsUrl ?? node.url,
        },
      ];
    case 'StatusContext':
      if (!node.isRequired) return [];
      return [
        {
          kind: 'status',
          context: node.context,
          state: node.state,
          url: node.targetUrl ?? undefined,
        },
      ];
    default:
      typename satisfies never;
      return undefined;
  }
}

/**
 * The required checks among `nodes`, and whether one was of a kind newer than Lo: GitHub may
 * require it, so it's a check left out.
 */
function requiredChecks(nodes: readonly MergeCheckFragment[]): {
  checks: CheckFacts[];
  unknown: boolean;
} {
  const read = nodes.map(requiredCheck);
  return {
    checks: read.flatMap((checks) => checks ?? []),
    unknown: read.includes(undefined),
  };
}

/**
 * The GitHub stack the pull request is a layer of, and its base's classic protection, read through
 * its bottom entry when that's based on the stack's base.
 */
function stackFacts(pull: PullRequestData): {
  stack: StackFacts | undefined;
  stackProtection: Protection | undefined;
} {
  const stack = pull.stackEntry?.stack;
  if (!pull.stackEntry || !stack) return { stack: undefined, stackProtection: undefined };
  const first = given(stack.entries.nodes).read.find((node) => node.pullRequest !== null);
  const bottom =
    first?.pullRequest && first.pullRequest.baseRefName === stack.baseRefName
      ? first.pullRequest
      : undefined;
  return {
    stack: {
      number: stack.number,
      position: pull.stackEntry.position,
      base: stack.baseRefName,
      baseRead: bottom !== undefined,
      queueRequired: bottom?.isMergeQueueEnabled ?? false,
      queueMethod: bottom?.mergeQueue?.configuration?.mergeMethod ?? undefined,
    },
    stackProtection: bottom ? protectionFrom(bottom.baseRef) : undefined,
  };
}

/**
 * `field`, which GitHub's answer must have: when it's null, the errors that explain it fail the
 * read, or else it's not found.
 */
function present<T>(field: T | null | undefined, errors: readonly GraphQLError[], what: string): T {
  if (field != null) return field;
  if (errors.length === 0) throw notFound(what);
  throw GithubError.fromGraphQL([...errors], new Headers());
}

/**
 * Whether the rules' answer failed in a way that may pass by itself: a server error, or an answer
 * Lo couldn't read. A `403`, a `404` or single sign-on won't.
 */
function mayPass(error: GithubError): boolean {
  const { detail } = error;
  return (detail.kind === 'api' && detail.status >= 500) || detail.kind === 'decode';
}

/**
 * What decides whether `pull` can merge, read as the account whose login is `login`, with its base
 * branch's rules. `known`, read before, gives the rules' ETag, so unchanged rules are free.
 *
 * - A field GitHub leaves out with an error is noted in {@link MergeFacts.leftOut}, and the read
 *   isn't complete.
 * - Rules that can't be read for any reason but the network, the rate limit or the token are noted
 *   as unavailable rather than failing the read. When the reason may pass, a server error or an
 *   answer Lo can't read, they're left out too.
 * - The head moving while its checks are paged fails the read: it's read again.
 */
export async function readMergeFacts(
  client: GithubClient,
  pull: PullRef,
  login: string,
  known?: MergeFacts,
): Promise<MergeFacts> {
  const { owner, name } = pull.repo;
  const { data, errors } = await client.graphqlWithErrors(
    MergeSnapshotDocument,
    { owner, name, number: pull.number, login },
    2,
  );
  const repository = present(data.repository, errors, `repository ${pull.repo.toString()}`);
  const pullRequest = present(repository.pullRequest, errors, `pull request ${pull.toString()}`);
  const { facts, next } = fromData(repository, pullRequest, login);
  noteErrors(facts, errors);
  if (next !== undefined) await readOtherChecks(client, pull, facts, next);
  const branch = rulesBase(facts);
  try {
    facts.rules = await branchRules(client, pull.repo, branch, known?.rules);
  } catch (error) {
    if (!(error instanceof GithubError) || error.stopsTheRead()) throw error;
    if (mayPass(error)) add(facts.leftOut, 'rules');
    facts.rules = { ...noBranchRules(branch), unavailable: error.message };
  }
  return facts;
}

/** Reads the checks past the first page, while there are more. */
async function readOtherChecks(
  client: GithubClient,
  pull: PullRef,
  facts: MergeFacts,
  next: NextChecks,
): Promise<void> {
  const { owner, name } = pull.repo;
  const pager = new Pager('checks', next.total, PAGE_SIZE);
  let after = pager.next(true, next.cursor);
  let pages = 1;
  while (after !== undefined) {
    if (pages === MAX_CHECK_PAGES) {
      add(facts.cutShort, 'checks');
      return;
    }
    const { data, errors } = await client.graphqlWithErrors(
      MergeChecksDocument,
      { owner, name, number: pull.number, after },
      2,
    );
    const repository = present(data.repository, errors, `repository ${pull.repo.toString()}`);
    const pullRequest = present(repository.pullRequest, errors, `pull request ${pull.toString()}`);
    if (pullRequest.headRefOid !== facts.pullRequest.head) {
      throw new GithubError({
        kind: 'inconsistent',
        message: `${pull.toString()}'s head moved while its checks were read`,
      });
    }
    noteErrors(facts, errors);
    const rollup = pullRequest.statusCheckRollup;
    if (!rollup) {
      if (errors.length > 0) return;
      throw new GithubError({
        kind: 'inconsistent',
        message: `${pull.toString()}'s checks were gone from a later page`,
      });
    }
    const { contexts } = rollup;
    const nodes = given(contexts.nodes);
    if (nodes.missing > 0) add(facts.leftOut, 'checks');
    const { checks, unknown } = requiredChecks(nodes.read);
    if (unknown) add(facts.leftOut, 'checks');
    facts.pullRequest.checks.push(...checks);
    pages += 1;
    after = pager.next(contexts.pageInfo.hasNextPage, contexts.pageInfo.endCursor);
  }
}

/** Whether two logins name the same account: GitHub ignores their (ASCII) case. */
function sameAsciiCase(a: string, b: string): boolean {
  return asciiLower(a) === asciiLower(b);
}

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * The rules of a branch a pull request isn't based on yet, which decide its merge once it is: its
 * classic protection, its rulesets' rules and its merge queue.
 */
export interface OntoRules {
  /** The branch. */
  branch: string;
  /** Its classic protection, as much of it as the account sees, if it has one. */
  protection: Protection | undefined;
  /** Its rulesets' active rules. */
  rules: BranchRules;
  /** Whether it has a merge queue (`mergeQueue`). */
  queueRequired: boolean;
  /** The queue's merge method, for an account that can write to the repository. */
  queueMethod: string | undefined;
}

/**
 * `facts`, for a merge into `onto.branch` once the pull request's base moves there: that branch's
 * classic protection, rulesets and merge queue decide the methods and whether it goes through a
 * queue. GitHub's verdict, the reviews and the checks are still those read for the base it has now;
 * GitHub checks them against the new base as it merges.
 */
export function factsOnto(facts: MergeFacts, onto: OntoRules): MergeFacts {
  const moved = structuredClone(facts);
  moved.pullRequest.base = onto.branch;
  moved.pullRequest.queueRequired = onto.queueRequired;
  moved.pullRequest.queueMethod = onto.queueMethod;
  moved.stack = undefined;
  moved.protection = structuredClone(onto.protection);
  moved.rules = structuredClone(onto.rules);
  return moved;
}

/**
 * The fields of `BranchProtection` GitHub shows only to some accounts, by their path from the
 * repository: the classic protection's settings, which only admins see, and the merge queue's,
 * which only writers see. GitHub's `FORBIDDEN` for them is its answer, not a part left out.
 */
const HIDDEN_ONTO: readonly string[] = ['ref.branchProtectionRule', 'mergeQueue.configuration'];

/**
 * The rules of `repo`'s `branch`, for a pull request whose base moves there before it merges: a
 * chain's root branch, which its bottom layer moves onto before it merges. Fails when GitHub
 * leaves part of them out, or the rulesets can't be read: a merge isn't planned on rules Lo
 * didn't read.
 */
export async function rulesOnto(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
): Promise<OntoRules> {
  const { data, errors } = await client.graphqlWithErrors(
    BranchProtectionDocument,
    { owner: repo.owner, name: repo.name, qualified: `refs/heads/${branch}`, branch },
    1,
  );
  const leftOut = errors.filter(
    (error) => !(error.type === 'FORBIDDEN' && HIDDEN_ONTO.includes(fieldPath(error.path))),
  );
  if (leftOut.length > 0) throw GithubError.fromGraphQL(leftOut, new Headers());
  const repository = present(data.repository, [], `repository ${repo.toString()}`);
  const found = present(repository.ref, [], `branch ${branch} in ${repo.toString()}`);
  return {
    branch,
    protection: protectionFrom(found),
    rules: await branchRules(client, repo, branch),
    queueRequired: repository.mergeQueue !== null,
    queueMethod: repository.mergeQueue?.configuration?.mergeMethod ?? undefined,
  };
}

/** A queue as `MergeQueue` reads it. */
export type MergeQueueData = NonNullable<NonNullable<MergeQueueQuery['repository']>['mergeQueue']>;

/** An entry as `MergeQueue` reads it. */
export type MergeQueueEntry = NonNullable<
  NonNullable<NonNullable<MergeQueueData['entries']>['nodes']>[number]
>;

/** A base branch's merge queue (`docs/design.md`, "The merge queue"). */
export interface MergeQueueList {
  /** The branch. */
  branch: string;
  /**
   * Its queue, or nothing when it has none. Its `configuration` is null for anyone who can't write
   * to the repository: the branch's `merge_queue` rule says the same.
   */
  queue: MergeQueueData | undefined;
}

/**
 * The queue's entries, in its order: the first merges next. A queue longer than the 100 read has
 * the rest left out ({@link queueCutShort}).
 */
export function queueEntries(list: MergeQueueList): MergeQueueEntry[] {
  return given(list.queue?.entries?.nodes ?? null).read.toSorted((a, b) => a.position - b.position);
}

/** Whether the queue holds more entries than were read, or GitHub left some out. */
export function queueCutShort(list: MergeQueueList): boolean {
  const entries = list.queue?.entries;
  if (!entries) return false;
  return entries.totalCount > given(entries.nodes).read.length;
}

/** `repo`'s merge queue for `branch`, with its first 100 entries. */
export async function mergeQueue(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
): Promise<MergeQueueList> {
  const { data } = await client.graphqlWithErrors(
    MergeQueueDocument,
    { owner: repo.owner, name: repo.name, branch },
    2,
  );
  const repository = present(data.repository, [], `repository ${repo.toString()}`);
  return { branch, queue: repository.mergeQueue ?? undefined };
}

/**
 * A squash commit's title and message as GitHub would start them, for the account that read them,
 * at the pull request's head then (`docs/design.md`, "Merging").
 */
export interface SquashText {
  /**
   * `viewerMergeHeadlineText(mergeType: SQUASH)`: the repository's squash title setting applied,
   * with GitHub's ` (#<number>)` after it.
   */
  title: string;
  /** `viewerMergeBodyText(mergeType: SQUASH)`: the repository's squash message setting applied. */
  message: string;
}

/** The squash commit's title and message GitHub would start `pull`'s merge with. */
export async function squashText(client: GithubClient, pull: PullRef): Promise<SquashText> {
  const data = await client.graphql(MergeTextDocument, {
    owner: pull.repo.owner,
    name: pull.repo.name,
    number: pull.number,
  });
  const found = data.repository?.pullRequest;
  if (!found) throw notFound(`pull request ${pull.toString()}`);
  return { title: found.squashTitle, message: found.squashMessage };
}
