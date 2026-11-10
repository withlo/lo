/**
 * How long Lo waits for a fetch. Without limits, a fetch can wait forever and say nothing, in two
 * ways, each with a limit here:
 *
 * - git's stall guard (`http.lowSpeedLimit`) gives up only on a connection that sends nothing for
 *   a minute, and GitHub's keep-alives, sent while it prepares what to send, count as something.
 *   So GitHub has a time limit to start sending: {@link FetchLimits.fetch} or
 *   {@link FetchLimits.firstFetch}. Once the objects come in, a slow fetch may take as long as it
 *   needs, as long as it gets further: {@link FetchLimits.stall}.
 * - curl's stall guard doesn't cover connecting, which it gives 300 s per request, and git has no
 *   setting for that. So Lo watches for GitHub's first answer: {@link FetchLimits.connect}.
 */

/** How long Lo waits for each part of a fetch, in milliseconds. Tests make them short. */
export interface FetchLimits {
  /**
   * The longest git may take to get GitHub's first answer: looking its name up, connecting, TLS
   * and the first request's reply.
   */
  readonly connect: number;
  /**
   * The longest a fetch into a clone that has history may take before the objects start coming
   * in: connecting, and GitHub working out what to send and preparing it.
   */
  readonly fetch: number;
  /**
   * The same for a fetch that may bring a repository's whole contents at once: the first fetch
   * into a new clone, which brings the history it needs, a checkout's files, which may be its
   * whole tree, and a download of more than 500 files.
   */
  readonly firstFetch: number;
  /**
   * Once the objects come in, the longest git may go without getting further: no more objects
   * or bytes in, no more deltas resolved.
   */
  readonly stall: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The limits the app uses. */
export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  // A connection to GitHub takes well under a second; this leaves room for a slow proxy or
  // network without letting a dead route take curl's 5 minutes.
  connect: 30 * SECOND,
  // Fetches into a clone take seconds. GitHub can take a minute to prepare a pack for a fork
  // network whose history the clone lacks.
  fetch: 2 * MINUTE,
  // GitHub counts a big repository's whole history first.
  firstFetch: 10 * MINUTE,
  // git says how far it has got once a second while objects or bytes come in, and whenever the
  // percentage of objects or deltas done changes. Past "Resolving deltas", it's quiet only while
  // it writes the pack's index and the refs, which takes seconds. curl's stall guard ends a
  // connection that sends nothing for a minute; this ends one GitHub keeps alive without sending
  // more.
  stall: 2 * MINUTE,
};

/**
 * The limit for a fetch to get its first objects: {@link FetchLimits.firstFetch} for one that may
 * bring a repository's whole contents at once (`whole`), and {@link FetchLimits.fetch} for the
 * rest.
 */
export function startLimit(limits: FetchLimits, whole: boolean): number {
  return whole ? limits.firstFetch : limits.fetch;
}

/**
 * A duration in milliseconds as Lo writes it in messages: "45 s", "2 min" or "2 min 5 s", and for
 * the short limits tests use, "0.3 s" or "5 ms". A whole number of seconds is written without a
 * fraction, so a count-up in whole seconds reads "4 s", "5 s"…
 */
export function formatDuration(milliseconds: number): string {
  const ms = Math.max(0, Math.floor(milliseconds));
  if (ms < 100) return `${ms} ms`;
  const seconds = Math.floor(ms / SECOND);
  if (seconds < 10 && ms % SECOND !== 0) return `${(ms / SECOND).toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
