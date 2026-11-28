// What a pull request's tab reads from GitHub, and how it says it: the pull request to open, its
// header from whichever of GitHub's answers is newest, its changed files, how polling stands, and
// what went wrong. Nothing here calls Electron or keeps state.

import {
  causeOf,
  githubErrorIn,
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
  saidBy,
  sameLogin,
} from '@lo/github';

import { detailsOf, githubCause } from '../../../ipc/cause.ts';

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

/**
 * Whether the pull request's head is in a fork, from GitHub's REST view of it read to open it:
 * GitHub leaves out the head's repository once the fork is deleted.
 */
export function isForked({ toOpen }: Opened): boolean {
  const head = toOpen.head.repo?.full_name;
  return head === undefined || head.toLowerCase() !== toOpen.base.repo.full_name.toLowerCase();
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
 * doesn't name the author or a fork, so those stay as they were, and an author not yet known stays
 * unknown, not deleted.
 */
export function withSummary(header: Header | undefined, summary: PullSummary): Header {
  const author = header?.author;
  return {
    title: summary.title,
    state: summaryState(summary),
    ...(author === undefined ? {} : { author }),
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
 * GitHub out of reach, with why as the poller has it, the rate limit low, or live.
 */
export function connectionOf(login: string, status: PollStatus): Connection {
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
      retryAt: Math.max(0, Math.round(offline.retryAt)),
      cause: githubCause(offline.cause),
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
  return githubErrorIn(error)?.detail.kind === 'network';
}

/** When a refusal for the rate limit says to try again, in milliseconds, if it's one. */
export function rateLimitedUntil(error: unknown, now: number): number | undefined {
  const github = githubErrorIn(error);
  if (github?.detail.kind !== 'rateLimited') return undefined;
  const { reset, retryAfter } = github.detail;
  if (retryAfter !== undefined) return now + retryAfter * 1000;
  if (reset !== undefined) return reset * 1000;
  return now + 60_000;
}

/**
 * Who a tab reads its pull request as: an account, or nobody, with whether any account is signed
 * in, and one GitHub signed out, if one is, which a read GitHub refuses names.
 */
export type ReadAs =
  | { readonly kind: 'account'; readonly login: string }
  | {
      readonly kind: 'anonymous';
      readonly signedIn: boolean;
      readonly signedOut?: string | undefined;
    };

/**
 * The signed-out account a read as nobody names when GitHub refuses it or finds nothing, since
 * signing in to it again may show the pull request: the one remembered for the repository, or for
 * its owner; else one GitHub refused as `found` checked which accounts can see it; else the only
 * account there is. Nothing when none of those is signed out, as `accounts` now stand.
 */
export function signedOutOf(
  accounts: readonly {
    readonly account: { readonly login: string };
    readonly signedOut: string | undefined;
  }[],
  found: Pick<RepoAccount, 'problems' | 'remembered'> | undefined,
): string | undefined {
  const out = (login: string | undefined) =>
    login === undefined
      ? undefined
      : accounts.find(
          (each) => each.signedOut !== undefined && sameLogin(each.account.login, login),
        )?.account.login;
  const refused = (found?.problems ?? [])
    .filter(({ error }) => error.isUnauthorized())
    .map(({ login }) => login);
  for (const login of [found?.remembered.repo, found?.remembered.owner, ...refused]) {
    const named = out(login);
    if (named !== undefined) return named;
  }
  const [only, ...others] = accounts;
  return others.length === 0 ? out(only?.account.login) : undefined;
}

/**
 * What reading the pull request to open it ran into, as a problem the tab shows, with its cause
 * and what GitHub said: not there, or the account can't see it (or, read without one, with
 * `signedIn` saying whether any account is, and `signedOut` an account GitHub signed out, which
 * signing in to again may show it); blocked until the account's authorized, with GitHub's link; or
 * anything else, which Lo tries again at `retryAt`. Nothing for an error the poller's status says
 * already: GitHub out of reach, the rate limit or a refused token.
 */
export function problemOf(
  error: unknown,
  pull: PullRef,
  acting: ReadAs,
  retryAt: number | undefined,
): Problem {
  const github = githubErrorIn(error);
  const login = acting.kind === 'account' ? acting.login : acting.signedOut;
  const cause = githubCause(causeOf(error, { owner: pull.repo.owner, login }));
  const details = detailsOf(saidBy(error));
  if (github) {
    const { detail } = github;
    const link = github.helpLink();
    if (link) return { kind: 'blocked', cause, links: [link], details };
    if (detail.kind === 'notFound' || (detail.kind === 'api' && detail.status === 410)) {
      return {
        kind: 'notFound',
        cause:
          acting.kind === 'account'
            ? { kind: 'hidden', login: acting.login }
            : acting.signedOut === undefined
              ? { kind: 'private', signedIn: acting.signedIn }
              : { kind: 'signedOut', login: acting.signedOut },
        details,
      };
    }
  }
  return {
    kind: 'failed',
    cause,
    details,
    retryAt: retryAt === undefined ? null : Math.round(retryAt),
  };
}
