/**
 * The cache folder and the bare clones in it:
 *
 * - `repos/github.com/<owner>/<repo>.git`: a bare partial clone of each repository, so file
 *   contents download only when asked for. Everything fetched goes under Lo's own refs.
 * - `checkouts/github.com/<owner>/<repo>/`: checkouts of pull requests' heads.
 * - `git-env/home`: the empty `HOME` git runs with.
 * - `tmp/`: clones being made, and whatever is being deleted.
 * - `lo-cache.lock`: the lock that keeps the cache to one process.
 *
 * Folder names are lowercase, since GitHub's owner and repository names aren't case-sensitive.
 */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { GitError } from './errors.ts';
import { type Git, Runner, type TestSettings } from './git.ts';
import { DEFAULT_FETCH_LIMITS, type FetchLimits } from './limits.ts';
import {
  clear,
  DEFAULT_CAP,
  DEFAULT_MAINTENANCE,
  diskUsage,
  GEOMETRIC_LIMIT,
  keepUnder,
  type MaintenanceTimes,
  removeUnused,
  repack,
  repackClone,
} from './cleanup.ts';
import { REPLAYS } from './compare.ts';
import { CloneLock, lockCache, type Release, unlockCache } from './lock.ts';
import { ObjectReader } from './objects.ts';
import type { Oid } from './oid.ts';
import type { Activity } from './progress.ts';
import { checkName } from './refs.ts';
import { Repo } from './repo.ts';
import { stampUsed } from './stamp.ts';
import type { TokenSource } from './token.ts';
import { distrust } from './trust.ts';

/** The only host Lo fetches from, for now. */
const HOST = 'github.com';

/** Where git reaches GitHub through, read as each fetch starts: a proxy's address, or none. */
export type ProxySource = () => Promise<string | undefined>;

export interface CacheOptions {
  /** The cache's folder. It's made if it's missing. */
  readonly root: string;
  readonly git: Git;
  /** Gets a line for each git that fails and each clone made again. */
  readonly log?: ((line: string) => void) | undefined;
  /** How long fetches may take: {@link DEFAULT_FETCH_LIMITS} unless tests make them short. */
  readonly limits?: FetchLimits | undefined;
  /**
   * Where repositories are fetched from instead of GitHub, and settings after Lo's own: only a
   * build run from source, for its tests, sets it.
   */
  readonly test?: TestSettings | undefined;
  /** The size to keep the cache under, in bytes: {@link DEFAULT_CAP} unless Settings says. */
  readonly cap?: number | undefined;
  /** When maintenance runs and how it gives way: {@link DEFAULT_MAINTENANCE} unless tests say. */
  readonly maintenance?: Partial<MaintenanceTimes> | undefined;
}

export interface OpenOptions {
  /** The account's token, read as each fetch starts. Without one, git signs in as nobody. */
  readonly token?: TokenSource | undefined;
  /** The proxy Lo's own requests to GitHub take, read as each fetch starts. */
  readonly proxy?: ProxySource | undefined;
  /** Hears what the repository's writes wait on, and what opening it waits on. */
  readonly progress?: ((activity: Activity) => void) | undefined;
  /**
   * Stops waiting for the clone once it aborts, and the open fails with its reason. Opening waits
   * for whatever writes to the clone, but maintenance, such as repacking, stops for it.
   */
  readonly signal?: AbortSignal | undefined;
}

/** Lo's local copies of repositories, in one folder, open in one process at a time. */
export class Cache {
  readonly root: string;
  readonly runner: Runner;
  readonly limits: FetchLimits;
  readonly maintenance: MaintenanceTimes;
  readonly #log: ((line: string) => void) | undefined;
  readonly #release: Release;
  #cap: number;
  readonly #locks = new Map<string, CloneLock>();
  /** Each open clone's reader of objects, and how many repositories open on it use it. */
  readonly #readers = new Map<string, { reader: ObjectReader; users: number }>();
  /** The replayed trees this process has pinned in each clone, while one has it open. */
  readonly #replays = new Map<string, Set<Oid>>();
  /** Each clone's wait for its lock to be idle long enough to look at it again. */
  readonly #idle = new Map<string, ReturnType<typeof setTimeout>>();
  /** How many times maintenance has started on each clone once its lock was idle. */
  readonly #attempts = new Map<string, number>();
  /** The maintenance running or waiting to: one clone at a time, so a launch doesn't run many. */
  #maintaining: Promise<unknown> = Promise.resolve();
  /** What's being deleted, once moved aside. */
  readonly #deleting = new Set<Promise<void>>();
  /** Aborted as the cache closes, which stops maintenance. */
  readonly #closing = new AbortController();
  #closed = false;

  private constructor(
    root: string,
    runner: Runner,
    release: Release,
    options: CacheOptions & { limits: FetchLimits },
  ) {
    this.root = root;
    this.runner = runner;
    this.limits = options.limits;
    this.maintenance = { ...DEFAULT_MAINTENANCE, ...options.maintenance };
    this.#release = release;
    this.#cap = options.cap ?? DEFAULT_CAP;
    this.#log = options.log;
  }

  /** Opens the cache at `options.root`, or fails when another process has it open. */
  static async open(options: CacheOptions): Promise<Cache> {
    const home = join(options.root, 'git-env', 'home');
    try {
      await mkdir(home, { recursive: true });
      await mkdir(join(options.root, 'tmp'), { recursive: true });
    } catch (error) {
      throw GitError.io(`making ${options.root}`, error);
    }
    const release = await lockCache(join(options.root, 'lo-cache.lock'));
    const limits = options.limits ?? DEFAULT_FETCH_LIMITS;
    const runner = new Runner(options.git, {
      home,
      ceiling: options.root,
      log: options.log,
      test: options.test,
      readLimit: limits.read,
    });
    return new Cache(options.root, runner, release, { ...options, limits });
  }

  /**
   * Lets another process open the cache: stops any maintenance running, as it stops for anyone
   * who waits for its clone but without its grace, and waits for it and for what's being deleted.
   * Repositories still open keep working until closed, but no more maintenance starts.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const timer of this.#idle.values()) clearTimeout(timer);
    this.#idle.clear();
    this.#closing.abort();
    await this.#maintaining;
    await this.#deleted();
    await unlockCache(join(this.root, 'lo-cache.lock'), this.#release);
  }

  /** Aborts as the cache closes. */
  get closing(): AbortSignal {
    return this.#closing.signal;
  }

  /** Notes a line for the log. */
  note(line: string): void {
    this.#log?.(line);
  }

  /** How much disk space the cache takes, in bytes, counting what each file takes on disk. */
  size(): Promise<number> {
    return diskUsage(this.root);
  }

  /**
   * Removes every clone and checkout that isn't open or being written to, for Settings' "Clear
   * cache". Returns the `owner/name` of each clone it had to leave.
   */
  async clear(): Promise<string[]> {
    const left = await clear(this);
    await this.#deleted();
    return left;
  }

  /**
   * Removes what nobody used for a while: clones for 30 days, checkouts for 14, what crashes and
   * stopped fetches left a day or more ago, and from clones nobody has open, the trees comparisons
   * replayed. Never a clone that's open or being written to. Returns the `owner/name` of each
   * clone removed.
   */
  async removeUnused(now = Date.now()): Promise<string[]> {
    const removed = await removeUnused(this, now);
    await this.#deleted();
    return removed;
  }

  /** The size the cache is kept under, in bytes. */
  get cap(): number {
    return this.#cap;
  }

  /**
   * Sets the size to keep the cache under, from Settings, and keeps it there: past it, the least
   * recently used checkouts go, then the least recently used clones, only until it's under, and
   * never a clone that's open or being written to, its checkouts, or the most recently used clone.
   * Returns the `owner/name` of each clone removed.
   */
  async setCap(bytes: number): Promise<string[]> {
    this.#cap = bytes;
    const removed = await keepUnder(this, bytes);
    await this.#deleted();
    return removed;
  }

  /**
   * Repacks every clone with more than `limit` packs that isn't being written to: geometrically,
   * or whole once its packs piled past {@link PACK_LIMIT} while nobody has it open. Anyone who
   * waits for a clone being repacked gives it {@link MaintenanceTimes.grace} to finish, then stops
   * it, and it's repacked again once the clone's lock has been idle a while.
   */
  repack(limit = GEOMETRIC_LIMIT): Promise<string[]> {
    return this.#serially(() => repack(this, limit));
  }

  /**
   * What the app runs at launch: removes what nobody used for a while, keeps the cache under its
   * cap, and repacks busy clones. Clones are repacked again, if they need it, once their locks
   * have been idle for {@link MaintenanceTimes.idleFor}, a few times each launch.
   */
  async cleanUp(): Promise<{ removed: string[]; overCap: string[]; repacked: string[] }> {
    const removed = await this.removeUnused();
    const overCap = await this.setCap(this.#cap);
    const repacked = await this.repack();
    return { removed, overCap, repacked };
  }

  /** Keeps the cache under its cap once a fetch has made a clone, which may have grown it most. */
  async madeClone(): Promise<void> {
    await keepUnder(this, this.#cap).catch((error: unknown) => {
      this.note(`can't keep the cache under its cap: ${String(error)}`);
    });
  }

  /** Runs `work` once the maintenance before it is done. */
  #serially<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#maintaining.then(work, work);
    this.#maintaining = run.catch(() => undefined);
    return run;
  }

  /**
   * Looks at the clone of `owner/name`, whose folders are named so, again once its lock has gone
   * unheld for {@link MaintenanceTimes.idleFor}, and repacks it if it needs it, at most
   * {@link MaintenanceTimes.attempts} times each launch: the clones restored or fetched right after
   * launch are the busiest, and may never be idle at launch.
   */
  #lockFree(owner: string, name: string): void {
    const key = `${owner}/${name}`;
    clearTimeout(this.#idle.get(key));
    if (this.#closed || (this.#attempts.get(key) ?? 0) >= this.maintenance.attempts) return;
    const timer = setTimeout(() => {
      this.#idle.delete(key);
      void this.#serially(async () => {
        const lock = this.cloneLock(owner, name);
        if (this.#closed || lock.holder !== undefined) return;
        const packs = await readdir(join(this.repoFolder(owner, name), 'objects', 'pack')).catch(
          () => [],
        );
        if (packs.filter((pack) => pack.endsWith('.pack')).length <= GEOMETRIC_LIMIT) return;
        this.#attempts.set(key, (this.#attempts.get(key) ?? 0) + 1);
        await repackClone(this, { owner, name }, GEOMETRIC_LIMIT);
      }).catch((error: unknown) => {
        this.note(`can't repack ${key}: ${String(error)}`);
      });
    }, this.maintenance.idleFor);
    timer.unref();
    this.#idle.set(key, timer);
  }

  /** Waits for what's being deleted to be gone. */
  async #deleted(): Promise<void> {
    while (this.#deleting.size > 0) await Promise.all(this.#deleting);
  }

  /** Where the clone of `owner/name` lives. */
  repoFolder(owner: string, name: string): string {
    return join(this.root, 'repos', HOST, owner.toLowerCase(), `${name.toLowerCase()}.git`);
  }

  /** Where the checkouts of `owner/name`'s pull requests live. */
  checkoutsFolder(owner: string, name: string): string {
    return join(this.root, 'checkouts', HOST, owner.toLowerCase(), name.toLowerCase());
  }

  /**
   * The reader of `owner/name`'s clone at `folder`, which every repository open on it shares, and
   * a release that stops it once the last of them lets go.
   */
  #reader(owner: string, name: string, folder: string): { reader: ObjectReader; release: Release } {
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    let shared = this.#readers.get(key);
    if (shared === undefined) {
      const reader = new ObjectReader(this.limits.read, () =>
        this.runner
          .command({ gitDir: folder }, { readsOnly: true })
          .arg('cat-file', '--batch-command'),
      );
      shared = { reader, users: 0 };
      this.#readers.set(key, shared);
    }
    shared.users++;
    const using = shared;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      using.users--;
      if (using.users > 0) return;
      using.reader.close();
      if (this.#readers.get(key) === using) this.#readers.delete(key);
    };
    return { reader: using.reader, release };
  }

  /** The replayed trees this process has pinned in `owner/name`'s clone. */
  #replaysOf(owner: string, name: string): Set<Oid> {
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    let replays = this.#replays.get(key);
    if (replays === undefined) {
      replays = new Set();
      this.#replays.set(key, replays);
    }
    return replays;
  }

  /** The lock on `owner/name`'s clone, which every repository open on it shares. */
  cloneLock(owner: string, name: string): CloneLock {
    const [lowerOwner, lowerName] = [owner.toLowerCase(), name.toLowerCase()];
    const key = `${lowerOwner}/${lowerName}`;
    let lock = this.#locks.get(key);
    if (lock === undefined) {
      lock = new CloneLock(() => this.#lockFree(lowerOwner, lowerName));
      this.#locks.set(key, lock);
    }
    return lock;
  }

  /**
   * The clone of `owner/name`, made on first use. Nothing is fetched yet. Pass the repository's
   * canonical name, GitHub's `full_name` for it, so a renamed or transferred repository keeps one
   * clone. A clone that isn't whole, or that fails the trust check, is moved aside and made again.
   * It waits while anything else writes to the clone.
   */
  async open(owner: string, name: string, options: OpenOptions = {}): Promise<Repo> {
    checkName('repository owner', owner);
    checkName('repository name', name);
    const folder = this.repoFolder(owner, name);
    const url = `${this.runner.remote.base}/${owner}/${name}.git`;
    const lock = this.cloneLock(owner, name);
    const release = await lock.acquire('opening its local copy', options.progress, {
      signal: options.signal,
    });
    let done: Release;
    try {
      if (await isFile(join(folder, 'HEAD'))) {
        const reason = await distrust(this.runner, folder, {
          checkouts: this.checkoutsFolder(owner, name),
        });
        if (reason === undefined) {
          await this.#pointAt(folder, url);
        } else {
          // Never pulled out from under a repository that's still reading it.
          if (lock.users > 0) {
            throw new GitError({
              kind: 'busy',
              message:
                `${owner}/${name}'s local copy can't be trusted, since ${reason}, and is still ` +
                'open, so it can be made again only once it closes',
            });
          }
          this.#log?.(`${owner}/${name}: making its local copy again, since ${reason}`);
          await this.trash(folder);
          await this.create(folder, url);
        }
      } else {
        // Without HEAD, it's what an interrupted deletion left: it goes, and a new clone takes
        // its place.
        if (await exists(folder)) await this.trash(folder);
        await this.create(folder, url);
      }
      await stampUsed(folder);
      // With no repository open on the clone, no comparison is shown from it: the trees replayed
      // for the last ones, which this process or an earlier one pinned, can go.
      if (lock.users === 0) await this.#removeReplayPins(folder, this.#replaysOf(owner, name));
      done = lock.use();
    } finally {
      release();
    }
    const reader = this.#reader(owner, name, folder);
    return new Repo({
      cache: this,
      name: `${owner}/${name}`,
      folder,
      url,
      lock,
      done: () => {
        reader.release();
        done();
      },
      reader: reader.reader,
      token: options.token,
      proxy: options.proxy,
      progress: options.progress,
      replays: this.#replaysOf(owner, name),
      checkouts: this.checkoutsFolder(owner, name),
      offline: false,
    });
  }

  /**
   * The clone of `owner/name` to read offline, or `undefined` when there's none, or none to
   * trust. It never makes a clone or fetches into one, never waits for a fetch, and its reads never
   * download. A comparison writes only the trees it replays, which exist only in the clone, and
   * their pins. Like {@link Cache.open}, it counts as a user of the clone at once, so cleanup takes
   * nothing from it while it's open, and waits for cleanup that already started on it, which stops
   * for it if it can. Once `options.signal` aborts, it stops waiting and fails with its reason.
   */
  async openOffline(
    owner: string,
    name: string,
    options: Pick<OpenOptions, 'signal'> = {},
  ): Promise<Repo | undefined> {
    checkName('repository owner', owner);
    checkName('repository name', name);
    const folder = this.repoFolder(owner, name);
    const lock = this.cloneLock(owner, name);
    const done = lock.use();
    try {
      await lock.passRemoval('reading its local copy', options.signal);
      if (!(await isFile(join(folder, 'HEAD')))) {
        done();
        return undefined;
      }
      const reason = await distrust(this.runner, folder, {
        checkouts: this.checkoutsFolder(owner, name),
      });
      if (reason !== undefined) {
        this.#log?.(`${owner}/${name}: not reading its local copy, since ${reason}`);
        done();
        return undefined;
      }
    } catch (error) {
      done();
      throw error;
    }
    const reader = this.#reader(owner, name, folder);
    return new Repo({
      cache: this,
      name: `${owner}/${name}`,
      folder,
      url: `${this.runner.remote.base}/${owner}/${name}.git`,
      lock,
      done: () => {
        reader.release();
        done();
      },
      reader: reader.reader,
      replays: this.#replaysOf(owner, name),
      checkouts: this.checkoutsFolder(owner, name),
      offline: true,
    });
  }

  /** A new path in `tmp/`, ending in `extension`. */
  temporaryPath(extension: string): string {
    return join(this.root, 'tmp', `${randomUUID()}${extension}`);
  }

  /**
   * Whether `path` is in the cache with a real folder, never a link, at each step above it that
   * exists: anything written there stays in the cache.
   */
  async linkFree(path: string): Promise<boolean> {
    const inside = relative(this.root, path);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return false;
    let above = this.root;
    for (const name of inside.split(sep).slice(0, -1)) {
      above = join(above, name);
      const found = await lstat(above).catch(() => undefined);
      if (found === undefined) return true;
      if (!found.isDirectory()) return false;
    }
    return true;
  }

  /**
   * Moves `path` out of the way in one rename, so nobody finds it half deleted, and deletes it
   * afterwards, without keeping the caller waiting, so a clone's lock held for the rename isn't
   * held for the deletion. Returns whether it's gone: never through a link, which would move what
   * it points at, out of the cache, aside, so a path outside the cache or past a link is left, and
   * noted. A link at the path itself goes, and what it points at stays. Cleanup, and closing the
   * cache, wait for what they moved aside to be deleted.
   */
  async trash(path: string): Promise<boolean> {
    if (!(await this.linkFree(path))) {
      this.#log?.(`not removing ${path}, which isn't in the cache or is past a link`);
      return false;
    }
    const trash = this.temporaryPath('.trash');
    try {
      await rename(path, trash);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true;
      throw GitError.io(`moving ${path} aside`, error);
    }
    const deleting: Promise<void> = rm(trash, { recursive: true, force: true })
      .catch((error: unknown) => {
        this.#log?.(`can't remove ${trash}: ${String(error)}`);
      })
      .finally(() => this.#deleting.delete(deleting));
    this.#deleting.add(deleting);
    return true;
  }

  /**
   * Makes a bare clone at `folder`, set up to fetch from `url`, in a temporary folder moved into
   * place, so a clone in the cache is always whole. Fetches name the remote on git's command line
   * themselves; the clone's own settings make it a partial clone, which may lack objects.
   */
  async create(folder: string, url: string): Promise<void> {
    const temporary = this.temporaryPath('.git');
    try {
      // No template: nothing but what git needs, so no sample hooks.
      await this.runner
        .command('none')
        .arg('init', '--quiet', '--bare', '--template=')
        .path(temporary)
        .run();
      for (const [key, value] of [
        ['remote.origin.url', url],
        // A promisor remote, which file contents download from when they're asked for.
        ['remote.origin.promisor', 'true'],
        ['remote.origin.partialclonefilter', 'blob:none'],
        ['core.repositoryformatversion', '1'],
        ['extensions.partialclone', 'origin'],
      ] as const) {
        await this.runner.command({ gitDir: temporary }).arg('config', key, value).run();
      }
      await stampUsed(temporary);
      await mkdir(dirname(folder), { recursive: true });
      await rename(temporary, folder);
    } catch (error) {
      if (error instanceof GitError) throw error;
      throw GitError.io(`making ${folder}`, error);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  /** Removes every replayed tree's pin from the clone at `folder`. Its lock is held. */
  async #removeReplayPins(folder: string, replays: Set<Oid>): Promise<void> {
    replays.clear();
    const deletes = await this.runner
      .command({ gitDir: folder })
      .arg('for-each-ref', '--format=delete %(refname)', REPLAYS)
      .run();
    if (deletes.length === 0) return;
    await this.runner.command({ gitDir: folder }).arg('update-ref', '--stdin').run(deletes);
  }

  /** Points the clone at `url` if it points somewhere else. Opening usually writes nothing. */
  async #pointAt(folder: string, url: string): Promise<void> {
    const current = await this.runner
      .command({ gitDir: folder })
      .arg('config', '--get', 'remote.origin.url')
      .finish();
    if (current.stdout.toString('utf8').trim() !== url) {
      await this.runner.command({ gitDir: folder }).arg('config', 'remote.origin.url', url).run();
    }
  }
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false;
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}
