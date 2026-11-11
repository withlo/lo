/**
 * What the poller keeps between runs of Lo, so a pull request opened again shows at once and its
 * first poll can still be free.
 */

import type { PullRef } from '../refs.ts';

/**
 * Something the poller read, as it keeps it: a JSON value, when GitHub last confirmed it, in
 * milliseconds since the Unix epoch, and for a read the poller keeps, the watched fields of the
 * check it was read at.
 */
export interface CacheEntry {
  value: unknown;
  fetchedAt: number;
  stamp?: string | undefined;
}

/** A pull request opened in a tab, for the list of recent ones. */
export interface RecentPull {
  pull: PullRef;
  /** Its title, when Lo has it. */
  title: string | undefined;
  /** The account it was opened with. */
  login: string;
  /** When it was opened. */
  openedAt: number;
}

/**
 * Where the poller keeps what it read for each account, by target (a pull request's or a
 * repository's `key`) and name. Each value is the poller's own, written by this version of Lo: a
 * store that outlives Lo forgets what another version wrote rather than hand it back.
 *
 * Every call may fail: the poller goes on without what it couldn't read or keep.
 */
export interface PollCache {
  /** What's kept as `name` for `target`, read as `login`. */
  get(login: string, target: string, name: string): Promise<CacheEntry | undefined>;
  /** Keeps each of `entries` in place of what was kept under its name, all of them or none. */
  put(
    login: string,
    target: string,
    entries: readonly { name: string; entry: CacheEntry }[],
  ): Promise<void>;
  /** Notes that GitHub confirmed what's kept as `name` at `fetchedAt`, and at `stamp` if given. */
  touch(
    login: string,
    target: string,
    name: string,
    fetchedAt: number,
    stamp?: { stamp: string | undefined },
  ): Promise<void>;
  /** Forgets what's kept as `name`. */
  remove(login: string, target: string, name: string): Promise<void>;
  /** Notes that a pull request was opened, for the list of recent ones. */
  recordRecent(recent: RecentPull): Promise<void>;
}
