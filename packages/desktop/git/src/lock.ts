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
 *   it has no users and nobody holds its lock. Maintenance, such as repacking, which can take
 *   many minutes, holds the lock giving way: it's told as soon as anyone waits for it, and stops.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, readFile, rename, rm, writeFile } from 'node:fs/promises';

import { GitError } from './errors.ts';
import type { Activity } from './progress.ts';

/** How often a waiter hears again that it's still waiting, in milliseconds. */
export const TELL_EVERY = 1000;

/** Lets go of a lock. Letting go twice does nothing. */
export type Release = () => void;

/** How a holder that gives way hears that someone waits: what the waiter wants to do. */
export type GiveWay = (waiter: string) => void;

/** The lock on one clone: one writer at a time, and a count of the repositories open on it. */
export class CloneLock {
  /** What the holder is doing, such as "fetching pull request #12", while one holds it. */
  #holder: string | undefined;
  /** How the holder, if it gives way, is told that someone waits. */
  #giveWay: GiveWay | undefined;
  /** Whether the holder may remove the clone, or what's in it, having found it unused. */
  #removing = false;
  readonly #waiting: (() => void)[] = [];
  /** Those waiting only for a holder that removes to let go. */
  readonly #waitingForRemoval: (() => void)[] = [];
  #users = 0;
  readonly #onFree: (() => void) | undefined;

  /**
   * A lock that tells `onFree` whenever its holder lets go with nobody waiting, and whenever the
   * last repository open on the clone lets go while nobody holds the lock.
   */
  constructor(onFree?: () => void) {
    this.#onFree = onFree;
  }

  /** What the holder is doing, or `undefined` when nobody holds the lock. */
  get holder(): string | undefined {
    return this.#holder;
  }

  /** Whether the holder took the lock with {@link CloneLock.tryRemove}. */
  get removing(): boolean {
    return this.#removing;
  }

  /** How many open repositories use the clone. */
  get users(): number {
    return this.#users;
  }

  /**
   * Waits for the lock, then holds it to do `what`. While it waits, `progress` hears what the
   * holder is doing, at once and every `tellEvery` milliseconds, and once `signal` aborts, it
   * stops waiting and fails with its reason. A holder that gives way is told at once.
   */
  async acquire(
    what: string,
    progress?: (activity: Activity) => void,
    options: { tellEvery?: number; signal?: AbortSignal | undefined } = {},
  ): Promise<Release> {
    const { tellEvery = TELL_EVERY, signal } = options;
    signal?.throwIfAborted();
    if (this.#holder !== undefined) {
      const started = Date.now();
      const tell = () =>
        progress?.({ kind: 'waitingForLock', holder: this.#holder, waited: Date.now() - started });
      tell();
      this.#giveWay?.(what);
      this.#giveWay = undefined;
      const timer = setInterval(tell, tellEvery);
      try {
        // Woken in turn, each waiter finds the lock free: the one before let go of it.
        while (this.#holder !== undefined) {
          if (!(await this.#wait(this.#waiting, signal))) signal?.throwIfAborted();
        }
      } finally {
        clearInterval(timer);
      }
    }
    return this.#take(what);
  }

  /** Holds the lock, which is free, to do `what`. */
  #take(what: string, giveWay?: GiveWay, removing = false): Release {
    this.#holder = what;
    this.#giveWay = giveWay;
    this.#removing = removing;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holder = undefined;
      this.#giveWay = undefined;
      this.#removing = false;
      for (const wake of this.#waitingForRemoval.splice(0)) wake();
      const next = this.#waiting.shift();
      if (next === undefined) this.#onFree?.();
      else next();
    };
  }

  /**
   * Waits while the holder removes the clone or what's in it, telling it to give way, for `what`,
   * if it does; never for any other holder. Once `signal` aborts, it stops waiting and fails with
   * its reason.
   */
  async passRemoval(what: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    while (this.#removing) {
      this.#giveWay?.(what);
      this.#giveWay = undefined;
      if (!(await this.#wait(this.#waitingForRemoval, signal))) signal?.throwIfAborted();
    }
  }

  /**
   * Waits in `queue` to be woken, and says so, or until `signal` aborts, when it leaves the queue,
   * so the next in it is woken in its place.
   */
  #wait(queue: (() => void)[], signal: AbortSignal | undefined): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const abort = () => {
        const at = queue.indexOf(wake);
        if (at !== -1) queue.splice(at, 1);
        resolve(false);
      };
      const wake = () => {
        signal?.removeEventListener('abort', abort);
        resolve(true);
      };
      queue.push(wake);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  /**
   * Holds the lock if nobody does, without waiting. With `giveWay`, the holder gives way to anyone
   * who waits for it, and `giveWay` hears, once, what the first of them wants to do.
   */
  tryAcquire(what: string, giveWay?: GiveWay): Release | undefined {
    return this.#holder === undefined ? this.#take(what, giveWay) : undefined;
  }

  /** Counts an open repository as a user until it lets go. */
  use(): Release {
    this.#users += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users -= 1;
      if (this.#users === 0 && this.#holder === undefined) this.#onFree?.();
    };
  }

  /**
   * Holds the lock for removing the clone, or what's in it, if it has no users and nobody holds
   * it: cleanup never takes a clone that's open or being written to. With `giveWay`, as
   * {@link CloneLock.tryAcquire}.
   */
  tryRemove(what: string, giveWay?: GiveWay): Release | undefined {
    if (this.#users > 0 || this.#holder !== undefined) return undefined;
    return this.#take(what, giveWay, true);
  }
}

/** What the cache's lock file holds: a version line, the process ID, and when it started. */
const RECORD_VERSION = 'lo-cache 2';

/** The process a cache lock's record names, or `undefined` when it isn't one this code wrote. */
export function parseCacheLock(text: string): { pid: number; started: string } | undefined {
  const [version, pid, started, end, ...rest] = text.split('\n');
  if (version !== RECORD_VERSION || pid === undefined || !/^[1-9]\d*$/.test(pid)) {
    return undefined;
  }
  if (started === undefined || started === '' || end !== '' || rest.length > 0) return undefined;
  return { pid: Number(pid), started };
}

/** The record for process `pid`, which started at `started`. */
export function cacheLockRecord(pid: number, started: string): string {
  return `${RECORD_VERSION}\n${pid}\n${started}\n`;
}

/**
 * When process `pid` started, as `ps` says, in UTC, or `undefined` when it can't tell, as for a
 * process that's gone. Two processes that ever had one ID have different start times. `ps` writes
 * the time in a time zone, the system's unless it's told one, so a running process would seem to
 * have started at another time once the system's zone changed, as a laptop's does on a trip.
 */
export function startTime(pid: number): Promise<string | undefined> {
  return psStartTime(pid, 'UTC');
}

/** When process `pid` started, as `ps` writes it in `zone`, or in the system's own without one. */
async function psStartTime(pid: number, zone?: string): Promise<string | undefined> {
  const said = await new Promise<string | undefined>((resolve) => {
    execFile(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      {
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', ...(zone === undefined ? {} : { TZ: zone }) },
        timeout: 10_000,
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
  const started = said?.trim().replaceAll(/\s+/g, ' ');
  return started === '' ? undefined : started;
}

/** When this process started. */
let ownStart: Promise<string> | undefined;

/** The caches this process has open, by their lock file. */
const held = new Set<string>();

/**
 * Whether the process a lock names is still the one that took it: running, as far as this
 * process can tell, and started when it did, so a process that got its ID since doesn't count.
 */
async function isHolding(holder: { pid: number; started: string }): Promise<boolean> {
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    // Running as someone else is running.
    if (!(error instanceof Error && 'code' in error && error.code === 'EPERM')) return false;
  }
  const started = await startTime(holder.pid);
  if (started === undefined || started === holder.started) return true;
  // A record may give the start in the system's own time zone, as Lo once wrote it.
  return (await psStartTime(holder.pid)) === holder.started;
}

/**
 * Takes the cache's lock file at `path` for this process, or fails naming the process that holds
 * it. The file appears whole, written first under another name and then linked into place, which
 * fails when there's one already, so another process never reads one half written, and two never
 * both take it. A lock whose process is gone, or that this code didn't write, is taken over: under
 * a second lock, `<path>.takeover`, taken the same way, the stale lock is read again and replaced
 * in one rename, so the lock file is never missing and two processes never both take one over.
 *
 * The second lock names the process taking over, and is its for as long as that process runs,
 * however long the takeover takes, as when the computer sleeps in the middle of it: another
 * process fails, naming it. Only one a process that's gone left is removed, never by its age, which
 * would let a takeover that waited past it replace the lock another process took meanwhile.
 */
export async function lockCache(path: string): Promise<Release> {
  if (held.has(path)) {
    throw new GitError({ kind: 'busy', message: `${path} is already open in this process` });
  }
  ownStart ??= startTime(process.pid).then((started) => started ?? 'unknown');
  const temporary = `${path}.${process.pid}.${randomUUID()}`;
  await writeFile(temporary, cacheLockRecord(process.pid, await ownStart), { mode: 0o600 }).catch(
    (error: unknown) => {
      throw GitError.io(`locking ${path}`, error);
    },
  );
  const busy = (holder: { pid: number } | undefined) =>
    new GitError({
      kind: 'busy',
      message: `${holder === undefined ? 'another program' : `another program, process ${holder.pid},`} is using ${path}`,
    });
  const guard = `${path}.takeover`;
  try {
    for (let attempt = 0; ; attempt++) {
      if (await linked(temporary, path)) break;
      const found = await readFile(path, 'utf8').catch(() => undefined);
      if (found === undefined) continue;
      const holder = parseCacheLock(found);
      if (holder !== undefined && holder.pid !== process.pid && (await isHolding(holder))) {
        throw busy(holder);
      }
      if (attempt > 100) throw busy(holder);
      // What a process that's gone left, as after a crash.
      if (!(await linked(temporary, guard))) {
        // Another process is taking it over: once it has, the lock is its.
        const taking = await readFile(guard, 'utf8').catch(() => undefined);
        if (taking === undefined) continue;
        const taker = parseCacheLock(taking);
        if (taker !== undefined && (await isHolding(taker))) throw busy(taker);
        // Its process is gone, as after a crash in the middle of it.
        await removeLeft(guard, taking);
        continue;
      }
      try {
        const again = await readFile(path, 'utf8').catch(() => undefined);
        if (again === found) {
          await rename(temporary, path);
          break;
        }
      } finally {
        await rm(guard, { force: true });
      }
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

/**
 * Removes the file at `path` if it still holds `text`, which a process that's gone left. It's moved
 * aside first, under a name of its own, and put back if what was moved is another process's, which
 * took the place of the one read meanwhile: a file only one process may hold is never removed from
 * under one that's running.
 */
async function removeLeft(path: string, text: string): Promise<void> {
  const aside = `${path}.${process.pid}.${randomUUID()}`;
  try {
    await rename(path, aside);
  } catch {
    // Gone already, removed by another process.
    return;
  }
  try {
    const moved = await readFile(aside, 'utf8').catch(() => undefined);
    if (moved !== text) await link(aside, path).catch(() => undefined);
  } finally {
    await rm(aside, { force: true });
  }
}

/** Links `from` at `to`, or says it couldn't because something is there already. */
async function linked(from: string, to: string): Promise<boolean> {
  try {
    await link(from, to);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw GitError.io(`locking ${to}`, error);
  }
}

/** Lets go of the cache's lock file at `path`, as {@link lockCache}'s release does, and removes it. */
export async function unlockCache(path: string, release: Release): Promise<void> {
  const text = await readFile(path, 'utf8').catch(() => '');
  if (parseCacheLock(text)?.pid === process.pid) await rm(path, { force: true });
  release();
}
