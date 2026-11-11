/**
 * Branches' merged pull requests, which link the open layers of a stack whose lower layers merged,
 * ten branches a request (`MergedPullRequests`). What an earlier read looked up is carried over
 * while its branch stays put.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import {
  MergedPullRequestsDocument,
  type MergedPullRequestFieldsFragment,
} from './generated/graphql.ts';
import { notFound } from './pager.ts';
import type { RepoRef } from './refs.ts';

/**
 * A merged pull request, with what finding stacks reads of it: the `MergedPullRequestFields`
 * fragment, which `OpenPullRequests` reads too.
 */
export type MergedPullRequest = MergedPullRequestFieldsFragment;

/** How many of a branch's merged pull requests are read, newest first. A branch name is rarely used for more than one. */
export const MERGED_PER_BRANCH = 5;
/** How many branches one `MergedPullRequests` request looks up: its aliases. */
export const BRANCHES_A_REQUEST = 10;
/**
 * The most branches whose merged pull requests are looked up for one read, two requests' worth.
 * Branches whose lookup is carried over from the last read don't count.
 */
export const MAX_BRANCH_LOOKUPS = 20;
/**
 * How long a lookup that found nothing is carried over, while its branch stays put, in
 * milliseconds: a pull request from the branch may have opened and merged since, which doesn't move
 * the branch.
 */
export const EMPTY_LOOKUP_MAX_AGE = 24 * 60 * 60 * 1000;

/** A branch whose merged pull requests were looked up, and what was found. */
export interface BranchLookup {
  branch: string;
  /**
   * The branch's tip when it was looked up, from a pull request it's the base of, or nothing when
   * none said, as once it's deleted. A lookup is carried over to the next read while the tip is the
   * same.
   */
  tip: string | undefined;
  /** The numbers of the merged pull requests found. */
  found: number[];
  /** When it was looked up, in milliseconds since the Unix epoch. */
  at: number;
}

/** What an earlier read looked up, to carry over, and the time now. */
export interface KnownLookups {
  readonly lookups: readonly BranchLookup[];
  /** The merged pull requests they found, among others. */
  readonly merged: readonly MergedPullRequest[];
  /** The time now, in milliseconds since the Unix epoch. */
  readonly now: number;
}

/** Nothing known, at `now`. */
export function noLookups(now: number): KnownLookups {
  return { lookups: [], merged: [], now };
}

/**
 * What was found looking up `branch` at `tip`, unless it found nothing more than
 * {@link EMPTY_LOOKUP_MAX_AGE} ago.
 */
export function knownLookup(
  known: KnownLookups,
  branch: string,
  tip: string | undefined,
): BranchLookup | undefined {
  return known.lookups.find(
    (lookup) =>
      lookup.branch === branch &&
      lookup.tip === tip &&
      (lookup.found.length > 0 || known.now - lookup.at < EMPTY_LOOKUP_MAX_AGE),
  );
}

/** Adds `pr` to `merged` unless it's there already. */
export function addMerged(merged: MergedPullRequest[], pr: MergedPullRequest): void {
  if (!merged.some((known) => known.number === pr.number)) merged.push(pr);
}

/**
 * The merged pull requests from the branches `branches`, {@link MERGED_PER_BRANCH} a branch, newest
 * first, {@link BRANCHES_A_REQUEST} branches a request. Pull requests from forks' branches of those
 * names are among them.
 */
export async function mergedPullRequests(
  client: GithubClient,
  repo: RepoRef,
  branches: readonly string[],
): Promise<MergedPullRequest[]> {
  const merged: MergedPullRequest[] = [];
  for (let start = 0; start < branches.length; start += BRANCHES_A_REQUEST) {
    const batch = branches.slice(start, start + BRANCHES_A_REQUEST);
    // A batch of fewer branches asks about the first again.
    const branch = (index: number) => batch[index] ?? batch[0] ?? '';
    const { data } = await client.graphqlWithErrors(
      MergedPullRequestsDocument,
      {
        owner: repo.owner,
        name: repo.name,
        b0: branch(0),
        b1: branch(1),
        b2: branch(2),
        b3: branch(3),
        b4: branch(4),
        b5: branch(5),
        b6: branch(6),
        b7: branch(7),
        b8: branch(8),
        b9: branch(9),
        first: MERGED_PER_BRANCH,
      },
      2,
    );
    const found = data.repository;
    if (!found) throw notFound(`repository ${repo.toString()}`);
    const lists = [
      found.b0,
      found.b1,
      found.b2,
      found.b3,
      found.b4,
      found.b5,
      found.b6,
      found.b7,
      found.b8,
      found.b9,
    ];
    for (const list of lists) {
      for (const pr of list.nodes ?? []) if (pr) addMerged(merged, pr);
    }
  }
  return merged;
}

/**
 * Looks up the merged pull requests from `branches`, each with its tip, adding them to `merged`
 * and a record of each lookup to `lookups`. A branch `known` looked up at the same tip is carried
 * over without a request. Of the rest, at most `room` are looked up, in the order given. Gives how
 * many were, or throws an error that stops the read; any other error leaves them unread, and gives
 * nothing.
 */
export async function lookUpBranches(
  client: GithubClient,
  repo: RepoRef,
  branches: readonly { branch: string; tip: string | undefined }[],
  known: KnownLookups,
  room: number,
  merged: MergedPullRequest[],
  lookups: BranchLookup[],
): Promise<number | undefined> {
  const unknown: { branch: string; tip: string | undefined }[] = [];
  for (const { branch, tip } of branches) {
    const lookup = knownLookup(known, branch, tip);
    if (!lookup) {
      unknown.push({ branch, tip });
      continue;
    }
    for (const pr of known.merged) if (lookup.found.includes(pr.number)) addMerged(merged, pr);
    lookups.push(structuredClone(lookup));
  }
  const asked = unknown.slice(0, Math.max(0, room));
  if (asked.length === 0) return 0;
  let found: MergedPullRequest[];
  try {
    found = await mergedPullRequests(
      client,
      repo,
      asked.map(({ branch }) => branch),
    );
  } catch (error) {
    if (!(error instanceof GithubError) || error.stopsTheRead()) throw error;
    return undefined;
  }
  for (const { branch, tip } of asked) {
    const fromBranch = found.filter((pr) => pr.headRefName === branch).map((pr) => pr.number);
    lookups.push({ branch, tip, found: fromBranch, at: known.now });
  }
  for (const pr of found) addMerged(merged, pr);
  return asked.length;
}
