// What a pull request's tab says of itself, in the design's words, and where each thing is said,
// once: a tab that can't show its pull request says why in place of its view; how it stands with
// GitHub is the header's chip and its details; its local copy is its status bar item and its
// details; and a change to the pull request, a newer push, is its banner. Nothing here draws
// anything.

import type { Connection, LocalState, PullView } from '../contract.ts';

/** What a button the tab offers does. */
export type BannerDo =
  | { kind: 'retry' }
  | { kind: 'reload' }
  /** Clears Lo's cache of local copies, then tries again. */
  | { kind: 'clearCache' }
  | { kind: 'choose'; login: string }
  /** Signs in again, for an account GitHub signed out. */
  | { kind: 'signIn' }
  /** Opens a page on github.com: GitHub's own link to fix a problem. */
  | { kind: 'link'; url: string }
  /** Shows another layer of the tab's stack: the pull request the tab opened on. */
  | { kind: 'layer'; number: number };

/** Something the tab says, in one shape wherever it shows: a banner, a view, an item's details. */
export interface BannerSpec {
  /** Which it is, so it keeps its place as it changes. */
  readonly id: string;
  readonly tone: 'info' | 'warn' | 'danger';
  readonly title: string;
  readonly detail?: string | undefined;
  /** When Lo tries again by itself, which the line counts down to after the detail. */
  readonly retryAt?: number | undefined;
  /** The first is the one thing to do about it; a failed view offers the rest beside it. */
  readonly actions: readonly { readonly label: string; readonly do: BannerDo }[];
}

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

/** "12 s", "4 min", "2 h": a wait, for what counts down, rounded up. */
export function span(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  return whole(Math.ceil(seconds / 60) * 60) ?? `${seconds} s`;
}

/** How long before `now` `then` was: "just now", "5 min ago", "2 h ago". */
export function ago(then: number, now: number): string {
  const said = whole(Math.floor(Math.max(0, now - then) / 1000));
  return said === undefined ? 'just now' : `${said} ago`;
}

/** `seconds` in the largest whole unit, or nothing under a minute. */
function whole(seconds: number): string | undefined {
  if (seconds < 60) return undefined;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}

/** "abc1234": a commit by the start of its ID. */
export function short(oid: string): string {
  return oid.slice(0, 7);
}

/**
 * Why a tab can't show its pull request, which takes the place of its view, or nothing while it
 * can: GitHub has no such pull request or won't show it, an organization blocks the account, or
 * reading it failed. `number` is the pull request on screen, and `own` the one the tab opened on,
 * when that's another layer of its stack, which a layer that can't be opened offers to go back to.
 * Several accounts that could see it are a choice, not a failure: see {@link accountChoice}.
 */
export function failureOf(
  view: PullView | undefined,
  number: number,
  own?: number,
): BannerSpec | undefined {
  const retry = { label: 'Try again', do: { kind: 'retry' } } as const;
  const title = `Can’t open #${number}`;
  const problem = view?.problem;
  switch (problem?.kind) {
    case 'notFound':
      return {
        id: 'notFound',
        tone: 'danger',
        title,
        detail: problem.message,
        actions:
          own === undefined
            ? [retry]
            : [{ label: `Show #${own}`, do: { kind: 'layer', number: own } }, retry],
      };
    case 'blocked':
      return {
        id: 'blocked',
        tone: 'danger',
        title,
        detail: problem.message,
        actions: [
          ...problem.links.map((link) => ({
            label: link.label,
            do: { kind: 'link', url: link.url } as const,
          })),
          retry,
        ],
      };
    case 'failed':
      return {
        id: 'failed',
        tone: 'danger',
        title,
        detail: problem.message,
        retryAt: problem.retryAt ?? undefined,
        actions: [problem.retryAt === null ? retry : { label: 'Try now', do: { kind: 'retry' } }],
      };
    case 'ask':
    case undefined:
      return undefined;
    default:
      problem satisfies never;
      return undefined;
  }
}

/** Which account to open a pull request as, when more than one can see it and none was chosen. */
export interface AccountChoice {
  readonly title: string;
  readonly line: string;
  readonly logins: readonly string[];
}

/** The choice of account a tab waits on, which takes the place of its view, or nothing. */
export function accountChoice(
  view: PullView | undefined,
  number: number,
  owner: string,
): AccountChoice | undefined {
  if (view?.problem?.kind !== 'ask') return undefined;
  const { logins } = view.problem;
  return {
    title: `Choose an account for #${number}`,
    line: `${logins.length} of your accounts can see it. Remembered for every ${owner} repo.`,
    logins,
  };
}

/** How a tab stands with GitHub, when it isn't as usual: the header's chip, and its details. */
export interface ConnectionNote {
  readonly tone: 'warn' | 'danger';
  /** The chip's one or two words: "Offline". */
  readonly label: string;
  /** Its details' line, from the guide's causes: "GitHub’s rate limit resets at 14:05." */
  readonly line: string;
  /** When Lo tries again by itself, which the line counts down to. */
  readonly retryAt?: number | undefined;
  /** When what's shown was last read from GitHub, for "Checked 5 min ago". */
  readonly checked?: number | undefined;
  /** What GitHub or the network said, as it came, for Details. */
  readonly details?: string | undefined;
  /** The one thing to do about it, if there's anything. */
  readonly action?: { readonly label: string; readonly do: BannerDo } | undefined;
}

/**
 * How the tab stands with GitHub, for the header's chip, or nothing while all is well. The rate
 * limit running low is the status bar's to say, since it changes nothing on screen.
 */
export function connectionNote(
  connection: Connection | undefined,
  clock: Clock,
): ConnectionNote | undefined {
  switch (connection?.kind) {
    case 'signedOut':
      return {
        tone: 'danger',
        label: 'Signed out',
        line: `${connection.login} is signed out.`,
        action: { label: 'Sign in again', do: { kind: 'signIn' } },
      };
    case 'rateLimited':
      // One wording, whoever the limit is for, and whether GitHub asked Lo to slow down.
      return {
        tone: 'warn',
        label: 'Rate limit reached',
        line: `GitHub’s rate limit resets at ${clock.time(connection.until)}.`,
      };
    case 'offline':
      return {
        tone: 'warn',
        label: 'Offline',
        line: 'Offline.',
        retryAt: connection.retryAt ?? undefined,
        checked: connection.savedAt ?? undefined,
        details: connection.error === '' ? undefined : connection.error,
        action: {
          label: connection.retryAt === null ? 'Try again' : 'Try now',
          do: { kind: 'retry' },
        },
      };
    case 'live':
    case 'limitLow':
    case undefined:
      return undefined;
    default:
      connection satisfies never;
      return undefined;
  }
}

/** The local copy, as its status bar item says it: its ball, its label and its details. */
export interface LocalNote {
  readonly ball: 'off' | 'working' | 'ready' | 'warn' | 'failed';
  readonly label: string;
  /** The details' one line, for a copy that's there: the commit it's at. */
  readonly at?: string | undefined;
  /** Why it can't be fetched, for its details, with what to do about it. */
  readonly problem?: BannerSpec | undefined;
}

/** "62%": how far a fetch has got, from what git said it's doing, if it said. */
function percentOf(progress: string | null): string | undefined {
  return progress?.match(/(\d+)%/)?.[0];
}

const CANT_FETCH = 'Can’t fetch the local copy';

/**
 * The local copy's item, or nothing before the tab has one. A fetch that stopped because GitHub
 * can't be reached is only offline: the header's chip says that, and the fetch tries again with it.
 */
export function localNote(
  local: LocalState | undefined,
  connection: Connection | undefined,
): LocalNote | undefined {
  const retry = { label: 'Try again', do: { kind: 'retry' } } as const;
  switch (local?.kind) {
    case undefined:
      return undefined;
    case 'waiting':
      return { ball: 'off', label: 'Local copy' };
    case 'noGit':
      return {
        ball: 'failed',
        label: 'Can’t find Git',
        problem: {
          id: 'noGit',
          tone: 'warn',
          title: 'Can’t find Git',
          detail: `${local.message} ${local.install}`,
          actions: [{ label: 'Check again', do: { kind: 'retry' } }],
        },
      };
    case 'fetching': {
      const percent = percentOf(local.progress);
      return {
        ball: 'working',
        label: percent === undefined ? 'Fetching local copy…' : `Fetching local copy · ${percent}`,
      };
    }
    case 'ready':
      return local.offline
        ? { ball: 'warn', label: 'Local copy · offline', at: short(local.head) }
        : { ball: 'ready', label: 'Local copy', at: short(local.head) };
    case 'retrying':
      if (connection?.kind === 'offline' && local.failure === 'network') {
        return { ball: 'warn', label: 'Local copy · offline' };
      }
      return {
        ball: 'failed',
        label: CANT_FETCH,
        problem: {
          id: 'local',
          tone: 'warn',
          title: CANT_FETCH,
          detail: `${capitalized(local.message)}.`,
          retryAt: local.retryAt,
          actions: [{ label: 'Try now', do: { kind: 'retry' } }],
        },
      };
    case 'failed':
      return {
        ball: 'failed',
        label: CANT_FETCH,
        problem:
          local.failure === 'diskFull'
            ? {
                id: 'local',
                tone: 'danger',
                title: CANT_FETCH,
                detail: 'The disk is full.',
                actions: [{ label: 'Clear cache', do: { kind: 'clearCache' } }],
              }
            : {
                id: 'local',
                tone: 'danger',
                title: CANT_FETCH,
                detail: `${capitalized(local.message)}.`,
                actions: [retry],
              },
      };
    default:
      local satisfies never;
      return undefined;
  }
}

/**
 * The tab's own banners, for a change to its pull request: a newer push than the one on screen,
 * until it's shown or the reader dismisses it. `dismissed` is the newer push the reader dismissed.
 */
export function bannersFor(view: PullView | undefined, dismissed?: string | null): BannerSpec[] {
  if (!view?.newer || !view.shown || view.newer === dismissed) return [];
  return [
    {
      id: 'newer',
      tone: 'info',
      title: 'There’s a newer push',
      actions: [{ label: 'Show latest', do: { kind: 'reload' } }],
    },
  ];
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
