/**
 * How often to poll: by tier, by whether Lo is in the foreground, and by how much of GitHub's rate
 * limit is left (`docs/design.md`, "Rate limit").
 *
 * Times are milliseconds: wall-clock times since the Unix epoch, and waits.
 */

import { fractionLeft, RESET_HORIZON, type RateLimits } from '../rate-limit.ts';

/** The resources polling spends: REST requests and GraphQL points. */
const RESOURCES = ['core', 'graphql'] as const;

/** The polling schedule and the rate-limit governor's thresholds. */
export interface PollConfig {
  /** The open pull request, while Lo is in the foreground: 20 s, within the design's 15–30 s. */
  openInterval: number;
  /** Every other watched pull request, and the open pull requests of each watched repository, in the foreground. */
  watchedInterval: number;
  /** Everything, while Lo is in the background. */
  backgroundInterval: number;
  /**
   * The longest the open pull request's details go without being fetched in full while Lo is in
   * the foreground. Viewed marks set elsewhere change nothing a cheaper poll sees.
   */
  detailsMaxAge: number;
  /** Below this share of a rate limit left, every interval doubles. */
  slowBelow: number;
  /** Below this share, only the open pull request is polled, at most every `openOnlyInterval`. */
  openOnlyBelow: number;
  openOnlyInterval: number;
  /** After a network error: the first wait before trying again, doubling up to `offlineMaxWait`. */
  offlineFirstWait: number;
  offlineMaxWait: number;
  /**
   * After a secondary rate limit without a `retry-after`: the wait for the first one in a row,
   * doubling with each after it (those with a `retry-after` count too) up to `secondaryMaxWait`.
   * GitHub asks for at least a minute.
   */
  secondaryFirstWait: number;
  secondaryMaxWait: number;
  /** The most of each backoff wait taken off at random, so retries don't line up. */
  jitter: number;
  /** The least time between the end of one write and the start of the next. GitHub asks for a second between mutations. */
  writeSpacing: number;
  /**
   * The longest the poller sleeps before working out again what's due. Timers don't run while the
   * computer sleeps, so a pause until a rate limit's reset is checked against the wall clock at
   * least this often.
   */
  maxWait: number;
  /** Wall-clock time, for rate-limit resets and the age of what was read. */
  now: () => number;
  /** A clock that only moves forward, and not while the computer sleeps, for intervals. */
  monotonic: () => number;
  /** A number from 0 to 1 to take jitter by. */
  random: () => number;
}

/** Lo's polling schedule, with `overrides`. */
export function pollConfig(overrides: Partial<PollConfig> = {}): PollConfig {
  return {
    openInterval: 20_000,
    watchedInterval: 2 * 60_000,
    backgroundInterval: 5 * 60_000,
    detailsMaxAge: 5 * 60_000,
    slowBelow: 0.2,
    openOnlyBelow: 0.05,
    openOnlyInterval: 2 * 60_000,
    offlineFirstWait: 20_000,
    offlineMaxWait: 5 * 60_000,
    secondaryFirstWait: 60_000,
    secondaryMaxWait: 15 * 60_000,
    jitter: 0.2,
    writeSpacing: 1000,
    maxWait: 60_000,
    now: () => Date.now(),
    monotonic: () => performance.now(),
    random: Math.random,
    ...overrides,
  };
}

/** Which schedule a poll follows: the pull request in the active tab, or everything else watched. */
export type Tier = 'open' | 'watched';

/** A rate limit running low. */
export interface LowLimit {
  /** `core` (REST) or `graphql`. */
  resource: string;
  remaining: number;
  limit: number;
  /** When the limit resets. */
  reset: number;
}

/** Why polling is paused: a limit is used up, or GitHub's secondary limits kicked in. */
export type PauseReason = { kind: 'usedUp'; resource: string } | { kind: 'secondary' };

/**
 * How the rate limit is shaping polling, for a banner (`docs/design.md`, "Rate limit", and "Rate
 * limit used up" under "Errors and edge cases").
 */
export type RateLimitState =
  /** Plenty left. */
  | { kind: 'normal' }
  /** Under 20% left: every interval is doubled. "Polling slowed: GitHub rate limit low." */
  | { kind: 'slowed'; low: LowLimit }
  /** Under 5% left: only the open pull request is polled, every 2 minutes. */
  | { kind: 'openOnly'; low: LowLimit }
  /** Nothing is polled until `until`: "GitHub rate limit used up. Resets at <time>." */
  | { kind: 'paused'; until: number; reason: PauseReason };

/** A pause GitHub asked for in an error, rather than in its rate-limit headers. */
export interface Cooldown {
  until: number;
  reason: PauseReason;
}

const SEVERITY: Record<RateLimitState['kind'], number> = {
  normal: 0,
  slowed: 1,
  openOnly: 2,
  paused: 3,
};

/**
 * The governor's verdict at `now`: the worst state any resource is in. A window whose reset has
 * passed has started over, so it doesn't count.
 */
export function rateLimitState(
  limits: RateLimits,
  cooldown: Cooldown | undefined,
  now: number,
  config: PollConfig,
): RateLimitState {
  let worst: RateLimitState = { kind: 'normal' };
  const consider = (candidate: RateLimitState): void => {
    const worse =
      worst.kind === 'paused' && candidate.kind === 'paused'
        ? candidate.until > worst.until
        : SEVERITY[candidate.kind] > SEVERITY[worst.kind];
    if (worse) worst = candidate;
  };
  if (cooldown && cooldown.until > now) {
    consider({ kind: 'paused', until: cooldown.until, reason: cooldown.reason });
  }
  for (const resource of RESOURCES) {
    const limit = limits.get(resource);
    if (!limit) continue;
    const reset = limit.reset * 1000;
    // A reset further off than any window GitHub keeps, as from a proxy's nonsense header or a
    // clock off by hours, isn't one Lo waits for: a refused request still pauses polling, for an
    // hour at most.
    if (reset <= now || reset > now + RESET_HORIZON * 1000) continue;
    const low: LowLimit = { resource, remaining: limit.remaining, limit: limit.limit, reset };
    if (limit.remaining === 0) {
      consider({ kind: 'paused', until: reset, reason: { kind: 'usedUp', resource } });
    } else if (fractionLeft(limit) < config.openOnlyBelow) {
      consider({ kind: 'openOnly', low });
    } else if (fractionLeft(limit) < config.slowBelow) {
      consider({ kind: 'slowed', low });
    }
  }
  return worst;
}

/** How long between polls of a tier, or nothing when the tier isn't polled at all. */
export function interval(
  tier: Tier,
  foreground: boolean,
  state: RateLimitState,
  config: PollConfig,
): number | undefined {
  const base = !foreground
    ? config.backgroundInterval
    : tier === 'open'
      ? config.openInterval
      : config.watchedInterval;
  switch (state.kind) {
    case 'normal':
      return base;
    case 'slowed':
      return base * 2;
    case 'openOnly':
      return tier === 'open' ? Math.max(base, config.openOnlyInterval) : undefined;
    case 'paused':
      return undefined;
    default:
      return state satisfies never;
  }
}

/**
 * The wait before try number `attempt` (from 1): `first` doubling up to `max`, less up to
 * `jitter` of it at random (`random` is from 0 to 1).
 */
export function backoff(
  attempt: number,
  first: number,
  max: number,
  jitter: number,
  random: number,
): number {
  const doublings = Math.min(Math.max(attempt - 1, 0), 31);
  const wait = Math.min(first * 2 ** doublings, max);
  return wait * (1 - clamp(jitter) * clamp(random));
}

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
