// What a pull request's tab says in its banners, most urgent first, in the design's words: what
// happened, then what to do, with what each banner offers to do. The tab shows two at most; the
// rest are in the status bar. Nothing here draws anything.

import type { LocalState, PullView } from '../contract.ts';

/** What a banner's button does. */
export type BannerDo =
  | { kind: 'retry' }
  | { kind: 'reload' }
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

/** "12 s", "4 minutes", "2 hours": a while, rounded up to what reads well. */
export function span(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute' : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
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
        detail: "GitHub refused Lo's token. Sign in to it again to see what's changed.",
        actions: [],
      });
      break;
    case 'rateLimited':
      banners.push({
        id: 'rateLimited',
        tone: 'warn',
        title:
          connection.login === null
            ? "GitHub's limit for reading without signing in is used up."
            : `GitHub's rate limit for ${connection.login} is used up.`,
        detail: `It resets at ${clock.time(connection.until)}, in ${span(connection.until - clock.now)}. Lo asks again then.`,
        actions: [],
      });
      break;
    case 'offline':
      banners.push({
        id: 'offline',
        tone: 'warn',
        title: "You're offline.",
        detail:
          connection.savedAt === null
            ? "Lo can't reach GitHub, and tries again by itself."
            : `Showing what Lo saved ${span(clock.now - connection.savedAt)} ago.`,
        actions: [retry],
      });
      break;
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
        actions: [],
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
              detail: 'Free some space, or clear Lo’s cache in Settings, then try again.',
              actions: [retry],
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
