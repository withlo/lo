// Git in main, the only process that runs it: finding git, the cache it works in, what Lo found,
// for the window, cleanup once the window is up, and stopping every git as Lo quits. Nothing here
// calls Electron, so it runs under unit tests; `index.ts` hands it what it needs of Electron.

import { isAbsolute, join } from 'node:path';

import {
  Cache,
  DEFAULT_CAP,
  findGit,
  type Git,
  gitAt,
  type GitStatus,
  installAdvice,
  type ProxySource,
  type TestSettings,
} from '@lo/git';

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

/**
 * Where Lo keeps its local copies of repositories: `Lo` in the system's folder for caches
 * (`~/Library/Caches` on a Mac, `$XDG_CACHE_HOME` or `~/.cache` on Linux), and `Lo Dev` for a
 * build run from source, so it never touches an installed Lo's. A build run from source with
 * `LO_USER_DATA_DIR` keeps it there, in `cache`, so each test starts empty.
 */
export function cacheFolder(options: {
  packaged: boolean;
  platform: NodeJS.Platform;
  home: string;
  env: Environment;
}): string {
  const { env } = options;
  if (!options.packaged && env.LO_USER_DATA_DIR) return join(env.LO_USER_DATA_DIR, 'cache');
  const xdg = env.XDG_CACHE_HOME;
  const caches =
    options.platform === 'darwin'
      ? join(options.home, 'Library', 'Caches')
      : xdg !== undefined && isAbsolute(xdg)
        ? xdg
        : join(options.home, '.cache');
  return join(caches, options.packaged ? 'Lo' : 'Lo Dev');
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

  check(): Promise<GitStatus> {
    if (this.#stopped) return Promise.reject(new GitStopped());
    this.#checking ??= this.#look().finally(() => {
      this.#checking = undefined;
    });
    return this.#checking;
  }

  async setCap(bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new RangeError(`The cache's cap is a whole number of bytes over 0, not ${bytes}.`);
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
      return Promise.resolve({
        status: 'missing',
        message: "Lo can't find git.",
        install: installAdvice(platform),
      });
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
    // Nothing waits for cleanup, and a failure is only noted.
    void this.#cleanUp(cache);
  }

  async #cleanUp(cache: Cache): Promise<void> {
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
