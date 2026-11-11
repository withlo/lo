// The window's tabs: the kinds of tab, what the window may ask main to do with them, and what main
// tells the window each time they change. Main keeps the tabs, so a link from another app opens one
// as surely as a key does, and they come back after Lo restarts.

import { parsePullLink } from '@lo/review';
import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { login } from '../accounts/contract.ts';

/** A pull request's state, as its tab shows it. */
export const pullState = z.enum(['open', 'draft', 'merged', 'closed']);
export type PullState = z.output<typeof pullState>;

/** A tab's id, which main gives it as it opens. */
export const tabId = z.string().min(1).max(64);

/**
 * A pull request on github.com, named as the link it was opened from names it: an owner and a
 * repository GitHub allows (they name a folder in Lo's cache, so nothing else gets through), and a
 * number GitHub can hold.
 */
const pullRequest = {
  owner: z.string().min(1).max(39),
  repo: z.string().min(1).max(100),
  number: z.number().int().min(1),
};

/** Whether a pull request's owner, repository and number are as a link to it would read them. */
function isPullRequest({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  try {
    const read = parsePullLink(`https://github.com/${owner}/${repo}/pull/${number}`);
    return read.owner === owner && read.repo === repo && read.number === number;
  } catch {
    return false;
  }
}

/**
 * A tab as the strip shows it. Its kind says what it holds:
 *
 * - `pull`, a pull request (or a whole stack), with its title and state once GitHub has given
 *   them. They're kept, so a tab that hasn't been shown since Lo started still says what it holds.
 * - `recent`, the pull requests opened recently. It stands in for an empty strip: it's there only
 *   while no other tab is, and it can't be closed.
 * - `settings`, Lo's settings, open in one tab at most.
 */
export const tab = z.discriminatedUnion('kind', [
  z.strictObject({
    id: tabId,
    kind: z.literal('pull'),
    ...pullRequest,
    title: z.string().optional(),
    state: pullState.optional(),
  }),
  z.strictObject({ id: tabId, kind: z.literal('recent') }),
  z.strictObject({ id: tabId, kind: z.literal('settings') }),
]);
export type Tab = z.output<typeof tab>;

/** Every kind of tab. */
export type Kind = Tab['kind'];

/** The tabs in the strip's order, and the one on screen. There's always at least one. */
export const tabs = z.strictObject({ tabs: z.array(tab).min(1), active: tabId });
export type Tabs = z.output<typeof tabs>;

/** What a tab opens on: a pull request, or Settings. Recent opens by itself. */
export const opening = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('pull'), ...pullRequest })
    .refine(isPullRequest, 'Not a pull request on github.com.'),
  z.strictObject({ kind: z.literal('settings') }),
]);
export type Opening = z.output<typeof opening>;

/**
 * Which tab to show: one by its id, by its place in the strip (from 1), the last, or the one
 * after or before the tab on screen, round the ends.
 */
export const choice = z.union([
  z.strictObject({ id: tabId }),
  z.strictObject({ position: z.number().int().min(1).max(1_000_000) }),
  z.strictObject({ last: z.literal(true) }),
  z.strictObject({ step: z.union([z.literal(1), z.literal(-1)]) }),
]);
export type Choice = z.output<typeof choice>;

/** A commit's ID, as git and GitHub write it: 40 hex digits, or 64 in a SHA-256 repository. */
export const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/** Who a tab acts as on GitHub: a signed-in account, or nobody, for a public repository. */
export const acting = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('account'), login }),
  z.strictObject({ kind: z.literal('anonymous') }),
]);
export type Acting = z.output<typeof acting>;

/**
 * What a pull request's header shows: its title and state, who opened it, and which branch it
 * wants to merge into which. The head's repository is named when it's a fork.
 */
export const header = z.strictObject({
  title: z.string(),
  state: pullState,
  /** The author's login, or null for an account GitHub deleted. */
  author: z.string().nullable(),
  head: z.strictObject({ branch: z.string(), fork: z.string().nullable() }),
  base: z.strictObject({ branch: z.string() }),
});
export type Header = z.output<typeof header>;

/**
 * How what a tab shows stands with GitHub, worst first: the account is signed out, the rate limit
 * is used up, GitHub can't be reached (what's shown is from `savedAt`), or the rate limit is low,
 * so Lo asks less often. `live` when none of these is so.
 */
export const connection = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('live') }),
  z.strictObject({ kind: z.literal('signedOut'), login }),
  z.strictObject({ kind: z.literal('rateLimited'), login: login.nullable(), until: time }),
  z.strictObject({
    kind: z.literal('offline'),
    savedAt: time.nullable(),
    retryAt: time.nullable(),
    error: z.string(),
  }),
  z.strictObject({ kind: z.literal('limitLow'), remaining: z.number().int(), reset: time }),
]);
export type Connection = z.output<typeof connection>;

/** GitHub's page for fixing a problem, such as authorizing single sign-on. */
export const helpLink = z.strictObject({ label: z.string(), url: z.string() });

/**
 * Why a tab can't show its pull request: GitHub has no such pull request, or the account can't
 * see it; an organization blocks the account until it's authorized, with GitHub's links to fix
 * that; several accounts can see it, and none was chosen for it; or reading it failed, and Lo
 * tries again at `retryAt`, if it will.
 */
export const problem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('notFound'), message: z.string() }),
  z.strictObject({ kind: z.literal('blocked'), message: z.string(), links: z.array(helpLink) }),
  z.strictObject({ kind: z.literal('ask'), logins: z.array(login) }),
  z.strictObject({ kind: z.literal('failed'), message: z.string(), retryAt: time.nullable() }),
]);
export type Problem = z.output<typeof problem>;

/**
 * A pull request's tab as main has it, sent each time it changes: who it acts as, its header, how
 * it stands with GitHub, why it can't be shown, the head on screen, and a newer push on GitHub,
 * once there is one. The head on screen is the one GitHub had when the tab opened, and stays until
 * the newer push is loaded, so nothing moves under the reader. `loading` while Lo is still finding
 * out what to show, with nothing to show yet.
 */
export const pull = z.strictObject({
  id: tabId,
  loading: z.boolean(),
  acting: acting.nullable(),
  header: header.nullable(),
  connection,
  problem: problem.nullable(),
  shown: oid.nullable(),
  newer: oid.nullable(),
});
export type PullView = z.output<typeof pull>;

/** Whether the account marked a changed file viewed, as GitHub says. */
export const viewed = z.enum(['viewed', 'unviewed', 'dismissed']);

/**
 * The files a pull request changes, as GitHub lists them, each with whether the account marked it
 * viewed, sent each time the list changes. GitHub lists no more than 3,000, so `total` can be more.
 */
export const files = z.strictObject({
  id: tabId,
  files: z.array(z.strictObject({ path: z.string(), viewed })),
  total: z.number().int().nonnegative(),
});
export type Files = z.output<typeof files>;

/** Why fetching the local copy failed, in `@lo/git`'s words, or that the disk is full. */
export const fetchFailure = z.enum([
  'network',
  'auth',
  'tokenRefused',
  'rateLimited',
  'certificate',
  'repoNotFound',
  'refNotFound',
  'timedOut',
  'tooLarge',
  'unavailable',
  'diskFull',
  'other',
]);
export type FetchFailure = z.output<typeof fetchFailure>;

/**
 * A tab's local copy of its pull request, sent each time it changes:
 *
 * - `waiting` until Lo knows what to fetch and has git;
 * - `noGit` when Lo has no git new enough, with what it found and how to install one;
 * - `fetching`, with what git is doing, on the `attempt`th try;
 * - `ready`, with the head on screen, the base branch's tip it was fetched with, and where the
 *   two branched; `offline` when GitHub couldn't be reached, so it's what was fetched before;
 * - `retrying` after a failure Lo tries again after by itself, at `retryAt`;
 * - `failed` after one it doesn't, until asked to try again.
 */
export const localState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('waiting') }),
  z.strictObject({ kind: z.literal('noGit'), message: z.string(), install: z.string() }),
  z.strictObject({
    kind: z.literal('fetching'),
    progress: z.string().nullable(),
    attempt: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('ready'),
    head: oid,
    base: oid,
    mergeBase: oid.nullable(),
    offline: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('retrying'),
    failure: fetchFailure,
    message: z.string(),
    attempt: z.number().int().positive(),
    retryAt: time,
  }),
  z.strictObject({ kind: z.literal('failed'), failure: fetchFailure, message: z.string() }),
]);
export type LocalState = z.output<typeof localState>;

export const local = z.strictObject({ id: tabId, state: localState });
export type Local = z.output<typeof local>;

/** The most a copy may hold: 1 MiB of text, as UTF-8. */
export const COPY_LIMIT = 1024 * 1024;

/** Whether `text` fits in a copy. */
function fitsCopy(text: string): boolean {
  return text.length <= COPY_LIMIT && new TextEncoder().encode(text).length <= COPY_LIMIT;
}

/**
 * Whether `address` is a page on github.com over HTTPS, the only kind Lo opens in the browser:
 * no other host or port, no name or password in it.
 */
export function isGithubPage(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.href.startsWith('https://github.com/')
  );
}

/** A tab, by its id. */
const byId = z.strictObject({ id: tabId });

export const contract = defineContract('tab', {
  requests: {
    list: { input: z.undefined(), reply: reply<Tabs>() },
    /**
     * Opens a tab and shows it, and replies with its id. A pull request already open, by any name
     * it's known by, or Settings when it's open, shows the tab it's in.
     */
    open: { input: opening, reply: reply<string>() },
    /** Closes a tab, or without an id, the one on screen. Recent can't be closed. */
    close: { input: z.strictObject({ id: tabId.optional() }), reply: reply<void>() },
    select: { input: choice, reply: reply<void>() },
    /** Moves a tab to another place in the strip, from 0. */
    move: {
      input: z.strictObject({ id: tabId, to: z.number().int().min(0).max(1_000_000) }),
      reply: reply<void>(),
    },
    /**
     * What main has for a pull request's tab now, which `pull`, `files` and `local` then keep up
     * to date: nothing for a tab that isn't a pull request's.
     */
    state: {
      input: byId,
      reply: reply<{ pull: PullView; files: Files | undefined; local: Local } | undefined>(),
    },
    /** Shows the newer push on a pull request's tab, and the local copy at it. */
    reload: { input: byId, reply: reply<void>() },
    /** Tries again now what failed on a pull request's tab: reading it, and its local copy. */
    retry: { input: byId, reply: reply<void>() },
    /**
     * Opens a pull request's tab with one of the accounts that can see it, when several can, and
     * remembers it for the repository's owner.
     */
    choose: { input: z.strictObject({ id: tabId, login }), reply: reply<void>() },
    /** Puts text on the clipboard: 1 MiB at most. */
    copy: {
      input: z.strictObject({ text: z.string().refine(fitsCopy, 'Too much to copy.') }),
      reply: reply<void>(),
    },
    /** Opens a page on github.com in the browser. Nothing else opens. */
    openExternal: {
      input: z.strictObject({
        url: z.string().max(8192).refine(isGithubPage, 'Not a page on github.com.'),
      }),
      reply: reply<void>(),
    },
  },
  topics: {
    /** The tabs, each time they change. */
    tabs,
    /** A pull request's tab, each time what it shows changes. */
    pull,
    /** The files a pull request's tab's pull request changes, each time the list changes. */
    files,
    /** A pull request's tab's local copy, each time it changes. */
    local,
  },
});
