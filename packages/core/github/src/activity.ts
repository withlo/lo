/**
 * A branch's pushes, from GitHub's repository activity API
 * (`GET /repos/{owner}/{repo}/activity?ref=refs/heads/{branch}`). It lists every push to a branch,
 * normal and forced, with its exact time and the heads before and after, from about March 2023 on,
 * and keeps listing them after the branch is deleted.
 *
 * The API pages with cursors in its `Link` header, which a `304` leaves out, so each page is kept
 * with its URL, its ETag and the next page's URL.
 */

import type { components } from '@octokit/openapi-types';

import type { GithubClient, RestResponse } from './client.ts';
import { GithubError } from './errors.ts';
import { unchecked } from './json.ts';
import type { RepoRef } from './refs.ts';
import { nextLink } from './files.ts';

/** The most items GitHub gives a page. */
const PAGE_SIZE = 100;

/** The activity API's answer for one push. */
type Activity = components['schemas']['activity'];

/**
 * The order the API lists pushes in: `asc`, oldest first, where later pushes only add to the
 * last page, so earlier pages keep their ETags; or `desc`, newest first, where the pushes after a
 * time come first.
 */
export type ActivityDirection = 'asc' | 'desc';

/** One push to a branch, as the activity API lists it. */
export interface ActivityEntry {
  id: number;
  /** The branch's head before the push: GitHub's all-zero SHA when the push created it. */
  before: string;
  /** The branch's head after the push: the all-zero SHA when the push deleted it. */
  after: string;
  timestamp: string;
  /**
   * `push`, `force_push`, `branch_creation`, `branch_deletion`, `pr_merge` or `merge_queue_merge`.
   */
  activity_type: Activity['activity_type'];
  /** Who pushed, unless GitHub no longer has the account. */
  actor: ActivityActor | undefined;
}

/** The account behind a push. */
export interface ActivityActor {
  login: string;
}

export function isForced(entry: ActivityEntry): boolean {
  return entry.activity_type === 'force_push';
}

export function isDeletion(entry: ActivityEntry): boolean {
  return entry.activity_type === 'branch_deletion';
}

/** One page of a branch's pushes, with what's needed to ask about it again. */
export interface ActivityPage {
  /** The URL it was read from. */
  url: string;
  etag: string | undefined;
  /** The next page's URL, from the `Link` header. */
  next: string | undefined;
  entries: ActivityEntry[];
}

/** A branch's pushes, as far as Lo read them. */
export interface BranchActivity {
  branch: string;
  direction: ActivityDirection;
  /** The pages read, in the API's order. */
  pages: ActivityPage[];
  /** Whether reading stopped at the most pages it reads, with more left. */
  truncated: boolean;
  /**
   * Why GitHub showed none: the repository is gone, as a deleted fork is, or the account can't
   * read it.
   */
  unavailable: string | undefined;
  /**
   * The page on github.com that fixes why it's unavailable, such as authorizing the account's
   * single sign-on for an organization.
   */
  helpUrl: string | undefined;
  /**
   * Why the latest read failed, for a reason that may pass, such as an error on GitHub's side.
   * The pages are an earlier read's, if there was one.
   */
  failed: string | undefined;
}

/** The branch's pushes read, oldest first. */
export function activityEntries(activity: BranchActivity): ActivityEntry[] {
  const entries = activity.pages.flatMap((page) => page.entries);
  return activity.direction === 'desc' ? entries.toReversed() : entries;
}

/** No pushes, before any were read. */
export function noActivity(branch: string, direction: ActivityDirection): BranchActivity {
  return {
    branch,
    direction,
    pages: [],
    truncated: false,
    unavailable: undefined,
    helpUrl: undefined,
    failed: undefined,
  };
}

/** No pushes, for `reason`. */
export function unavailableActivity(
  branch: string,
  direction: ActivityDirection,
  reason: string,
): BranchActivity {
  return { ...noActivity(branch, direction), unavailable: reason };
}

/**
 * `known`'s pushes, if it read the same branch the same way, or none, after a read that failed
 * for `reason`.
 */
export function failedActivity(
  known: BranchActivity | undefined,
  branch: string,
  direction: ActivityDirection,
  reason: string,
): BranchActivity {
  const kept = sameRead(known, branch, direction) ? known : noActivity(branch, direction);
  return { ...kept, failed: reason };
}

/** Whether `known` read `branch` in `direction`, and found it. */
function sameRead(
  known: BranchActivity | undefined,
  branch: string,
  direction: ActivityDirection,
): known is BranchActivity {
  return (
    known !== undefined &&
    known.branch === branch &&
    known.direction === direction &&
    known.unavailable === undefined
  );
}

/** The REST path of the first page of `branch`'s pushes in `repo`. */
export function activityPath(repo: RepoRef, branch: string, direction: ActivityDirection): string {
  const query = new URLSearchParams({
    ref: `refs/heads/${branch}`,
    direction,
    per_page: String(PAGE_SIZE),
  });
  const path = ['repos', repo.owner, repo.name, 'activity'].map(encodeURIComponent).join('/');
  return `/${path}?${query.toString()}`;
}

/** The statuses that say a repository is gone or closed to the account. */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([403, 409, 410, 451]);

/**
 * Why a branch has no pushes to show, when GitHub's error says the repository is gone or can't
 * be read, rather than that something went wrong.
 */
export function unavailableReason(error: GithubError): string | undefined {
  const { detail } = error;
  if (
    detail.kind === 'notFound' ||
    detail.kind === 'ssoRequired' ||
    detail.kind === 'oauthAppRestricted'
  ) {
    return detail.message;
  }
  if (detail.kind === 'api' && UNAVAILABLE_STATUSES.has(detail.status)) return detail.message;
  return undefined;
}

/** How to read a branch's pushes. */
export interface BranchActivityRead {
  direction: ActivityDirection;
  /** The pushes read before, whose pages are asked about with their ETags. */
  known?: BranchActivity | undefined;
  /** The most pages to read. */
  maxPages: number;
  /** Whether a push is far enough back: reading stops after the first page holding one. */
  enough?: ((entry: ActivityEntry) => boolean) | undefined;
}

/**
 * `branch`'s pushes in `repo`, a page at a time in `direction`, up to `maxPages` pages. Reading
 * stops after the first page holding a push `enough` accepts.
 *
 * Each page `known` has at the same URL is asked about with its ETag, and a `304` reuses it. A
 * `304` leaves out the `Link` header, so a full page `known` has no next page for is asked for in
 * full, since one may have come after it. Read newest first, an unchanged first page means
 * nothing was pushed since, and `known` is returned as it is.
 *
 * A repository that's gone, or that the account can't read, isn't an error: it gives no pushes,
 * and says why in `unavailable`.
 */
export async function branchActivity(
  client: GithubClient,
  repo: RepoRef,
  branch: string,
  { direction, known: given, maxPages, enough = () => false }: BranchActivityRead,
): Promise<BranchActivity> {
  const known = sameRead(given, branch, direction) ? given : undefined;
  const activity = noActivity(branch, direction);
  let url: string | undefined = activityPath(repo, branch, direction);
  while (url !== undefined) {
    if (activity.pages.length >= maxPages) {
      activity.truncated = true;
      break;
    }
    const index = activity.pages.length;
    const current = url;
    const atIndex = known?.pages[index];
    const knownPage = atIndex?.url === current ? atIndex : undefined;
    const refetchInFull =
      knownPage !== undefined &&
      knownPage.next === undefined &&
      knownPage.entries.length >= PAGE_SIZE;
    const etag = refetchInFull ? undefined : knownPage?.etag;
    let response: RestResponse;
    try {
      response = await client.send('GET', current, {
        condition: etag === undefined ? undefined : { ifNoneMatch: etag },
      });
    } catch (error) {
      if (!(error instanceof GithubError)) throw error;
      const reason = unavailableReason(error);
      if (reason === undefined) throw error;
      return { ...unavailableActivity(branch, direction, reason), helpUrl: error.helpLink()?.url };
    }
    const { page, unchanged } = pageFrom(response, current, knownPage);
    if (unchanged && index === 0 && direction === 'desc' && known !== undefined) {
      return { ...known, failed: undefined };
    }
    url = page.next;
    activity.pages.push(page);
    if (page.entries.some((entry) => enough(entry))) break;
  }
  return activity;
}

/** The page GitHub's answer holds: the known one for a `304`, which has to be there. */
function pageFrom(
  response: RestResponse,
  url: string,
  known: ActivityPage | undefined,
): { page: ActivityPage; unchanged: boolean } {
  if (response.status === 304) {
    if (known === undefined) {
      throw new GithubError({
        kind: 'inconsistent',
        message: `GitHub said ${url} hadn't changed, but Lo never read it`,
      });
    }
    return { page: known, unchanged: true };
  }
  const link = response.header('link');
  return {
    page: {
      url,
      etag: response.etag,
      next: link === undefined ? undefined : nextLink(link),
      entries: response.json(readEntries),
    },
    unchanged: false,
  };
}

/** The pushes in the API's answer, keeping what Lo reads of each. */
function readEntries(json: unknown): ActivityEntry[] {
  if (!Array.isArray(json)) {
    throw new GithubError({ kind: 'decode', message: 'the activity API answered without a list' });
  }
  return json.map((value) => {
    const activity = unchecked<Activity>(value);
    return {
      id: activity.id,
      before: activity.before,
      after: activity.after,
      timestamp: activity.timestamp,
      activity_type: activity.activity_type,
      actor: activity.actor ? { login: activity.actor.login } : undefined,
    };
  });
}
