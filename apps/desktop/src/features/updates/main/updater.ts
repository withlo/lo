// electron-updater, as Lo uses it: its GitHub provider reads the releases feed of withlo/lo and the
// release's `latest-*.yml`, and downloads from GitHub's release hosts, with no token and no service
// in between. Where Lo installs updates itself, a Mac in an Applications folder it can write, it's
// electron-updater's `MacUpdater`, which checks the download's SHA-512 and hands it to Squirrel.Mac;
// Squirrel installs it only if it's signed as the running Lo is. Everywhere else it's an updater
// that checks and can't download at all. Neither downloads until asked, neither installs downgrades,
// and neither keeps an id of this copy of Lo to send.
//
// Both change two things about electron-updater's checks. Lo can give up on one, which then fails
// at once, so the next asks the feed again: under Electron, electron-updater's own time limit never
// fires, and it hands every later check the one still waiting. And a prerelease of Lo is offered
// the newest release as well as its channel's newest prerelease, where electron-updater offers it
// only the prerelease. This module doesn't call Electron itself, so it runs under unit tests;
// electron-updater's own updaters do.

import {
  AppUpdater,
  CancellationToken,
  MacUpdater,
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateInfo,
} from 'electron-updater';
import type {
  DownloadExecutorResult,
  DownloadUpdateOptions,
  UpdateInfoAndProvider,
} from 'electron-updater/out/AppUpdater.js';

import { isVersion } from '../contract.ts';
import type { Feed } from './feed.ts';
import { updaterLogger } from './log.ts';
import { abortedBy, type Release, type Updater } from './updates.ts';
import { compareVersions, isPrerelease } from './versions.ts';

/** What electron-updater's updaters take for the app: Electron's, without one given. */
type AppAdapter = ConstructorParameters<typeof MacUpdater>[1];

/**
 * The id electron-updater would send with each check, `x-user-staging-id`, for staged rollouts,
 * which Lo has none of. Without this, it makes one up for each copy of Lo and keeps it, and GitHub
 * could tell one copy of Lo's checks from another's. With it, every copy sends the same.
 */
export const NO_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The folders a Mac keeps its own programs in, as the `PATH` an app opened from the Dock or the
 * Finder gets.
 */
export const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/** What electron-updater found reading the feed: the newest release's info, among other things. */
interface Found {
  readonly info: UpdateInfo;
}

/** What a reading of the feed came to: what it found, or why it failed. */
type Reading<T> = { readonly found: T } | { readonly failed: unknown };

/** How `reading` went, without throwing. */
function settle<T>(reading: Promise<T>): Promise<Reading<T>> {
  return reading.then(
    (found) => ({ found }),
    (failed: unknown) => ({ failed }),
  );
}

/** Whether `a` is a version Lo is released as, and newer than `b`, or `b` isn't one. */
function newer(a: string, b: string): boolean {
  return isVersion(a) && (!isVersion(b) || compareVersions(a, b) > 0);
}

/**
 * The newest release `updater` may take, as `read`, electron-updater's own reading of the feed,
 * finds it. For a release of Lo, that's one reading, of GitHub's latest release. For a prerelease,
 * electron-updater offers only the next prerelease of its own channel (`rc`), never a release, so
 * Lo reads the feed twice: for that prerelease, and, with prereleases off, for the latest release;
 * the newer counts, or whichever was found. electron-updater reads `allowPrerelease` as it goes, so
 * each reading sets it first, and none does once `signal` has given up on the check: a reading
 * given up on may still be going when the next check starts.
 */
async function newest<T extends Found>(
  updater: AppUpdater,
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (!isPrerelease(updater.currentVersion.version)) return read();
  updater.allowPrerelease = true;
  const prerelease = await settle(read());
  signal.throwIfAborted();
  updater.allowPrerelease = false;
  const release = await settle(read());
  signal.throwIfAborted();
  updater.allowPrerelease = true;
  if ('found' in release) {
    if (!('found' in prerelease)) return release.found;
    if (newer(release.found.info.version, prerelease.found.info.version)) return release.found;
  }
  if ('found' in prerelease) return prerelease.found;
  throw prerelease.failed;
}

/** `promise`, until `signal` aborts: then it fails at once, and how `promise` settles is dropped. */
function until<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const drop = () => reject(abortedBy(signal));
    if (signal.aborted) drop();
    else signal.addEventListener('abort', drop, { once: true });
    promise.then(resolve, reject);
  });
}

/**
 * The checks Lo's updaters make: each until Lo gives up on it, and, for a prerelease of Lo, of the
 * newest release too. One for each updater, whose `getUpdateInfoAndProvider` reads through it.
 */
class Checks {
  /** What gives up on the check electron-updater is making. */
  #signal: AbortSignal | undefined;

  /**
   * Runs `check`, electron-updater's `checkForUpdates`, until `signal` gives up on it: then its
   * reading of the feed fails, so electron-updater's check does, and electron-updater forgets it.
   */
  async run(signal: AbortSignal, check: () => Promise<UpdateCheckResult | null>) {
    this.#signal = signal;
    try {
      return await check();
    } finally {
      if (this.#signal === signal) this.#signal = undefined;
    }
  }

  /** electron-updater's reading of the feed (`read`), for `updater`, as {@link newest} says. */
  read<T extends Found>(updater: AppUpdater, read: () => Promise<T>): Promise<T> {
    // electron-updater checks by itself only when told to, which Lo never does.
    const signal = this.#signal ?? new AbortController().signal;
    return until(signal, newest(updater, read, signal));
  }
}

/** electron-updater's checks, with no installer: for every copy of Lo that updates another way. */
export class CheckingUpdater extends AppUpdater {
  readonly #checks = new Checks();

  constructor(app?: AppAdapter) {
    super(null, app);
    this.stagingUserIdPromise.value = Promise.resolve(NO_ID);
  }

  /** electron-updater's check, until `signal` gives up on it. */
  checkUntil(signal: AbortSignal): Promise<UpdateCheckResult | null> {
    return this.#checks.run(signal, () => this.checkForUpdates());
  }

  protected override getUpdateInfoAndProvider(): Promise<UpdateInfoAndProvider> {
    return this.#checks.read(this, () => super.getUpdateInfoAndProvider());
  }

  protected doDownloadUpdate(): Promise<never> {
    return Promise.reject(new Error('This copy of Lo doesn’t install updates itself.'));
  }

  quitAndInstall(): void {
    throw new Error('This copy of Lo doesn’t install updates itself.');
  }
}

/** electron-updater's updater for a Mac, for a copy of Lo that installs updates itself. */
export class InstallingUpdater extends MacUpdater {
  readonly #checks = new Checks();

  constructor(app?: AppAdapter) {
    super(undefined, app);
    this.stagingUserIdPromise.value = Promise.resolve(NO_ID);
  }

  /** electron-updater's check, until `signal` gives up on it. */
  checkUntil(signal: AbortSignal): Promise<UpdateCheckResult | null> {
    return this.#checks.run(signal, () => this.checkForUpdates());
  }

  protected override getUpdateInfoAndProvider(): Promise<UpdateInfoAndProvider> {
    return this.#checks.read(this, () => super.getUpdateInfoAndProvider());
  }

  /**
   * electron-updater's download, which first runs `sysctl` and `uname` to tell an Apple silicon
   * Mac, and so which zip to download: the system's own, with `PATH` set to {@link SYSTEM_PATH},
   * never whichever `PATH` finds first. Both run before the download first waits, so `PATH` is
   * changed only for that synchronous stretch, and set back before this returns. No other
   * JavaScript runs meanwhile, so none of Lo's code that reads `PATH` (finding git and gh, and the
   * environments it builds for the programs it runs) can see it changed; a thread that reads it
   * then gets the `PATH` a Lo opened from the Dock has anyway.
   */
  protected override doDownloadUpdate(
    options: DownloadUpdateOptions,
  ): Promise<DownloadExecutorResult> {
    const path = process.env.PATH;
    process.env.PATH = SYSTEM_PATH;
    let download: Promise<DownloadExecutorResult>;
    try {
      download = super.doDownloadUpdate(options);
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
    }
    return download;
  }
}

/** One of Lo's updaters. */
export type LoUpdater = CheckingUpdater | InstallingUpdater;

/**
 * Sets `updater` up as Lo uses it, to check `feed`: it downloads only when asked to, never offers
 * an older version, reads only the newest release's notes, logs to `log`, and, where Lo installs
 * updates itself (`installs`), installs a downloaded update as Lo quits. A feed on this machine is
 * checked from a build run from source, which electron-updater otherwise leaves alone.
 */
export function configure(
  updater: AppUpdater,
  options: { feed: Feed; installs: boolean; log: (line: string) => void },
): void {
  updater.logger = updaterLogger(options.log);
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = options.installs;
  updater.allowDowngrade = false;
  updater.fullChangelog = false;
  updater.forceDevUpdateConfig = options.feed.host !== undefined;
  updater.setFeedURL({ ...options.feed });
}

/** Squirrel.Mac's word on an update electron-updater handed it: ready to install, or why not. */
export interface Squirrel {
  /** Calls `ready` once Squirrel has the update ready, or `failed` once it can't. */
  listen(ready: () => void, failed: (error: Error) => void): () => void;
}

/**
 * `updater`, as the updates feature uses it. Where Lo installs updates itself, `squirrel` says when
 * the update downloaded is ready to install: only once Squirrel has it, and has checked its
 * signature, is it ready.
 */
export function adapt(updater: LoUpdater, squirrel?: Squirrel): Updater {
  let token: CancellationToken | undefined;
  return {
    async check(signal): Promise<Release> {
      const result = await updater.checkUntil(signal);
      if (result === null) throw new Error('electron-updater checks nothing in this copy of Lo.');
      const { version, releaseNotes } = result.updateInfo;
      return { version, notes: releaseNotes };
    },

    async download(progress) {
      const going = new CancellationToken();
      token = going;
      const onProgress = (info: ProgressInfo) => progress(info.transferred, info.total);
      updater.on('download-progress', onProgress);
      let stop: (() => void) | undefined;
      // Listened to first: Squirrel says so after electron-updater's download is done.
      const ready = squirrel
        ? new Promise<void>((resolve, reject) => {
            stop = squirrel.listen(resolve, reject);
          })
        : Promise.resolve();
      // Settled by itself if the download fails first.
      ready.catch(() => {});
      try {
        await updater.downloadUpdate(going);
        await ready;
      } finally {
        stop?.();
        updater.off('download-progress', onProgress);
        if (token === going) token = undefined;
      }
    },

    cancel() {
      token?.cancel();
    },

    install() {
      return new Promise<void>((_resolve, reject) => {
        // Squirrel says it failed as an error: electron-updater's `quitAndInstall` returns at once.
        updater.once('error', reject);
        updater.quitAndInstall();
      });
    },
  };
}
