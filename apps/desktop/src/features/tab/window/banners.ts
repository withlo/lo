// What a pull request's tab says in its banners, most urgent first, in the design's words: what
// happened, then what to do, with what each banner offers to do. The tab shows two at most; the
// rest are in the status bar. Nothing here draws anything.

import { explain, gitWords } from '../../../window/explain.ts';
import type { FetchFailure, LocalState, PullView } from '../contract.ts';

/** What a banner's button does. */
export type BannerDo =
  | { kind: 'retry' }
  | { kind: 'reload' }
  /** Clears Lo's cache of local copies, then tries again. */
  | { kind: 'clearCache' }
  | { kind: 'choose'; login: string }
  /** Signs in with GitHub, for a pull request no account signed in can see. */
  | { kind: 'signIn' }
  /** Closes the tab. */
  | { kind: 'close' }
  /** Opens a page on github.com: GitHub's own link to fix a problem. */
  | { kind: 'link'; url: string }
  /** Shows another layer of the tab's stack: the pull request the tab opened on. */
  | { kind: 'layer'; number: number };

export interface BannerSpec {
  /** Which banner it is, so it keeps its place as it changes. */
  readonly id: string;
  readonly tone: 'info' | 'warn' | 'danger';
  readonly title: string;
  readonly detail?: string | undefined;
  /** What GitHub or Git said, as it came, for Details: never in the title or the line. */
  readonly details?: string | undefined;
  readonly actions: readonly { readonly label: string; readonly do: BannerDo }[];
}

/** The pull request a tab shows: by its repository and number. */
export interface Shown {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** The most banners a tab shows at once. */
export const MOST_BANNERS = 2;

/** How times read: the clock, and how long until or since. */
export interface Clock {
  readonly now: number;
  /** "14:02". */
  time(at: number): string;
}

/** A clock in the system's locale. */
export function systemClock(now: number): Clock {
  return { now, time: (at) => timeFormat().format(at) };
}

let format: Intl.DateTimeFormat | undefined;

/** The system's way of writing a time of day, made once: making one takes a while. */
function timeFormat(): Intl.DateTimeFormat {
  format ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return format;
}

/** "12 s", "4 minutes", "2 hours": a wait, for what counts down, rounded up. */
export function span(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  return whole(Math.ceil(seconds / 60) * 60) ?? `${seconds} s`;
}

/** How long before `now` `then` was, in words: "just now", "5 minutes ago", "2 hours ago". */
export function ago(then: number, now: number): string {
  const said = whole(Math.floor(Math.max(0, now - then) / 1000));
  return said === undefined ? 'just now' : `${said} ago`;
}

/** How long after `now` `then` is, in words: "in a moment", "in 5 minutes". */
export function inWords(then: number, now: number): string {
  const said = whole(Math.floor(Math.max(0, then - now) / 1000));
  return said === undefined ? 'in a moment' : `in ${said}`;
}

/** `seconds` in the largest whole unit, or nothing under a minute. */
function whole(seconds: number): string | undefined {
  if (seconds < 60) return undefined;
  const [count, unit] =
    seconds < 3_600
      ? [Math.floor(seconds / 60), 'minute']
      : seconds < 86_400
        ? [Math.floor(seconds / 3_600), 'hour']
        : [Math.floor(seconds / 86_400), 'day'];
  if (count === 1) return unit === 'hour' ? 'an hour' : `a ${unit}`;
  return `${count} ${unit}s`;
}

/** "abc1234": a commit by the start of its ID. */
export function short(oid: string): string {
  return oid.slice(0, 7);
}

/**
 * Every banner a pull request's tab could show now, most urgent first: why it can't show its pull
 * request, then how it stands with GitHub, then its local copy, then a newer push. `own` is the
 * pull request the tab opened on, when the view on screen is another layer of its stack, which a
 * layer that can't be opened, such as one deleted since the tab showed it, offers to go back to.
 */
export function bannersFor(
  view: PullView | undefined,
  local: LocalState | undefined,
  shown: Shown,
  clock: Clock,
  own?: number,
): BannerSpec[] {
  const banners: BannerSpec[] = [];
  const repository = `${shown.owner}/${shown.repo}`;
  const retry = { label: 'Try again', do: { kind: 'retry' } } as const;
  const tryNow = { label: 'Try now', do: { kind: 'retry' } } as const;
  const cantOpen = `Can’t open #${shown.number}`;
  const problem = view?.problem;
  if (problem) {
    switch (problem.kind) {
      case 'notFound': {
        // Missing, or hidden from whoever asked: signing in may show it, and GitHub's page says
        // which; or the tab can go.
        const signIn =
          problem.cause.kind === 'private' && !problem.cause.signedIn
            ? [{ label: 'Sign in with GitHub…', do: { kind: 'signIn' } } as const]
            : [];
        const page = `https://github.com/${repository}/pull/${shown.number}`;
        banners.push({
          id: 'notFound',
          tone: 'danger',
          title: cantOpen,
          detail: explain(problem.cause),
          details: problem.details,
          actions:
            own === undefined
              ? [
                  ...signIn,
                  { label: 'Open on GitHub', do: { kind: 'link', url: page } },
                  { label: 'Close tab', do: { kind: 'close' } },
                ]
              : [{ label: `Show #${own}`, do: { kind: 'layer', number: own } }],
        });
        break;
      }
      case 'blocked':
        banners.push({
          id: 'blocked',
          tone: 'danger',
          title: cantOpen,
          detail: explain(problem.cause),
          details: problem.details,
          actions: [
            ...problem.links.map((link) => ({
              label: link.label,
              do: { kind: 'link', url: link.url } as const,
            })),
            retry,
          ],
        });
        break;
      case 'ask':
        banners.push({
          id: 'ask',
          tone: 'info',
          title: `More than one account can see ${repository}.`,
          detail:
            "Choose which to review it as. Lo remembers your choice for the repository's owner.",
          actions: problem.logins.map((login) => ({
            label: `Use ${login}`,
            do: { kind: 'choose', login } as const,
          })),
        });
        break;
      case 'failed': {
        const counting = problem.retryAt !== null;
        banners.push({
          id: 'failed',
          tone: 'danger',
          title: cantOpen,
          detail: line(
            explain(problem.cause),
            problem.retryAt === null ? undefined : retrying(problem.retryAt, clock),
          ),
          details: problem.details,
          actions: [counting ? tryNow : retry],
        });
        break;
      }
      default:
        problem satisfies never;
    }
  }
  const connection = view?.connection;
  switch (connection?.kind) {
    case 'signedOut':
      banners.push({
        id: 'signedOut',
        tone: 'danger',
        title: `${connection.login} is signed out.`,
        detail: `GitHub refused ${connection.login}'s token. Sign in to it again to see what's changed.`,
        actions: [],
      });
      break;
    case 'rateLimited': {
      const whose = connection.login === null ? 'without signing in' : `for ${connection.login}`;
      banners.push({
        id: 'rateLimited',
        tone: 'warn',
        title: connection.secondary
          ? 'GitHub asked Lo to slow down.'
          : `GitHub's rate limit ${whose} is used up.`,
        detail: `Nothing updates until it resets at ${clock.time(connection.until)}, ${inWords(connection.until, clock.now)}.`,
        actions: [],
      });
      break;
    }
    case 'offline': {
      const saved =
        connection.savedAt === null
          ? "Lo can't reach GitHub."
          : `Showing what Lo saved ${ago(connection.savedAt, clock.now)}.`;
      const again =
        connection.retryAt === null
          ? ''
          : ` Lo tries again ${inWords(connection.retryAt, clock.now)}.`;
      banners.push({
        id: 'offline',
        tone: 'warn',
        title: "You're offline.",
        detail: `${saved}${again}`,
        actions: [retry],
      });
      break;
    }
    case 'live':
    case 'limitLow':
    case undefined:
      break;
    default:
      connection satisfies never;
  }
  const offline = connection?.kind === 'offline';
  const login = view?.acting?.kind === 'account' ? view.acting.login : undefined;
  switch (local?.kind) {
    case 'noGit': {
      const words = gitWords(local.git);
      banners.push({
        id: 'noGit',
        tone: 'warn',
        title: words.title,
        detail: words.reason,
        details: [...words.commands, words.page, words.details].filter(Boolean).join('\n'),
        actions: [{ label: 'Check again', do: { kind: 'retry' } }],
      });
      break;
    }
    case 'fetching':
      banners.push({
        id: 'local',
        tone: 'info',
        title: `Fetching a local copy of ${repository}.`,
        detail: local.progress === null ? undefined : capitalized(local.progress),
        actions: [],
      });
      break;
    case 'retrying': {
      // Offline says it already, and the fetch tries again with it.
      if (offline && local.failure === 'network') break;
      const held = heldBy(local.failure, repository);
      banners.push({
        id: 'local',
        tone: 'warn',
        title: held === undefined ? CANT_FETCH : CANT_USE,
        detail: line(
          held ?? fetchReason(local.failure, repository, login),
          retrying(local.retryAt, clock),
        ),
        details: local.details,
        actions: [tryNow],
      });
      break;
    }
    case 'failed': {
      const held = heldBy(local.failure, repository);
      banners.push({
        id: 'local',
        tone: 'danger',
        title: held === undefined ? CANT_FETCH : CANT_USE,
        detail: held ?? fetchReason(local.failure, repository, login),
        details: local.details,
        actions:
          local.failure === 'diskFull'
            ? [{ label: 'Clear cache', do: { kind: 'clearCache' } }]
            : local.failure === 'auth'
              ? [{ label: 'Sign in with GitHub…', do: { kind: 'signIn' } }]
              : held === undefined
                ? [retry]
                : [],
      });
      break;
    }
    case 'waiting':
    case 'ready':
    case undefined:
      break;
    default:
      local satisfies never;
  }
  if (view?.newer && view.shown) {
    banners.push({
      id: 'newer',
      tone: 'info',
      title: 'There’s a newer push.',
      detail: `You're reading ${short(view.shown)}, and it stays on screen until you load the newer one.`,
      actions: [{ label: 'Load the newer push', do: { kind: 'reload' } }],
    });
  }
  return banners;
}

/** The title of a local copy that can't be fetched, for as long as it can't. */
const CANT_FETCH = 'Can’t fetch the local copy';

/** The title of a local copy that can't be trusted and can't be made again yet. */
const CANT_USE = 'Can’t use the local copy';

/** A reason and what follows it, on one line: nothing when there's neither. */
function line(...parts: readonly (string | undefined)[]): string | undefined {
  const said = parts.filter((part) => part !== undefined && part !== '');
  return said.length === 0 ? undefined : said.join(' ');
}

/** "Retrying in 20 s.": the wait before Lo tries again by itself. */
function retrying(at: number, clock: Clock): string {
  return `Retrying in ${span(at - clock.now)}.`;
}

/**
 * Why a local copy that can't be trusted can't be made again yet: a tab of the repository has it
 * open, or a language server runs on it. Nothing for any other failure.
 */
function heldBy(failure: FetchFailure, repository: string): string | undefined {
  if (failure === 'heldByTabs') return `It’s made again once every tab of ${repository} closes.`;
  if (failure === 'heldByServers') return 'It’s made again once its language servers stop.';
  return undefined;
}

/**
 * Why fetching the local copy failed, as the guide's causes word it, for `repository`, asked as
 * `login` if as anyone: nothing where the cause isn't known, or where only the wait is worth
 * saying, as for a sign-in that's being renewed.
 */
function fetchReason(
  failure: FetchFailure,
  repository: string,
  login: string | undefined,
): string | undefined {
  switch (failure) {
    case 'network':
      return explain({ kind: 'offline' });
    case 'certificate':
      return explain({ kind: 'certificate' });
    case 'rateLimited':
      return explain({ kind: 'rateLimit', resets: null });
    case 'timedOut':
      return explain({ kind: 'timeout' });
    case 'diskFull':
      return explain({ kind: 'diskFull' });
    case 'auth':
      return `${repository} doesn’t exist, or it’s private.`;
    case 'repoNotFound':
      return login === undefined
        ? `${repository} doesn’t exist, or it’s private.`
        : `${repository} doesn’t exist, or ${login} can’t see it.`;
    case 'refNotFound':
    case 'unavailable':
      return 'This revision’s commit is no longer on GitHub.';
    case 'tooLarge':
      return 'The download is too large.';
    case 'heldByTabs':
    case 'heldByServers':
    case 'tokenRefused':
    case 'other':
      return undefined;
    default:
      failure satisfies never;
      return undefined;
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
