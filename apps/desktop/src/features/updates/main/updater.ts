// electron-updater, as Lo uses it: its GitHub provider reads the releases feed of withlo/lo and the
// release's `latest-*.yml`, and downloads from GitHub's release hosts, with no token and no service
// in between. Where Lo installs updates itself, a Mac in an Applications folder it can write, it's
// electron-updater's `MacUpdater`, which checks the download's SHA-512 and hands it to Squirrel.Mac;
// Squirrel installs it only if it's signed as the running Lo is. Everywhere else it's an updater
// that checks and can't download at all. Neither downloads until asked, neither installs downgrades,
// and neither keeps an id of this copy of Lo to send. This module doesn't call Electron itself, so
// it runs under unit tests; electron-updater's own updaters do.

import { AppUpdater, CancellationToken, MacUpdater, type ProgressInfo } from 'electron-updater';

import type { Feed } from './feed.ts';
import { updaterLogger } from './log.ts';
import type { Release, Updater } from './updates.ts';

/** What electron-updater's updaters take for the app: Electron's, without one given. */
type AppAdapter = ConstructorParameters<typeof MacUpdater>[1];

/**
 * The id electron-updater would send with each check, `x-user-staging-id`, for staged rollouts,
 * which Lo has none of. Without this, it makes one up for each copy of Lo and keeps it, and GitHub
 * could tell one copy of Lo's checks from another's. With it, every copy sends the same.
 */
export const NO_ID = '00000000-0000-0000-0000-000000000000';

/** electron-updater's checks, with no installer: for every copy of Lo that updates another way. */
export class CheckingUpdater extends AppUpdater {
  constructor(app?: AppAdapter) {
    super(null, app);
    this.stagingUserIdPromise.value = Promise.resolve(NO_ID);
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
  constructor(app?: AppAdapter) {
    super(undefined, app);
    this.stagingUserIdPromise.value = Promise.resolve(NO_ID);
  }
}

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
export function adapt(updater: AppUpdater, squirrel?: Squirrel): Updater {
  let token: CancellationToken | undefined;
  return {
    async check(): Promise<Release> {
      const result = await updater.checkForUpdates();
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
