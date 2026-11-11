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
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { GitError } from './errors.ts';
import { type Git, Runner, type TestSettings } from './git.ts';
import { CloneLock, lockCache, type Release, unlockCache } from './lock.ts';
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
  /**
   * Where repositories are fetched from instead of GitHub, and settings after Lo's own: only a
   * build run from source, for its tests, sets it.
   */
  readonly test?: TestSettings | undefined;
}

export interface OpenOptions {
  /** The account's token, read as each fetch starts. Without one, git signs in as nobody. */
  readonly token?: TokenSource | undefined;
  /** The proxy Lo's own requests to GitHub take, read as each fetch starts. */
  readonly proxy?: ProxySource | undefined;
  /** Hears what the repository's writes wait on. */
  readonly progress?: ((activity: Activity) => void) | undefined;
}

/** Lo's local copies of repositories, in one folder, open in one process at a time. */
export class Cache {
  readonly root: string;
  readonly runner: Runner;
  readonly #log: ((line: string) => void) | undefined;
  readonly #release: Release;
  readonly #locks = new Map<string, CloneLock>();
  #closed = false;

  private constructor(
    root: string,
    runner: Runner,
    release: Release,
    log?: (line: string) => void,
  ) {
    this.root = root;
    this.runner = runner;
    this.#release = release;
    this.#log = log;
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
    const runner = new Runner(options.git, {
      home,
      ceiling: options.root,
      log: options.log,
      test: options.test,
    });
    return new Cache(options.root, runner, release, options.log);
  }

  /** Lets another process open the cache. Repositories still open keep working until closed. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await unlockCache(join(this.root, 'lo-cache.lock'), this.#release);
  }

  /** Notes a line for the log. */
  note(line: string): void {
    this.#log?.(line);
  }

  /** Where the clone of `owner/name` lives. */
  repoFolder(owner: string, name: string): string {
    return join(this.root, 'repos', HOST, owner.toLowerCase(), `${name.toLowerCase()}.git`);
  }

  /** Where the checkouts of `owner/name`'s pull requests live. */
  checkoutsFolder(owner: string, name: string): string {
    return join(this.root, 'checkouts', HOST, owner.toLowerCase(), name.toLowerCase());
  }

  /** The lock on `owner/name`'s clone, which every repository open on it shares. */
  cloneLock(owner: string, name: string): CloneLock {
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}`;
    let lock = this.#locks.get(key);
    if (lock === undefined) {
      lock = new CloneLock();
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
    const release = await lock.acquire('opening its local copy', options.progress);
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
      done = lock.use();
    } finally {
      release();
    }
    return new Repo({
      cache: this,
      name: `${owner}/${name}`,
      folder,
      url,
      lock,
      done,
      token: options.token,
      proxy: options.proxy,
      progress: options.progress,
      offline: false,
    });
  }

  /**
   * The clone of `owner/name` to read offline, or `undefined` when there's none, or none to
   * trust. It never makes a clone or writes to one, never waits for a fetch, and its reads never
   * download.
   */
  async openOffline(owner: string, name: string): Promise<Repo | undefined> {
    checkName('repository owner', owner);
    checkName('repository name', name);
    const folder = this.repoFolder(owner, name);
    if (!(await isFile(join(folder, 'HEAD')))) return undefined;
    const reason = await distrust(this.runner, folder, {
      checkouts: this.checkoutsFolder(owner, name),
    });
    if (reason !== undefined) {
      this.#log?.(`${owner}/${name}: not reading its local copy, since ${reason}`);
      return undefined;
    }
    const lock = this.cloneLock(owner, name);
    return new Repo({
      cache: this,
      name: `${owner}/${name}`,
      folder,
      url: `${this.runner.remote.base}/${owner}/${name}.git`,
      lock,
      done: lock.use(),
      offline: true,
    });
  }

  /** A new path in `tmp/`, ending in `extension`. */
  temporaryPath(extension: string): string {
    return join(this.root, 'tmp', `${randomUUID()}${extension}`);
  }

  /**
   * Moves `path` out of the way in one rename, so nobody finds it half deleted, then deletes it.
   */
  async trash(path: string): Promise<void> {
    const trash = this.temporaryPath('.trash');
    try {
      await rename(path, trash);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw GitError.io(`moving ${path} aside`, error);
    }
    await rm(trash, { recursive: true, force: true }).catch((error: unknown) => {
      this.#log?.(`can't remove ${trash}: ${String(error)}`);
    });
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
