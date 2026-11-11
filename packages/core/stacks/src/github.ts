/**
 * A repository's stacks from what `@lo/github` reads: its open pull requests and the merged ones
 * they link through, the protection rules on their branches, and its rulesets. Looking up the
 * merged pull requests follows the stacks down, so it reads here.
 */

import {
  lookUpBranches,
  knownLookup,
  MAX_BRANCH_LOOKUPS,
  noLookups,
  openPullRequestsPaged,
  PAGE_SIZE,
  RECENTLY_UPDATED_MERGED,
  branchTip,
  type GithubClient,
  type KnownLookups,
  type MergedPullRequest,
  type OpenPullRequest,
  type OpenPullRequestList,
  type RepoRef,
  type TrunkRuleList,
} from '@lo/github';

import {
  branchesToLookUp,
  findStacks,
  type NativeStackEntry,
  type PullRequest,
  type Stacks,
} from './stacks.ts';
import { trunksAmong, type Trunks } from './trunks.ts';

/** A pull request's place in a GitHub stack, from its `stackEntry`, when both numbers make sense. */
function nativeStack(
  entry: { position: number; stack: { number: number } | null } | null,
): NativeStackEntry | undefined {
  const stack = entry?.stack?.number;
  if (entry == null || stack === undefined) return undefined;
  return valid(stack) && valid(entry.position) ? { stack, position: entry.position } : undefined;
}

/** Whether `value` is a count or a number GitHub can give: a whole number, not negative. */
function valid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** The commits GitHub listed, oldest first. */
function commitsOf(commits: { nodes: ({ commit: { oid: string } } | null)[] | null }): string[] {
  return (commits.nodes ?? []).flatMap((node) => (node ? [node.commit.oid] : []));
}

/** An open pull request, as finding stacks takes it. */
export function fromOpen(pr: OpenPullRequest): PullRequest {
  return {
    number: pr.number,
    state: { kind: 'open' },
    baseRef: pr.baseRefName,
    baseTip: pr.baseRef?.target?.oid,
    headRef: pr.headRefName,
    headInBaseRepo: !pr.isCrossRepository,
    headOid: pr.headRefOid,
    commits: commitsOf(pr.commits),
    createdAt: Date.parse(pr.createdAt),
    nativeStack: nativeStack(pr.stackEntry),
  };
}

/**
 * A merged pull request, as finding stacks takes it. Its head is in its base branch when it's
 * `mergeCommit`, as after a fast-forward, or one of its parents, as after a merge commit; not after
 * a squash or a rebase. GitHub names a merge commit for every merged pull request; without one, the
 * head is taken to be in.
 */
export function fromMerged(pr: MergedPullRequest): PullRequest {
  const merge = pr.mergeCommit;
  const headInBase =
    merge === null ||
    merge.oid === pr.headRefOid ||
    (merge.parents.nodes ?? []).some((parent) => parent?.oid === pr.headRefOid);
  return {
    number: pr.number,
    state: { kind: 'merged', headInBase },
    baseRef: pr.baseRefName,
    baseTip: pr.baseRef?.target?.oid,
    headRef: pr.headRefName,
    headInBaseRepo: !pr.isCrossRepository,
    headOid: pr.headRefOid,
    commits: commitsOf(pr.commits),
    createdAt: Date.parse(pr.createdAt),
    nativeStack: nativeStack(pr.stackEntry),
  };
}

/**
 * The open and merged pull requests, as finding stacks takes them, with the merged ones of `more`
 * that the list doesn't have.
 */
export function stackPullRequests(
  list: OpenPullRequestList,
  more: readonly MergedPullRequest[] = [],
): PullRequest[] {
  const extra = more.filter((pr) => !list.merged.some((known) => known.number === pr.number));
  return [...list.pullRequests.map(fromOpen), ...[...list.merged, ...extra].map(fromMerged)];
}

/**
 * What decides the repository's trunks: its default branch, the protection rules that cover its
 * pull requests' branches, and the repository's rulesets, `rules`.
 */
export function trunksOf(list: OpenPullRequestList, rules: TrunkRuleList): Trunks {
  const open = list.pullRequests.flatMap((pr) => {
    const base = pr.baseRef?.refUpdateRule?.pattern;
    // A fork's rule is about the fork's branches.
    const head = pr.isCrossRepository ? undefined : pr.headRef?.refUpdateRule?.pattern;
    return [base, head].filter((pattern) => pattern !== undefined);
  });
  const merged = list.merged.flatMap((pr) => pr.baseRef?.refUpdateRule?.pattern ?? []);
  const patterns = [...new Set([...open, ...merged])].toSorted((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return { defaultBranch: list.defaultBranch, protected: patterns, rulesets: rules.rulesets };
}

/**
 * The repository's stacks, with its rulesets, `rules`, and the merged pull requests of `more`, such
 * as those below the layers GitHub moved (`readStackLayers`'s `merged`).
 *
 * Until the rulesets have been read once, a tree is "loading", not one built without them: a branch
 * only a ruleset protects, such as a `develop` with a release pull request open from it, would hold
 * every layer on it.
 */
export function stacksOf(
  list: OpenPullRequestList,
  rules: TrunkRuleList,
  more: readonly MergedPullRequest[] = [],
): Stacks {
  const prs = stackPullRequests(list, more);
  return findStacks(prs, trunksAmong(trunksOf(list, rules), prs));
}

/**
 * Adds to `list` the merged pull requests its stacks link through that it doesn't have yet: those
 * from each branch `branchesToLookUp` names, until every branch it names was looked up, or
 * `MAX_BRANCH_LOOKUPS` were. What `known`, the list read before, found for a branch at the same tip
 * is carried over, as of `now`, in milliseconds since the Unix epoch. The branches that most open
 * pull requests target are looked up first, and the repository's trunks, from `rules` among
 * others, never are. When the lookups stop short, past the most or after an error that doesn't stop
 * the read, the list says so (`mergedTruncated`).
 */
export async function lookUpMerged(
  client: GithubClient,
  repo: RepoRef,
  list: OpenPullRequestList,
  known: OpenPullRequestList | undefined,
  rules: TrunkRuleList,
  now: number,
): Promise<void> {
  const carried: KnownLookups = known
    ? { lookups: known.lookups, merged: known.merged, now }
    : noLookups(now);
  const lookedUp = new Set<string>();
  let queried = 0;
  for (;;) {
    const prs = stackPullRequests(list);
    const trunks = trunksAmong(trunksOf(list, rules), prs);
    const branches = branchesToLookUp(prs, trunks).filter((branch) => !lookedUp.has(branch));
    if (branches.length === 0) return;
    // The branches most open pull requests target first: the likeliest to link layers.
    const targeted = new Map<string, number>();
    for (const pr of list.pullRequests) {
      targeted.set(pr.baseRefName, (targeted.get(pr.baseRefName) ?? 0) + 1);
    }
    const ranked = branches
      .toSorted((a, b) => (targeted.get(b) ?? 0) - (targeted.get(a) ?? 0))
      .map((branch) => ({ branch, tip: branchTip(list, branch) }));
    for (const { branch } of ranked) lookedUp.add(branch);
    const wanted = ranked.filter(
      ({ branch, tip }) => knownLookup(carried, branch, tip) === undefined,
    ).length;
    const room = MAX_BRANCH_LOOKUPS - queried;
    const looked = await lookUpBranches(
      client,
      repo,
      ranked,
      carried,
      room,
      list.merged,
      list.lookups,
    );
    if (looked === undefined || wanted > room) {
      list.mergedTruncated = true;
      return;
    }
    queried += looked;
  }
}

/**
 * A repository's open pull requests, newest first, with the merged pull requests finding stacks
 * needs, its rulesets being `rules`, read at `now`, in milliseconds since the Unix epoch.
 */
export async function readOpenPullRequests(
  client: GithubClient,
  repo: RepoRef,
  rules: TrunkRuleList,
  now: number,
): Promise<OpenPullRequestList> {
  const list = await openPullRequestsPaged(client, repo, PAGE_SIZE, RECENTLY_UPDATED_MERGED);
  await lookUpMerged(client, repo, list, undefined, rules, now);
  return list;
}
