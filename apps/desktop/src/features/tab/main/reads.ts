// What a pull request's tab reads from GitHub, and how it says it: the pull request to open, its
// header from whichever of GitHub's answers is newest, its changed files, how polling stands, and
// what went wrong. Nothing here calls Electron or keeps state.

import {
  GithubError,
  pullMerged,
  readPullSummary,
  readPullToOpen,
  type GithubClient,
  type PollStatus,
  type PullRef,
  type PullRequest,
  type PullSummary,
  type PullToOpen,
  type RepoAccount,
} from '@lo/github';

import type { Connection, Files, Header, Problem, PullState } from '../contract.ts';

/** The pull request as GitHub's REST API gives it: what opening it needs, and its summary. */
export interface Opened {
  readonly toOpen: PullToOpen;
  readonly summary: PullSummary;
}

/** Reads the pull request to open it, with `client`: in one request, both views of it. */
export function readPull(client: GithubClient, pull: PullRef): Promise<Opened> {
  return client.get(pull.restPath(), (json) => ({
    toOpen: readPullToOpen(json),
    summary: readPullSummary(json),
  }));
}

/** A pull request's state, as its REST summary says it. */
export function summaryState(summary: PullSummary): PullState {
  if (pullMerged(summary)) return 'merged';
  if (summary.state === 'closed') return 'closed';
  return summary.draft ? 'draft' : 'open';
}

/** A pull request's state, as its GraphQL details say it. */
export function detailsState(details: Pick<PullRequest, 'state' | 'isDraft'>): PullState {
  switch (details.state) {
    case 'MERGED':
      return 'merged';
    case 'CLOSED':
      return 'closed';
    case 'OPEN':
      return details.isDraft ? 'draft' : 'open';
    default:
      // A state GitHub adds later reads as open, as its pull request still is to Lo.
      details.state satisfies never;
      return details.isDraft ? 'draft' : 'open';
  }
}

/** The header from GitHub's REST view of the pull request, as read to open it. */
export function headerFromOpened({ toOpen, summary }: Opened): Header {
  const base = toOpen.base.repo.full_name;
  const head = toOpen.head.repo?.full_name;
  return {
    title: summary.title,
    state: summaryState(summary),
    author: toOpen.user?.login ?? null,
    head: {
      branch: summary.head.ref,
      fork: head !== undefined && head.toLowerCase() !== base.toLowerCase() ? head : null,
    },
    base: { branch: summary.base.ref },
  };
}

/** The header from GitHub's GraphQL details of the pull request. */
export function headerFromDetails(details: PullRequest): Header {
  const fork = details.isCrossRepository ? (details.headRepository?.nameWithOwner ?? null) : null;
  return {
    title: details.title,
    state: detailsState(details),
    author: details.author?.login ?? null,
    head: { branch: details.headRefName, fork },
    base: { branch: details.baseRefName },
  };
}

/**
 * The header with what a poll's REST summary changed: its title, state and branches. The summary
 * doesn't name the author or a fork, so those stay as they were.
 */
export function withSummary(header: Header | undefined, summary: PullSummary): Header {
  return {
    title: summary.title,
    state: summaryState(summary),
    author: header?.author ?? null,
    head: { branch: summary.head.ref, fork: header?.head.fork ?? null },
    base: { branch: summary.base.ref },
  };
}

/** The changed files GitHub's details list, with whether the account marked each viewed. */
export function filesFromDetails(id: string, details: PullRequest): Files | undefined {
  const { files } = details;
  if (!files) return undefined;
  return {
    id,
    files: (files.nodes ?? []).flatMap((node) =>
      node ? [{ path: node.path, viewed: viewedOf(node.viewerViewedState) }] : [],
    ),
    total: files.totalCount,
  };
}

function viewedOf(state: string): Files['files'][number]['viewed'] {
  switch (state) {
    case 'VIEWED':
      return 'viewed';
    case 'DISMISSED':
      return 'dismissed';
    default:
      return 'unviewed';
  }
}

/**
 * How what a tab shows stands, from its account's poller: signed out, the rate limit used up,
 * GitHub out of reach (with when what's shown was saved), the rate limit low, or live.
 */
export function connectionOf(
  login: string,
  status: PollStatus,
  savedAt: number | undefined,
): Connection {
  if (status.signedOut) return { kind: 'signedOut', login };
  const { rateLimit, offline } = status;
  if (rateLimit.kind === 'paused') {
    return {
      kind: 'rateLimited',
      login,
      until: Math.max(0, Math.round(rateLimit.until)),
      secondary: rateLimit.reason.kind === 'secondary',
    };
  }
  if (offline) {
    return {
      kind: 'offline',
      savedAt: savedAt === undefined ? null : Math.round(savedAt),
      retryAt: Math.max(0, Math.round(offline.retryAt)),
      error: offline.error,
    };
  }
  if (rateLimit.kind === 'slowed' || rateLimit.kind === 'openOnly') {
    return {
      kind: 'limitLow',
      remaining: rateLimit.low.remaining,
      reset: Math.max(0, Math.round(rateLimit.low.reset)),
    };
  }
  return { kind: 'live' };
}

/** Whether `error` says GitHub couldn't be reached, as opposed to an answer. */
export function isUnreached(error: unknown): boolean {
  const github = githubError(error);
  return github?.detail.kind === 'network';
}

/** When a refusal for the rate limit says to try again, in milliseconds, if it's one. */
export function rateLimitedUntil(error: unknown, now: number): number | undefined {
  const github = githubError(error);
  if (github?.detail.kind !== 'rateLimited') return undefined;
  const { reset, retryAfter } = github.detail;
  if (retryAfter !== undefined) return now + retryAfter * 1000;
  if (reset !== undefined) return reset * 1000;
  return now + 60_000;
}

/**
 * What reading the pull request to open it ran into, as a problem the tab shows: not there, or
 * the account can't see it; blocked until the account's authorized, with GitHub's link; or
 * anything else, which Lo tries again at `retryAt`. Nothing for an error the poller's status says
 * already: GitHub out of reach, the rate limit or a refused token.
 */
export function problemOf(
  error: unknown,
  pull: PullRef,
  acting: { kind: 'account'; login: string } | { kind: 'anonymous'; canSignIn: boolean },
  retryAt: number | undefined,
): Problem {
  const github = githubError(error);
  const name = pull.toString();
  if (github) {
    const { detail } = github;
    const link = github.helpLink();
    if (link) {
      const message =
        detail.kind === 'oauthAppRestricted'
          ? restrictedMessage(detail.org ?? pull.repo.owner)
          : github.message;
      return { kind: 'blocked', message, links: [link] };
    }
    if (detail.kind === 'notFound' || (detail.kind === 'api' && detail.status === 410)) {
      return {
        kind: 'notFound',
        message:
          acting.kind === 'account'
            ? `GitHub has no pull request ${name}, or ${acting.login} can't see it.`
            : acting.canSignIn
              ? `GitHub has no public pull request ${name}. If it's private, sign in with an account that can see it.`
              : `GitHub has no public pull request ${name}.`,
      };
    }
  }
  return {
    kind: 'failed',
    message: `Lo couldn't read ${name}: ${describe(error)}`,
    retryAt: retryAt === undefined ? null : Math.round(retryAt),
  };
}

/**
 * What a tab says when an organization restricts third-party apps and hasn't approved Lo: GitHub
 * hides the organization's private repositories from Lo until an owner approves it, which the
 * person asks for on GitHub.
 */
export function restrictedMessage(org: string): string {
  return `${org} hasn't approved Lo, so GitHub hides its repositories from Lo. Ask for approval on GitHub, and GitHub emails ${org}'s owners.`;
}

/**
 * The organization that restricts Lo, when that's why no account Lo would use could check a
 * repository: among every account's problems, or the chosen account's alone.
 */
export function restrictingOrg(found: RepoAccount): string | undefined {
  const chosen = found.choice.kind === 'unavailable' ? found.choice.login : undefined;
  for (const { login, error } of found.problems) {
    if (chosen !== undefined && login.toLowerCase() !== chosen.toLowerCase()) continue;
    const { detail } = error;
    if (detail.kind === 'oauthAppRestricted') return detail.org ?? found.repo.owner;
  }
  return undefined;
}

/** The GitHub error `error` is, or was caused by. */
function githubError(error: unknown): GithubError | undefined {
  for (let at = error, depth = 0; at !== undefined && depth < 5; depth++) {
    if (at instanceof GithubError) return at;
    at = at instanceof Error ? at.cause : undefined;
  }
  return undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
