// Git in main, the only process that runs it: finding git, the cache it works in and where that
// is, what Lo found, for the window, cleanup once the window is up, and stopping every git as Lo
// quits. Nothing here calls Electron, so it runs under unit tests; `index.ts` hands it what it
// needs of Electron.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { lstat, readdir, realpath, rename, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

import {
  Cache,
  DEFAULT_CAP,
  describeDistrust,
  findGit,
  formatVersion,
  type Git,
  gitAt,
  type GitStatus,
  installAdvice,
  lockCache,
  type ProxySource,
  type TestSettings,
  unlockCache,
} from '@lo/git';

import type { GitTrouble } from '../ipc/git.ts';
import { StartupError, type StartupFailure } from './startup.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/** What a build run from source may change about git, for its tests. */
export interface GitSettings {
  /** The git to run rather than one Lo finds: an absolute path, or `none` for no git at all. */
  readonly program?: string | undefined;
  /** Where fetches go instead of GitHub. */
  readonly test?: TestSettings | undefined;
}

/**
 * Git's settings. A packaged build finds git itself and fetches from GitHub, whatever the
 * environment says. A build run from source takes the git in `LO_GIT`, a path or `none`, and
 * fetches from `LO_GIT_REMOTE`, a server or folder on this machine, so its tests can bring a git
 * and a remote of their own. `@lo/git` never reads either.
 */
export function gitSettings(options: { packaged: boolean; env: Environment }): GitSettings {
  if (options.packaged) return {};
  const program = options.env.LO_GIT || undefined;
  const remote = options.env.LO_GIT_REMOTE || undefined;
  if (program !== undefined && program !== 'none' && !isAbsolute(program)) {
    throw new Error(`LO_GIT must be an absolute path or "none", not "${program}".`);
  }
  if (remote !== undefined && !URL.canParse(remote)) {
    throw new Error(`LO_GIT_REMOTE must be an address, not "${remote}".`);
  }
  return { program, test: remote === undefined ? undefined : { remote } };
}

/** What decides where Lo keeps its cache. */
export interface Placing {
  readonly packaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Environment;
}

/**
 * The cache's folder in `LO_USER_DATA_DIR`. Chromium keeps its own folders there, its HTTP cache
 * in `Cache` among them, which a Mac's disk, by default, takes for `cache`: so Lo's is named
 * nothing Chromium names, whatever the case, and cleanup never counts or removes Chromium's files.
 */
const DATA_CACHE = 'lo-cache';

/**
 * Where Lo keeps its cache, which holds its local copies of repositories, their checkouts and the
 * language servers it installs: `Lo` in the system's folder for this user's caches, and `Lo Dev`
 * for a build run from source, so it never touches an installed Lo's. On a Mac that's the folder
 * macOS keeps outside the home folder ({@link macCaches}), since tools a language server runs read
 * settings from every folder above their own, such as Cargo's `.cargo/config.toml`, and none the
 * home folder holds may reach them. On Linux it's `$XDG_CACHE_HOME` or `~/.cache`. A build run
 * from source with `LO_USER_DATA_DIR` keeps it there, in {@link DATA_CACHE}, so each test starts
 * empty.
 */
export function cacheFolder(
  options: Placing & {
    /** The Mac's folder for this user's caches: {@link macCaches}, unless a test says. */
    readonly macFolder?: (() => string) | undefined;
  },
): string {
  const { env } = options;
  if (!options.packaged && env.LO_USER_DATA_DIR) return join(env.LO_USER_DATA_DIR, DATA_CACHE);
  const name = options.packaged ? 'Lo' : 'Lo Dev';
  if (options.platform === 'darwin') return join((options.macFolder ?? macCaches)(), name);
  const xdg = env.XDG_CACHE_HOME;
  return join(xdg !== undefined && isAbsolute(xdg) ? xdg : join(options.home, '.cache'), name);
}

/** Runs `program`, an absolute path, with `args` and no environment, and returns what it wrote. */
export type Run = (program: string, args: readonly string[]) => string;

const runBare: Run = (program, args) =>
  execFileSync(program, args, {
    env: {},
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });

/**
 * The folder macOS keeps for this user's caches, `DARWIN_USER_CACHE_DIR`, by its real path
 * (`/private/var/folders/<xx>/<random>/C`): the user's own, closed to everyone else, and kept
 * across restarts. The folder above it is the user's too, and only root can change those above
 * that. `/usr/bin/getconf` names it, run by its path with no environment, so nothing Lo was
 * started with can move it. The path it gives, and the real path Lo uses, must each pass
 * {@link whyNotCaches}, or it's a {@link StartupError}: Lo never falls back to the home folder.
 */
export function macCaches(options: { run?: Run; uid?: number } = {}): string {
  const { run = runBare, uid = process.getuid?.() ?? -1 } = options;
  let said: string;
  try {
    said = run('/usr/bin/getconf', ['DARWIN_USER_CACHE_DIR']);
  } catch (error) {
    throw refuse({ why: 'noLocation', said: describe(error) });
  }
  const folder = said.endsWith('\n') ? said.slice(0, -1) : said;
  const why = whyNotCaches(folder, uid);
  if (why !== undefined) throw refuse(why);
  let real: string;
  try {
    real = realpathSync(folder);
  } catch (error) {
    throw refuse({ why: 'missing', path: folder, said: describe(error) });
  }
  // What Lo uses is checked too, not just what it was named.
  const whyReal = whyNotCaches(real, uid);
  if (whyReal !== undefined) throw refuse(whyReal);
  return real;
}

/** Why Lo won't use a folder for its cache, with the folder and what the system said. */
export type CacheRefusal = Omit<Extract<StartupFailure, { kind: 'cacheFolder' }>, 'kind'>;

/** Lo's refusal of the Mac's folder for this user's caches, for `refusal`. */
function refuse(refusal: CacheRefusal): StartupError {
  const where = refusal.path === undefined ? '' : ` (${refusal.path})`;
  const said = refusal.said === undefined ? '' : `: ${refusal.said}`;
  return new StartupError(
    { kind: 'cacheFolder', ...refusal },
    `Lo keeps its cache in the folder macOS keeps for this user’s caches${where}, but won’t use it: ${refusal.why}${said}`,
  );
}

/**
 * Why Lo won't keep its cache in `folder`, or `undefined` when it will: it must be an absolute
 * path, a folder rather than a link to one, owned by the user `uid`, and closed to changes by
 * anyone else.
 */
export function whyNotCaches(folder: string, uid: number): CacheRefusal | undefined {
  // Without the slash that ends it, which would have a link followed.
  const path = folder.length > 1 ? folder.replace(/\/+$/, '') : folder;
  if (!isAbsolute(path) || normalize(path) !== path || path.includes('\n')) {
    return { why: 'noLocation', said: JSON.stringify(folder) };
  }
  let found: Stats;
  try {
    found = lstatSync(path);
  } catch (error) {
    return { why: 'missing', path, said: describe(error) };
  }
  if (found.isSymbolicLink()) return { why: 'link', path };
  if (!found.isDirectory()) return { why: 'notFolder', path };
  if (found.uid !== uid) return { why: 'owner', path };
  if ((found.mode & 0o022) !== 0) return { why: 'writable', path };
  return undefined;
}

/**
 * Where Lo kept its cache on a Mac before it moved out of the home folder: `Lo` (`Lo Dev` for a
 * build run from source) in `~/Library/Caches`, which goes once the cache opens
 * ({@link clearFormerCache}). There's none on Linux, where the cache hasn't moved, nor in
 * `LO_USER_DATA_DIR`, where it moved only within the data folder ({@link oldDataCache}).
 */
export function formerCacheFolder(options: Placing): string | undefined {
  if (options.platform !== 'darwin') return undefined;
  if (!options.packaged && options.env.LO_USER_DATA_DIR) return undefined;
  return join(options.home, 'Library', 'Caches', options.packaged ? 'Lo' : 'Lo Dev');
}

/**
 * Removes the cache an earlier Lo kept at `former`, as the cache removes its own: moved into
 * `cache`'s `tmp/` in one rename, then deleted by {@link Cache.trash}, so nobody finds it half
 * deleted, closing the cache waits for it, and what a quit or a crash leaves goes with the cache's
 * other leftovers. On another volume, where it can't be moved, it's deleted where it is. Only a
 * folder of this user's, never a link, that holds the folders a cache always has, `git-env` and
 * `tmp`, goes, and never the cache itself, a folder holding it or one in it, however links lead.
 * It goes only under its lock: while another Lo has it open, as an older one still running can, it
 * stays, for a later start. Returns whether nothing is left at `former`, and notes why when
 * something is.
 */
export async function clearFormerCache(
  cache: Pick<Cache, 'root' | 'temporaryPath' | 'trash'>,
  former: string,
  options: { log: (line: string) => void; uid?: number },
): Promise<boolean> {
  const { log, uid = process.getuid?.() ?? -1 } = options;
  let found: Stats;
  try {
    found = await lstat(former);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return true;
    log(`can't look at ${former}: ${describe(error)}`);
    return false;
  }
  if (await overlaps(former, found, cache.root)) {
    log(`not removing ${former}, which may be the cache Lo has open, hold it or be in it`);
    return false;
  }
  if (!(await isCache(former, found, uid))) {
    log(`not removing ${former}, which isn't a cache Lo left`);
    return false;
  }
  const lockFile = join(former, 'lo-cache.lock');
  let release: () => void;
  try {
    release = await lockCache(lockFile);
  } catch (error) {
    log(`leaving ${former} for now: ${describe(error)}`);
    return false;
  }
  const aside = cache.temporaryPath('.trash');
  try {
    // Still the folder Lo looked at, now that no other Lo can open it.
    if (!same(await lstat(former), found)) throw new Error('it changed while Lo looked at it');
    await rename(former, aside);
  } catch (error) {
    if (codeOf(error) === 'EXDEV') return deleteInPlace(former, found, lockFile, release, log);
    await unlockCache(lockFile, release).catch(() => undefined);
    log(`can't remove ${former}: ${describe(error)}`);
    return false;
  }
  // Its lock moved with it.
  release();
  if (!same(await lstat(aside).catch(() => undefined), found)) {
    await putBack(
      aside,
      [former, `${former}.${randomUUID()}`, join(cache.root, randomUUID())],
      log,
    );
    return false;
  }
  try {
    await cache.trash(aside);
  } catch (error) {
    log(`can't remove ${aside}: ${describe(error)}`);
  }
  log(`removed the cache an earlier Lo kept at ${former}`);
  return true;
}

/**
 * Where a build run from source kept its cache in `LO_USER_DATA_DIR` before {@link DATA_CACHE}:
 * `cache`, which a Mac's disk takes for Chromium's own `Cache`. Lo's own folders in it go once the
 * cache opens, and everything else stays ({@link clearOldDataCache}). None outside that mode.
 */
export function oldDataCache(options: Placing): string | undefined {
  if (options.packaged || !options.env.LO_USER_DATA_DIR) return undefined;
  return join(options.env.LO_USER_DATA_DIR, 'cache');
}

/** What Lo makes in its cache's folder, by name: its lock, clones, checkouts, homes and downloads. */
const CACHE_ENTRIES = [
  'repos',
  'checkouts',
  'code',
  'servers',
  'toolchains',
  'git-env',
  'tmp',
  'lo-cache.lock',
];

/**
 * Removes what Lo made in `old`, the cache a build run from source kept in `LO_USER_DATA_DIR`
 * ({@link oldDataCache}), as the cache removes its own: each of {@link CACHE_ENTRIES} moved into
 * `cache`'s `tmp/` and deleted by {@link Cache.trash}, or, on another volume, deleted where it is.
 * A link among them goes itself, and what it leads to stays. Everything else in `old`, such as
 * Chromium's own cache, stays, and so does `old`. Only in a folder of this user's, never a link, and
 * never the cache itself, a folder holding it or one in it; only under its lock, never while another
 * Lo has it open; and with none of Lo's there, nothing is written there, not even the lock. Returns
 * whether none of Lo's is left, and notes why when some is.
 */
export async function clearOldDataCache(
  cache: Pick<Cache, 'root' | 'temporaryPath' | 'trash'>,
  old: string,
  options: { log: (line: string) => void; uid?: number },
): Promise<boolean> {
  const { log, uid = process.getuid?.() ?? -1 } = options;
  let found: Stats;
  try {
    found = await lstat(old);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return true;
    log(`can't look at ${old}: ${describe(error)}`);
    return false;
  }
  if (!found.isDirectory() || found.uid !== uid) {
    log(`not clearing ${old}, which isn't a folder of this user's`);
    return false;
  }
  if (await overlaps(old, found, cache.root)) {
    log(`not clearing ${old}, which may be the cache Lo has open, hold it or be in it`);
    return false;
  }
  const there: string[] = [];
  for (const name of CACHE_ENTRIES) {
    if (await lstat(join(old, name)).catch(() => undefined)) there.push(name);
  }
  if (there.length === 0) return true;
  const lockFile = join(old, 'lo-cache.lock');
  let release: () => void;
  try {
    release = await lockCache(lockFile);
  } catch (error) {
    log(`leaving what Lo kept in ${old} for now: ${describe(error)}`);
    return false;
  }
  try {
    for (const name of there.filter((each) => each !== 'lo-cache.lock')) {
      // Still the folder Lo looked at, and each entry moved still the one it found there.
      if (!same(await lstat(old), found)) throw new Error('it changed while Lo looked at it');
      const path = join(old, name);
      const entry = await lstat(path).catch(() => undefined);
      if (entry === undefined) continue;
      const aside = cache.temporaryPath('.trash');
      try {
        await rename(path, aside);
      } catch (error) {
        if (codeOf(error) !== 'EXDEV') throw error;
        await rm(path, { recursive: true, force: true });
        continue;
      }
      const moved = await lstat(aside).catch(() => undefined);
      if (moved?.dev !== entry.dev || moved.ino !== entry.ino) {
        await putBack(
          aside,
          [path, `${path}.${randomUUID()}`, join(cache.root, randomUUID())],
          log,
        );
        throw new Error(`${name} changed while Lo moved it`);
      }
      await cache.trash(aside).catch((error: unknown) => {
        log(`can't remove ${aside}: ${describe(error)}`);
      });
    }
  } catch (error) {
    await unlockCache(lockFile, release).catch(() => undefined);
    log(`can't clear ${old}: ${describe(error)}`);
    return false;
  }
  await unlockCache(lockFile, release).catch(() => undefined);
  log(`removed what an earlier Lo kept in ${old}`);
  return true;
}

/**
 * Deletes the cache an earlier Lo kept at `former`, which is `found`, where it is, since it's on
 * another volume than the cache: under its lock, which `release` lets go of, and each entry only
 * while `former` is still the folder Lo looked at, never through a link. The folders that make it
 * a cache go last, so a later start finishes what a quit stopped.
 */
async function deleteInPlace(
  former: string,
  found: Stats,
  lockFile: string,
  release: () => void,
  log: (line: string) => void,
): Promise<boolean> {
  const marks = ['tmp', 'git-env'];
  try {
    const names = (await readdir(former)).filter((name) => name !== 'lo-cache.lock');
    const order = [...names.filter((name) => !marks.includes(name)), ...marks];
    for (const name of order) {
      if (!same(await lstat(former), found)) throw new Error('it changed while Lo deleted it');
      await rm(join(former, name), { recursive: true, force: true });
    }
  } catch (error) {
    await unlockCache(lockFile, release).catch(() => undefined);
    log(`can't remove ${former}: ${describe(error)}`);
    return false;
  }
  await unlockCache(lockFile, release).catch(() => undefined);
  try {
    await rmdir(former);
  } catch (error) {
    log(`can't remove ${former}: ${describe(error)}`);
    return false;
  }
  log(`removed the cache an earlier Lo kept at ${former}`);
  return true;
}

/**
 * Moves what's at `aside`, which isn't what Lo checked, to the first of `places` that will take
 * it: never left in `tmp/`, whose cleanup would delete it unchecked. Notes where it is.
 */
async function putBack(
  aside: string,
  places: readonly string[],
  log: (line: string) => void,
): Promise<void> {
  for (const place of places) {
    try {
      await rename(aside, place);
      log(`not removing what took the place of the cache an earlier Lo kept, now at ${place}`);
      return;
    } catch {
      // The next place.
    }
  }
  log(`not removing what took the place of the cache an earlier Lo kept, still at ${aside}`);
}

/**
 * Whether `former`, which is `found`, is the cache's folder at `root`, holds it or is in it, by
 * what each folder is on disk rather than its path, which a link above either can lead astray.
 * When Lo can't tell, it is.
 */
async function overlaps(former: string, found: Stats, root: string): Promise<boolean> {
  try {
    const opened = await stat(root);
    return (await under(root, found)) || (await under(former, opened));
  } catch {
    return true;
  }
}

/** Whether the folder at `path`, or one above it, is the folder `folder` is. */
async function under(path: string, folder: Stats): Promise<boolean> {
  for (let at = await realpath(path); ; at = dirname(at)) {
    if (same(await stat(at), folder)) return true;
    if (at === dirname(at)) return false;
  }
}

/** Whether `found`, at `folder`, is a cache Lo made: a folder of `uid`'s with what each holds. */
async function isCache(folder: string, found: Stats, uid: number): Promise<boolean> {
  if (!found.isDirectory() || found.uid !== uid) return false;
  for (const name of ['git-env', 'tmp']) {
    if (!(await lstat(join(folder, name)).catch(() => undefined))?.isDirectory()) return false;
  }
  return true;
}

/** Whether `found` is the folder `was` is. */
function same(found: Stats | undefined, was: Stats): boolean {
  return found?.isDirectory() === true && found.dev === was.dev && found.ino === was.ino;
}

/** An error's code, such as `ENOENT`, if it has one. */
function codeOf(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

/** curl's scheme for each kind of proxy Chromium names. */
const PROXY_SCHEMES: Readonly<Record<string, string>> = {
  PROXY: 'http',
  HTTPS: 'https',
  SOCKS: 'socks4',
  SOCKS4: 'socks4',
  // Chromium has a SOCKS5 proxy look up names itself.
  SOCKS5: 'socks5h',
};

/**
 * The proxy that Chromium's answer for an address, such as `PROXY proxy:3128; DIRECT`, names, as
 * curl takes it: the first of its entries curl can use, or `undefined` for `DIRECT`, which git
 * then takes too, and for an answer naming nothing curl can use.
 */
export function curlProxy(answer: string): string | undefined {
  for (const entry of answer.split(';')) {
    const [kind = '', address = '', ...rest] = entry.trim().split(/\s+/);
    if (kind.toUpperCase() === 'DIRECT') return undefined;
    const scheme = Object.hasOwn(PROXY_SCHEMES, kind.toUpperCase())
      ? PROXY_SCHEMES[kind.toUpperCase()]
      : undefined;
    if (scheme !== undefined && rest.length === 0 && /^[^\s/@]+:\d+$/.test(address)) {
      return `${scheme}://${address}`;
    }
  }
  return undefined;
}

/** Git, as features see it: what Lo found, and the cache once it's open. */
export interface LocalGit {
  /**
   * What Lo found when it last looked for git, or `undefined` before it has: it looks once the
   * window is up.
   */
  readonly status: GitStatus | undefined;
  /** Hears what Lo finds each time it looks. */
  onStatus(listener: (status: GitStatus) => void): void;
  /**
   * Hears the cache once it opens, or at once if it's open already: a feature that waits to fetch
   * starts from here. Returns a function that stops listening.
   */
  onCache(listener: (cache: Cache) => void): () => void;
  /**
   * Lo's local copies of repositories: `undefined` until git is found and the cache is open, and
   * while Lo has no git. Open a repository with its account's token as a source, read as each
   * fetch starts; the cache adds the proxy Lo's own requests take.
   */
  readonly cache: Cache | undefined;
  /**
   * Looks for git again, as "Check again" asks, and opens the cache once there's one. Once git has
   * stopped, as Lo quits, it fails with {@link GitStopped} and runs nothing.
   */
  check(): Promise<GitStatus>;
  /** Sets the size the cache is kept under, in bytes, as Settings will. */
  setCap(bytes: number): Promise<void>;
}

/** Git as main runs it. */
export interface MainGit extends LocalGit {
  /**
   * Stops every git running, a look for git's included, and closes the cache, as Lo quits, waiting
   * {@link STOP_LIMIT} at most. Nothing runs git after.
   */
  stop(): Promise<void>;
}

/** Why a look for git failed, or was refused: git has stopped, as Lo quits. */
export class GitStopped extends Error {
  constructor() {
    super('Lo has stopped running git, as it quits.');
    this.name = 'GitStopped';
  }
}

export interface GitOptions {
  readonly settings: GitSettings;
  /** The cache's folder, made when the cache first opens. */
  readonly root: string;
  /** Where an earlier Lo kept its cache, which goes once the cache opens. */
  readonly former?: string | undefined;
  /**
   * The cache a build run from source kept in `LO_USER_DATA_DIR` before, whose folders Lo made go
   * once the cache opens ({@link clearOldDataCache}).
   */
  readonly oldData?: string | undefined;
  /** Lo's environment: where git is looked for, and the few variables git keeps from it. */
  readonly env: Environment;
  readonly platform: NodeJS.Platform;
  /** The proxy Lo's own requests take to an address. */
  readonly proxy?: ProxySource | undefined;
  /** Gets a line for each failure, and each thing the cache notes. */
  readonly log: (line: string) => void;
  /** What runs once the cache opens: its cleanup, unless a test says otherwise. */
  readonly cleanUp?: ((cache: Cache) => Promise<unknown>) | undefined;
}

/** How long quitting waits, at most, for git to stop and the cache to close. */
export const STOP_LIMIT = 5000;

/** How long main waits for the window to say it's up before it looks for git anyway. */
export const LOOK_AFTER = 3000;

/**
 * Calls `look` once: as soon as `whenUp` hears the window is up, or after `limit` milliseconds if
 * it hasn't by then, so a window that never says so doesn't keep Lo from looking for git.
 */
export function onceUp(
  whenUp: (up: () => void) => void,
  look: () => void,
  limit = LOOK_AFTER,
): void {
  let looked = false;
  const once = () => {
    clearTimeout(timer);
    if (looked) return;
    looked = true;
    look();
  };
  const timer = setTimeout(once, limit);
  whenUp(once);
}

/**
 * Git for main. It looks for nothing until asked to {@link LocalGit.check}, which main does once
 * the window is up.
 */
export function createGit(options: GitOptions): MainGit {
  return new GitHost(options);
}

class GitHost implements MainGit {
  readonly #options: GitOptions;
  #status: GitStatus | undefined;
  readonly #listeners = new Set<(status: GitStatus) => void>();
  readonly #cacheListeners = new Set<(cache: Cache) => void>();
  #cache: Cache | undefined;
  #cap = DEFAULT_CAP;
  /** The look for git under way, which every check asked for meanwhile shares. */
  #checking: Promise<GitStatus> | undefined;
  /** Aborted as Lo quits, which stops a look under way. */
  readonly #stopping = new AbortController();

  constructor(options: GitOptions) {
    this.#options = options;
  }

  get status(): GitStatus | undefined {
    return this.#status;
  }

  get cache(): Cache | undefined {
    return this.#cache;
  }

  onStatus(listener: (status: GitStatus) => void): void {
    this.#listeners.add(listener);
  }

  onCache(listener: (cache: Cache) => void): () => void {
    this.#cacheListeners.add(listener);
    if (this.#cache) this.#tell(listener, this.#cache);
    return () => {
      this.#cacheListeners.delete(listener);
    };
  }

  /** Gives `cache` to `listener`, noting a listener that fails rather than failing the open. */
  #tell(listener: (cache: Cache) => void, cache: Cache): void {
    try {
      listener(cache);
    } catch (error) {
      this.#options.log(`can't hand on the cache: ${describe(error)}`);
    }
  }

  check(): Promise<GitStatus> {
    if (this.#stopped) return Promise.reject(new GitStopped());
    this.#checking ??= this.#look().finally(() => {
      this.#checking = undefined;
    });
    return this.#checking;
  }

  async setCap(bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new RangeError(`The cache’s cap is a whole number of bytes over 0, not ${bytes}.`);
    }
    this.#cap = bytes;
    await this.#cache?.setCap(bytes);
  }

  get #stopped(): boolean {
    return this.#stopping.signal.aborted;
  }

  async stop(): Promise<void> {
    // A look under way stops its gits, or, if it's opening the cache, stops that itself.
    this.#stopping.abort(new GitStopped());
    const cache = this.#cache;
    this.#cache = undefined;
    const log = (error: unknown) => this.#options.log(`can't stop git: ${describe(error)}`);
    const looked = this.#checking?.catch((error: unknown) => {
      if (!(error instanceof GitStopped)) log(error);
    });
    await within(STOP_LIMIT, Promise.all([cache?.stop().catch(log), looked]));
  }

  async #look(): Promise<GitStatus> {
    const status = await this.#find();
    if (this.#stopped) throw new GitStopped();
    this.#status = status;
    for (const listener of this.#listeners) {
      try {
        listener(status);
      } catch (error) {
        this.#options.log(`can't tell what Lo found of git: ${describe(error)}`);
      }
    }
    if (status.status === 'found' && this.#cache === undefined) await this.#open(status.git);
    return status;
  }

  #find(): Promise<GitStatus> {
    const { settings, env, platform } = this.#options;
    if (settings.program === 'none') {
      return Promise.resolve({ status: 'missing', install: installAdvice(platform, 'missing') });
    }
    const { signal } = this.#stopping;
    if (settings.program !== undefined) return gitAt(settings.program, { env, platform, signal });
    return findGit({ env, platform, signal });
  }

  async #open(git: Git): Promise<void> {
    const { root, log, settings, proxy } = this.#options;
    let cache: Cache;
    try {
      cache = await Cache.open({ root, git, log, test: settings.test, cap: this.#cap, proxy });
    } catch (error) {
      log(`can't open the cache at ${root}: ${describe(error)}`);
      return;
    }
    if (this.#stopped) {
      await cache.stop();
      return;
    }
    this.#cache = cache;
    for (const listener of this.#cacheListeners) this.#tell(listener, cache);
    // Nothing waits for cleanup, and a failure is only noted.
    void this.#cleanUp(cache);
  }

  async #cleanUp(cache: Cache): Promise<void> {
    const { former, oldData, log } = this.#options;
    // First, so the earlier cache is out of the way before this one's own cleanup.
    if (former !== undefined) {
      await clearFormerCache(cache, former, { log }).catch((error: unknown) => {
        log(`can't remove ${former}: ${describe(error)}`);
      });
    }
    if (oldData !== undefined) {
      await clearOldDataCache(cache, oldData, { log }).catch((error: unknown) => {
        log(`can't clear ${oldData}: ${describe(error)}`);
      });
    }
    try {
      // A cap set while the cache was opening.
      if (cache.cap !== this.#cap) await cache.setCap(this.#cap);
      await (this.#options.cleanUp ?? ((opened: Cache) => opened.cleanUp()))(cache);
    } catch (error) {
      this.#options.log(`can't clean up the cache: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Waits for `promise`, or `milliseconds`, whichever comes first. */
async function within(milliseconds: number, promise: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  try {
    await Promise.race([promise, elapsed]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why Lo has no git it can run, as the window hears it: parts, never a sentence. A git someone
 * else could change names what's true of it, and the system's words, behind Details.
 */
export function troubleOf(status: Exclude<GitStatus, { status: 'found' }>): GitTrouble {
  const install = { commands: [...status.install.commands], page: status.install.page ?? null };
  switch (status.status) {
    case 'missing':
      return { status: 'missing', install };
    case 'distrusted':
      return {
        status: 'distrusted',
        program: status.program,
        why: status.distrust.why,
        details: `${status.program}\n${describeDistrust(status.distrust)}`,
        install,
      };
    case 'tooOld':
      return {
        status: 'tooOld',
        program: status.program,
        version: formatVersion(status.version),
        minimum: formatVersion(status.minimum),
        check: status.check,
        install,
      };
    default:
      throw new Error(
        `What Lo found of git isn’t known: ${JSON.stringify(status satisfies never)}`,
      );
  }
}
