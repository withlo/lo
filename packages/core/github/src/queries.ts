/**
 * Reading and writing with the GraphQL queries in `graphql/`: the signed-in user, a pull request
 * with every one of its files, the cheap check for whether it changed, a repository's open pull
 * requests, and viewed marks.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import {
  MarkFileAsViewedDocument,
  OpenPullRequestsDocument,
  PullRequestCheckDocument,
  PullRequestDocument,
  UnmarkFileAsViewedDocument,
  ViewerDocument,
  type OpenPullRequestsQuery,
  type PullRequestCheckQuery,
  type PullRequestQuery,
  type ViewerQuery,
} from './generated/graphql.ts';
import type { BranchLookup, MergedPullRequest } from './merged.ts';
import { notFound, PAGE_SIZE, Pager } from './pager.ts';
import type { RepoRef } from './refs.ts';

/** The signed-in user, as GraphQL has them. */
export type Viewer = ViewerQuery['viewer'];

/** A pull request with its files and the viewer's viewed marks. */
export type PullRequest = NonNullable<NonNullable<PullRequestQuery['repository']>['pullRequest']>;

/** One of a pull request's files, with the viewer's viewed mark. */
export type PullRequestFile = NonNullable<
  NonNullable<NonNullable<PullRequest['files']>['nodes']>[number]
>;

/** What the cheap check reads of a pull request. */
export type PullRequestCheck = NonNullable<
  NonNullable<PullRequestCheckQuery['repository']>['pullRequest']
>;

type OpenRepository = NonNullable<OpenPullRequestsQuery['repository']>;

/** One of a repository's open pull requests, with what finding stacks needs. */
export type OpenPullRequest = NonNullable<
  NonNullable<OpenRepository['pullRequests']['nodes']>[number]
>;

/** One of the merged pull requests updated most recently, which the first page also reads. */
export type RecentlyMergedPullRequest = NonNullable<
  NonNullable<OpenRepository['mergedPullRequests']['nodes']>[number]
>;

/** A repository's open pull requests, newest first, with what finding stacks needs besides. */
export interface OpenPullRequestList {
  pullRequests: OpenPullRequest[];
  /** How many GitHub says are open. */
  totalCount: number;
  /** Whether there were more than {@link MAX_OPEN_PULL_REQUESTS}, so the oldest were left out. */
  truncated: boolean;
  /** The repository's default branch, or nothing for an empty repository. */
  defaultBranch: string | undefined;
  /**
   * The merged pull requests finding stacks needs, each once: the
   * {@link RECENTLY_UPDATED_MERGED} updated most recently, from the first page, and those from the
   * branches open pull requests target, followed down, once they're looked up.
   */
  merged: MergedPullRequest[];
  /**
   * The branches whose merged pull requests were looked up, which the next read carries over while
   * their tips stay put.
   */
  lookups: BranchLookup[];
  /**
   * Whether some branches' merged pull requests weren't looked up, past the most looked up for one
   * read or after a lookup failed. Layers above them sit on those branches as roots.
   */
  mergedTruncated: boolean;
}

/** The open pull request numbered `number`, if the list has it. */
export function openPullRequest(
  list: OpenPullRequestList,
  number: number,
): OpenPullRequest | undefined {
  return list.pullRequests.find((pr) => pr.number === number);
}

/**
 * The branches that open pull requests both target and come from, other than the default branch:
 * the ones whose being a trunk changes the stacks, and which `readTrunkRules` checks one by one
 * when it can't read the rulesets.
 */
export function branchesToCheck(list: OpenPullRequestList): string[] {
  const heads = new Set(
    list.pullRequests.filter((pr) => !pr.isCrossRepository).map((pr) => pr.headRefName),
  );
  const branches = list.pullRequests
    .map((pr) => pr.baseRefName)
    .filter((base) => heads.has(base) && base !== list.defaultBranch);
  return [...new Set(branches)].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `branch`'s tip, as a pull request that targets it says. */
export function branchTip(list: OpenPullRequestList, branch: string): string | undefined {
  const fromOpen = list.pullRequests.find(
    (pr) => pr.baseRefName === branch && pr.baseRef?.target != null,
  );
  if (fromOpen) return fromOpen.baseRef?.target?.oid;
  return list.merged.find((pr) => pr.baseRefName === branch && pr.baseRef?.target != null)?.baseRef
    ?.target?.oid;
}

/** How many times a pull request's files are read again from the start when its head moves while they're paged through. */
const MAX_RESTARTS = 2;

/** The most open pull requests Lo reads from one repository. */
export const MAX_OPEN_PULL_REQUESTS = 1000;

/** How many of the merged pull requests updated most recently the first page of open pull requests reads. */
export const RECENTLY_UPDATED_MERGED = 20;

/**
 * How many of a pull request's review threads the check reads the state and comment count of:
 * its `reviewThreads(first: 100)`. Past them, only the count of threads moves.
 */
export const CHECKED_THREADS = 100;

/** The signed-in user. */
export async function viewer(client: GithubClient): Promise<Viewer> {
  return (await client.graphqlWithErrors(ViewerDocument, {}, 1)).data.viewer;
}

/** A pull request with every one of its files. */
export function pullRequest(
  client: GithubClient,
  owner: string,
  name: string,
  number: number,
): Promise<PullRequest> {
  return pullRequestPaged(client, owner, name, number, PAGE_SIZE);
}

/**
 * {@link pullRequest}, reading `pageSize` files a page. If the head moves while the files are
 * paged through, they're read again from the start, so they all belong to one revision.
 */
export async function pullRequestPaged(
  client: GithubClient,
  owner: string,
  name: string,
  number: number,
  pageSize: number,
): Promise<PullRequest> {
  const fetch = async (after: string | null): Promise<PullRequest> => {
    // `repository.pullRequest` is what was asked for; errors below it only leave out what
    // they're about.
    const { data } = await client.graphqlWithErrors(
      PullRequestDocument,
      { owner, name, number, filesFirst: pageSize, filesAfter: after },
      2,
    );
    const found = data.repository?.pullRequest;
    if (!found) throw notFound(`pull request ${owner}/${name}#${number}`);
    return found;
  };
  for (let restart = 0; restart <= MAX_RESTARTS; restart++) {
    const pull = await fetch(null);
    const { files } = pull;
    if (!files) return pull;
    const nodes = [...(files.nodes ?? [])];
    let pageInfo = files.pageInfo;
    const pager = new Pager('files', files.totalCount, pageSize);
    let moved = false;
    for (
      let after = pager.next(pageInfo.hasNextPage, pageInfo.endCursor);
      after !== undefined;
      after = pager.next(pageInfo.hasNextPage, pageInfo.endCursor)
    ) {
      const page = await fetch(after);
      if (page.headRefOid !== pull.headRefOid) {
        moved = true;
        break;
      }
      if (!page.files) {
        throw new GithubError({ kind: 'decode', message: 'a page of files went missing' });
      }
      nodes.push(...(page.files.nodes ?? []));
      pageInfo = page.files.pageInfo;
    }
    if (!moved) return { ...pull, files: { ...files, nodes, pageInfo } };
  }
  throw new GithubError({
    kind: 'inconsistent',
    message: `${owner}/${name}#${number} kept being pushed to while its files were read`,
  });
}

/** The cheap check for whether a pull request changed. */
export async function pullRequestCheck(
  client: GithubClient,
  owner: string,
  name: string,
  number: number,
): Promise<PullRequestCheck> {
  const { data } = await client.graphqlWithErrors(
    PullRequestCheckDocument,
    { owner, name, number },
    2,
  );
  const found = data.repository?.pullRequest;
  if (!found) throw notFound(`pull request ${owner}/${name}#${number}`);
  return found;
}

/** How many of the first {@link CHECKED_THREADS} review threads aren't resolved. */
export function unresolvedThreads(check: PullRequestCheck): number {
  return (check.reviewThreads.nodes ?? []).filter((thread) => thread && !thread.isResolved).length;
}

/**
 * A repository's open pull requests, `pageSize` a page, newest first so a cap leaves out the
 * oldest, up to {@link MAX_OPEN_PULL_REQUESTS}. The first page also reads the
 * `recentlyUpdated` merged pull requests updated most recently.
 */
export async function openPullRequestsPaged(
  client: GithubClient,
  repo: RepoRef,
  pageSize: number,
  recentlyUpdated: number,
): Promise<OpenPullRequestList> {
  const list: OpenPullRequestList = {
    pullRequests: [],
    totalCount: 0,
    truncated: false,
    defaultBranch: undefined,
    merged: [],
    lookups: [],
    mergedTruncated: false,
  };
  let pager: Pager | undefined;
  let after: string | null = null;
  for (;;) {
    const first = after === null;
    const { data } = await client.graphqlWithErrors(
      OpenPullRequestsDocument,
      {
        owner: repo.owner,
        name: repo.name,
        first: pageSize,
        after,
        merged: first ? recentlyUpdated : 0,
      },
      2,
    );
    const repository = data.repository;
    if (!repository) throw notFound(`repository ${repo.toString()}`);
    if (first) {
      list.defaultBranch = repository.defaultBranchRef?.name;
      list.merged = (repository.mergedPullRequests.nodes ?? []).filter((node) => node !== null);
    }
    const page = repository.pullRequests;
    list.totalCount = page.totalCount;
    // GitHub leaves out a pull request it can't show, as a null.
    list.pullRequests.push(...(page.nodes ?? []).filter((node) => node !== null));
    pager ??= new Pager(
      'open pull requests',
      Math.min(page.totalCount, MAX_OPEN_PULL_REQUESTS),
      pageSize,
    );
    if (list.pullRequests.length >= MAX_OPEN_PULL_REQUESTS) {
      list.truncated =
        page.pageInfo.hasNextPage || list.pullRequests.length > MAX_OPEN_PULL_REQUESTS;
      list.pullRequests.length = MAX_OPEN_PULL_REQUESTS;
      return list;
    }
    const next = pager.next(page.pageInfo.hasNextPage, page.pageInfo.endCursor);
    if (next === undefined) return list;
    after = next;
  }
}

/**
 * Marks one of a pull request's files viewed for the signed-in user. `pullRequestId` is the pull
 * request's node ID, its `id`. GitHub's mark is per user, and it resets to "changed since viewed"
 * when a push changes the file.
 */
export async function markFileAsViewed(
  client: GithubClient,
  pullRequestId: string,
  path: string,
): Promise<void> {
  const data = await client.graphql(MarkFileAsViewedDocument, { pullRequestId, path });
  marked(data.markFileAsViewed?.pullRequest);
}

/** Clears the signed-in user's viewed mark on one of a pull request's files. */
export async function unmarkFileAsViewed(
  client: GithubClient,
  pullRequestId: string,
  path: string,
): Promise<void> {
  const data = await client.graphql(UnmarkFileAsViewedDocument, { pullRequestId, path });
  marked(data.unmarkFileAsViewed?.pullRequest);
}

/**
 * A viewed-mark mutation's answer: GitHub names the pull request it changed. Without errors, a
 * missing one is an answer Lo doesn't understand, so it isn't taken as done.
 */
function marked(changed: unknown): void {
  if (changed == null) {
    throw new GithubError({
      kind: 'decode',
      message: "GitHub didn't say which pull request it changed",
    });
  }
}
