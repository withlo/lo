// What a pull request's tab says in its banners, most urgent first, in the design's words: what
// happened, then what to do, with what each banner offers to do. The tab shows two at most; the
// rest are in the status bar. Nothing here draws anything.

import type { LocalState, PullView } from '../contract.ts';

/** What a banner's button does. */
export type BannerDo =
  | { kind: 'retry' }
  | { kind: 'reload' }
  /** Clears Lo's cache of local copies, then tries again. */
  | { kind: 'clearCache' }
  | { kind: 'choose'; login: string }
  /** Opens a page on github.com: GitHub's own link to fix a problem. */
  | { kind: 'link'; url: string };

export interface BannerSpec {
  /** Which banner it is, so it keeps its place as it changes. */
  readonly id: string;
  readonly tone: 'info' | 'warn' | 'danger';
  readonly title: string;
  readonly detail?: string | undefined;
  readonly actions: readonly { readonly label: string; readonly do: BannerDo }[];
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
  const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return { now, time: (at) => format.format(at) };
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
 * request, then how it stands with GitHub, then its local copy, then a newer push.
 */
export function bannersFor(
  view: PullView | undefined,
  local: LocalState | undefined,
  repository: string,
  clock: Clock,
): BannerSpec[] {
  const banners: BannerSpec[] = [];
  const retry = { label: 'Try again', do: { kind: 'retry' } } as const;
  const problem = view?.problem;
  if (problem) {
    switch (problem.kind) {
      case 'notFound':
        banners.push({
          id: 'notFound',
          tone: 'danger',
          title: "Lo can't open this pull request.",
          detail: problem.message,
          actions: [retry],
        });
        break;
      case 'blocked':
        banners.push({
          id: 'blocked',
          tone: 'danger',
          title: problem.message,
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
      case 'failed':
        banners.push({
          id: 'failed',
          tone: 'danger',
          title: "Lo couldn't read this pull request.",
          detail:
            problem.retryAt === null
              ? problem.message
              : `${problem.message} Lo tries again in ${span(problem.retryAt - clock.now)}.`,
          actions: [retry],
        });
        break;
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
  switch (local?.kind) {
    case 'noGit':
      banners.push({
        id: 'noGit',
        tone: 'warn',
        title: "Lo can't fetch a local copy without git.",
        detail: `${local.message} ${local.install}`,
        actions: [{ label: 'Check again', do: { kind: 'retry' } }],
      });
      break;
    case 'fetching':
      banners.push({
        id: 'local',
        tone: 'info',
        title: `Fetching a local copy of ${repository}.`,
        detail: local.progress === null ? undefined : capitalized(local.progress),
        actions: [],
      });
      break;
    case 'retrying':
      // Offline says it already, and the fetch tries again with it.
      if (offline && local.failure === 'network') break;
      banners.push({
        id: 'local',
        tone: 'warn',
        title: "The local copy's fetch stopped.",
        detail: `${capitalized(local.message)}. Lo tries again in ${span(local.retryAt - clock.now)}, attempt ${local.attempt + 1}.`,
        actions: [{ label: 'Retry now', do: { kind: 'retry' } }],
      });
      break;
    case 'failed':
      banners.push(
        local.failure === 'diskFull'
          ? {
              id: 'local',
              tone: 'danger',
              title: "The disk is full, so Lo can't save the local copy.",
              detail: 'Free some space, or clear the cache of local copies, then try again.',
              actions: [{ label: 'Clear the cache', do: { kind: 'clearCache' } }, retry],
            }
          : {
              id: 'local',
              tone: 'danger',
              title: "Lo couldn't fetch the local copy.",
              detail: `${capitalized(local.message)}.`,
              actions: [retry],
            },
      );
      break;
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

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
