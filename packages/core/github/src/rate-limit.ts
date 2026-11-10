/**
 * How much of GitHub's rate limit an account has left.
 *
 * GitHub reports it in `x-ratelimit-*` headers on every response, per resource (`core` for REST,
 * `graphql`, `search` and so on), and in a GraphQL query's `rateLimit` field. The budget is per
 * user and shared with everything else the user runs, such as `gh`.
 */

/**
 * How far ahead a limit's reset can be and still be one Lo believes, in seconds: GitHub's windows
 * are an hour long, and clocks can be a few minutes apart. A reset further off, as from a proxy's
 * nonsense header, isn't recorded, so it can't stand in for every answer after it.
 */
export const RESET_HORIZON = 65 * 60;

/**
 * How far apart, in seconds, two answers' reset times can be and still be one window: a GraphQL
 * query's `rateLimit.resetAt` and its headers' `x-ratelimit-reset` can differ by a second.
 */
export const SAME_WINDOW = 2;

/** The farthest reset Lo reads as a time, in seconds since the Unix epoch: in 2106. */
const FARTHEST_RESET = 2 ** 32 - 1;

/** One resource's limit. */
export interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  /** When the window resets, in seconds since the Unix epoch. */
  reset: number;
}

/**
 * When the window resets. A reset too far off to be a time, as a proxy's nonsense header gives,
 * reads as the farthest one Lo takes, in 2106; whoever waits for it caps the wait.
 */
export function resetTime(limit: RateLimit): Date {
  return new Date(Math.min(limit.reset, FARTHEST_RESET) * 1000);
}

/** The share of the limit left, from 0 to 1. */
export function fractionLeft(limit: RateLimit): number {
  return limit.limit === 0 ? 0 : limit.remaining / limit.limit;
}

/** GraphQL's `rateLimit { cost limit remaining used resetAt }`. */
export interface GraphQLRateLimit {
  cost?: number | null;
  limit: number;
  remaining: number;
  used: number;
  resetAt: string;
}

/** An account's limits, by resource. */
export class RateLimits {
  readonly #resources = new Map<string, RateLimit>();
  /** What the last GraphQL query that asked for `rateLimit { cost }` cost, in points. */
  lastGraphQLCost: number | undefined;

  get(resource: string): RateLimit | undefined {
    const limit = this.#resources.get(resource);
    return limit && { ...limit };
  }

  /** The REST API's limit. */
  core(): RateLimit | undefined {
    return this.get('core');
  }

  graphql(): RateLimit | undefined {
    return this.get('graphql');
  }

  /** A copy, which later answers don't change. */
  clone(): RateLimits {
    const copy = new RateLimits();
    for (const [resource, limit] of this.#resources) copy.#resources.set(resource, { ...limit });
    copy.lastGraphQLCost = this.lastGraphQLCost;
    return copy;
  }

  /**
   * Records a limit GitHub reported.
   *
   * GitHub's servers can disagree from one response to the next, so within one window (reset
   * times at most {@link SAME_WINDOW} apart) this keeps the lowest `remaining` seen. A later reset
   * time starts a new window, and an answer from an earlier window, from a server that hasn't seen
   * the reset yet, is ignored.
   */
  record(resource: string, limit: RateLimit): void {
    const known = this.#resources.get(resource);
    if (known && Math.abs(known.reset - limit.reset) <= SAME_WINDOW) {
      known.remaining = Math.min(known.remaining, limit.remaining);
      known.used = Math.max(known.used, limit.used);
      known.limit = limit.limit;
      known.reset = Math.max(known.reset, limit.reset);
    } else if (!known || limit.reset >= known.reset) {
      this.#resources.set(resource, { ...limit });
    }
  }

  /**
   * Records the limit in a response's `x-ratelimit-*` headers, if it has them, unless its reset is
   * further off than {@link RESET_HORIZON} by the response's `date`, or by the clock without one.
   */
  recordHeaders(headers: Headers): void {
    const number = (name: string): number | undefined => {
      const value = headers.get(name)?.trim();
      return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
    };
    const limit = number('x-ratelimit-limit');
    const remaining = number('x-ratelimit-remaining');
    const reset = number('x-ratelimit-reset');
    if (limit === undefined || remaining === undefined || reset === undefined) return;
    const date = Date.parse(headers.get('date') ?? '');
    if (!believable(reset, Number.isNaN(date) ? Date.now() : date)) return;
    this.record(headers.get('x-ratelimit-resource') ?? 'core', {
      limit,
      remaining,
      used: number('x-ratelimit-used') ?? Math.max(limit - remaining, 0),
      reset,
    });
  }

  /** Records a GraphQL query's `rateLimit` field. */
  recordGraphQLField(field: GraphQLRateLimit): void {
    if (field.cost != null) this.lastGraphQLCost = field.cost;
    const resetAt = Date.parse(field.resetAt);
    if (Number.isNaN(resetAt)) return;
    const reset = Math.floor(resetAt / 1000);
    if (!believable(reset, Date.now())) return;
    this.record('graphql', {
      limit: field.limit,
      remaining: field.remaining,
      used: field.used,
      reset,
    });
  }
}

/**
 * Whether a window resetting at `reset`, in seconds since the Unix epoch, is one GitHub keeps, as
 * of `now` in milliseconds: within {@link RESET_HORIZON}.
 */
function believable(reset: number, now: number): boolean {
  return reset * 1000 <= now + RESET_HORIZON * 1000;
}
