// What a live run of the app needs (`live` in app.ts): Lo on GitHub itself, with the system's
// keychain rather than Chromium's stand-in for it, in a data folder the run names. Nothing here
// starts Lo.

import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { configFolder, DEV_NAME } from '../src/main/environment.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/** Where a live run is, for the folders a Lo someone uses keeps its data in. */
export interface Where {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Environment;
}

/**
 * The preload a live run starts Electron with, after Playwright's own: it takes off Chromium's
 * stand-ins for the system's keychain, which Playwright's adds to every Electron it starts.
 */
export const SYSTEM_KEYCHAIN = fileURLToPath(new URL('keychain.cjs', import.meta.url));

/** An argument that asks Chromium for a stand-in for the system's keychain. */
const STAND_IN = /^--(?:use-mock-keychain|password-store)(?:=|$)/;

/** Where Electron keeps apps' data folders, as `app.getPath('appData')` says. */
function appData({ platform, home, env }: Where): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  const xdg = env.XDG_CONFIG_HOME;
  return xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, '.config');
}

/** Whether `folder` is `other` or inside it, as the platform's file system compares names. */
function within(folder: string, other: string, platform: NodeJS.Platform): boolean {
  // A Mac's disk takes names whatever their case.
  const fold = (path: string) => (platform === 'darwin' ? path.toLowerCase() : path);
  const path = relative(fold(other), fold(folder));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * Lo's data folder in a live run: the folder `LO_USER_DATA_DIR` names, which the run must set, to
 * an absolute path outside the data of any Lo someone uses: the installed Lo's (`Lo`), a build run
 * from source's own (`Lo Dev`), and the keymap and settings in `~/.config/lo`. Throws, saying why,
 * otherwise.
 */
export function liveDataFolder(where: Where): string {
  const chosen = where.env.LO_USER_DATA_DIR;
  if (chosen === undefined || chosen === '') {
    throw new Error(
      "A live run keeps Lo's data in the folder LO_USER_DATA_DIR names. Set it to a folder of the run's own.",
    );
  }
  if (!isAbsolute(chosen)) {
    throw new Error(`LO_USER_DATA_DIR must be an absolute path, not "${chosen}".`);
  }
  const folder = resolve(chosen);
  const data = appData(where);
  const used = [
    // The installed Lo goes by its product name, `Lo`.
    join(data, 'Lo'),
    join(data, DEV_NAME),
    configFolder({
      packaged: true,
      platform: where.platform,
      home: where.home,
      appData: data,
      env: where.env,
    }),
  ];
  const taken = used.find((each) => within(folder, each, where.platform));
  if (taken !== undefined) {
    throw new Error(
      `LO_USER_DATA_DIR is ${folder}, in ${taken}, where a Lo you use keeps its data. A live run needs a folder of its own.`,
    );
  }
  return folder;
}

/**
 * What Electron starts Lo with in a live run: `args`, after the preload that takes the keychain's
 * stand-ins off. Throws for an argument that asks for one.
 */
export function liveArgs(args: readonly string[]): string[] {
  const asked = args.find((arg) => STAND_IN.test(arg));
  if (asked !== undefined) {
    throw new Error(`A live run uses the system's keychain: leave ${asked} out of its arguments.`);
  }
  return ['-r', SYSTEM_KEYCHAIN, ...args];
}
