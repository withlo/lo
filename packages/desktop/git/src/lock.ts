/**
 * Locks: one process per cache, and within it, one writer per clone at a time.
 *
 * - **The cache's lock** is a file at its root naming the process that has it open. Another
 *   process finds it and refuses the cache, unless that process is gone, as after a crash. Lo's
 *   single instance per data folder already keeps a second Lo away; this keeps away anything else
 *   pointed at the same cache.
 * - **A clone's lock** is held while writing to it: a fetch, then the pins it writes, or removing
 *   a checkout and adding it again. git locks single refs and files, not a sequence of commands.
 *   Each open repository also counts as a user of its clone, and cleanup takes a clone only when
 *   it has no users and nobody holds its lock.
 */

import { link, readFile, rm, writeFile } from 'node:fs/promises';

import { GitError } from './errors.ts';
import type { Activity } from './progress.ts';

/** How often a waiter hears again that it's still waiting, in milliseconds. */
export const TELL_EVERY = 1000;

/** Lets go of a lock. Letting go twice does nothing. */
export type Release = () => void;

/** The lock on one clone: one writer at a time, and a count of the repositories open on it. */
export class CloneLock {
  /** What the holder is doing, such as "fetching pull request #12", while one holds it. */
  #holder: string | undefined;
  readonly #waiting: (() => void)[] = [];
  #users = 0;

  /** What the holder is doing, or `undefined` when nobody holds the lock. */
  get holder(): string | undefined {
    return this.#holder;
  }

  /** How many open repositories use the clone. */
  get users(): number {
    return this.#users;
  }

  /**
   * Waits for the lock, then holds it to do `what`. While it waits, `progress` hears what the
   * holder is doing, at once and every `tellEvery` milliseconds.
   */
  async acquire(
    what: string,
    progress?: (activity: Activity) => void,
    tellEvery = TELL_EVERY,
  ): Promise<Release> {
    if (this.#holder !== undefined) {
      const started = Date.now();
      const tell = () =>
        progress?.({ kind: 'waitingForLock', holder: this.#holder, waited: Date.now() - started });
      tell();
      const timer = setInterval(tell, tellEvery);
      try {
        // Woken in turn, each waiter finds the lock free: the one before let go of it.
        while (this.#holder !== undefined) {
          await new Promise<void>((resolve) => this.#waiting.push(resolve));
        }
      } finally {
        clearInterval(timer);
      }
    }
    this.#holder = what;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holder = undefined;
      this.#waiting.shift()?.();
    };
  }

  /** Holds the lock if nobody does, without waiting. */
  tryAcquire(what: string): Release | undefined {
    if (this.#holder !== undefined) return undefined;
    this.#holder = what;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holder = undefined;
      this.#waiting.shift()?.();
    };
  }

  /** Counts an open repository as a user until it lets go. */
  use(): Release {
    this.#users += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users -= 1;
    };
  }

  /**
   * Holds the lock for removing the clone, if it has no users and nobody holds it: cleanup never
   * takes a clone that's open or being written to.
   */
  tryRemove(what: string): Release | undefined {
    return this.#users === 0 ? this.tryAcquire(what) : undefined;
  }
}

/** What the cache's lock file holds: a version line, then the process ID. */
const RECORD_VERSION = 'lo-cache 1';

/** The process a cache lock's record names, or `undefined` when it isn't one this code wrote. */
export function parseCacheLock(text: string): number | undefined {
  const lines = text.split('\n');
  const [version, pid, end, ...rest] = lines;
  if (version !== RECORD_VERSION || pid === undefined || !/^[1-9]\d*$/.test(pid)) {
    return undefined;
  }
  if (end !== '' || rest.length > 0) return undefined;
  return Number(pid);
}

/** The record for this process. */
export function cacheLockRecord(pid = process.pid): string {
  return `${RECORD_VERSION}\n${pid}\n`;
}

/** The caches this process has open, by their lock file. */
const held = new Set<string>();

/** Whether process `pid` is running, as far as this process can tell. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Running as someone else: it's alive.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Takes the cache's lock file at `path` for this process, or fails naming the process that holds
 * it. A lock whose process is gone, or that this code didn't write, is taken over. The file
 * appears whole, written first under another name and then linked into place, so another process
 * never reads it half written.
 */
export async function lockCache(path: string): Promise<Release> {
  if (held.has(path)) {
    throw new GitError({ kind: 'busy', message: `${path} is already open in this process` });
  }
  const temporary = `${path}.${process.pid}`;
  await writeFile(temporary, cacheLockRecord(), { mode: 0o600 }).catch((error: unknown) => {
    throw GitError.io(`locking ${path}`, error);
  });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await link(temporary, path);
        break;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw GitError.io(`locking ${path}`, error);
        }
      }
      const holder = parseCacheLock(await readFile(path, 'utf8').catch(() => ''));
      const live = holder !== undefined && holder !== process.pid && isRunning(holder);
      if (live || attempt > 0) {
        const who =
          holder === undefined ? 'another program' : `another program, process ${holder},`;
        throw new GitError({ kind: 'busy', message: `${who} is using ${path}` });
      }
      // What a process that's gone left, as after a crash.
      await rm(path, { force: true });
    }
  } finally {
    await rm(temporary, { force: true });
  }
  held.add(path);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.delete(path);
  };
}

/** Lets go of the cache's lock file at `path`, as {@link lockCache}'s release does, and removes it. */
export async function unlockCache(path: string, release: Release): Promise<void> {
  const text = await readFile(path, 'utf8').catch(() => '');
  if (parseCacheLock(text) === process.pid) await rm(path, { force: true });
  release();
}
