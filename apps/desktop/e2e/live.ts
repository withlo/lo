// What a live run of the app needs (`live` in app.ts, which `live.config.ts` turns on): Lo on
// GitHub itself, with the system's keychain rather than Chromium's stand-in for it, in a data
// folder the run names. Nothing here starts Lo.

import { readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { configFolder, DEV_NAME } from '../src/main/environment.ts';
import { cacheFolder, formerCacheFolder, macCaches } from '../src/main/git.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/** Where a live run is, for the folders a Lo someone uses keeps its data in. */
export interface Where {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Environment;
  /** The Mac's folder for this user's caches, as Lo finds it: `macCaches`, unless a test says. */
  readonly macCaches?: (() => string) | undefined;
}

/**
 * The preload a live run starts Electron with, after Playwright's own: it takes off Chromium's
 * stand-ins for the system's keychain, which Playwright's adds to every Electron it starts.
 */
export const SYSTEM_KEYCHAIN = fileURLToPath(new URL('keychain.cjs', import.meta.url));

/** An argument that asks Chromium for a stand-in for the system's keychain. */
const STAND_IN = /^--(?:use-mock-keychain|password-store)(?:=|$)/;

/** What marks a folder Lo made: the database it keeps in its data folder. */
const DATABASE = 'lo.db';

/**
 * What a live run's folder may hold before Lo has made it its own: what the harness puts there for
 * it (the stand-ins for the editor and the browser, what they were asked to open, and the keymap
 * and settings), and what a Mac's Finder leaves in a folder it shows.
 */
const BEFORE_LO = new Set(['editor', 'opened', 'browser', 'browsed', 'config', '.DS_Store']);

/**
 * `path`, an absolute one, by its real path: each link in the part of it that exists followed, and
 * the names past that added as they are, a `..` among them taking the name before it away.
 */
export function realPath(path: string): string {
  let real = realpathSync('/');
  let rest: string[] = [];
  for (const name of path.split(sep)) {
    if (name === '' || name === '.') continue;
    if (rest.length > 0) {
      rest = name === '..' ? rest.slice(0, -1) : [...rest, name];
      continue;
    }
    try {
      // The folder above one that exists is the real one's, whatever link led there.
      real = realpathSync(join(real, name));
    } catch {
      rest = [name];
    }
  }
  return join(real, ...rest);
}

/** Where Electron keeps apps' data folders, as `app.getPath('appData')` says. */
function appData(platform: NodeJS.Platform, home: string, env: Environment): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  const xdg = env.XDG_CONFIG_HOME;
  return xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, '.config');
}

/**
 * The folders a Lo someone uses keeps its data, settings and cache in, the installed Lo's and a
 * build run from source's own, by their real paths: with the XDG folders the run names, and
 * without, as Lo started elsewhere finds them.
 */
function usedFolders(where: Where): string[] {
  const { platform, home } = where;
  let caches: string | undefined;
  const macFolder = () => (caches ??= (where.macCaches ?? macCaches)());
  const envs = [
    { ...where.env, LO_USER_DATA_DIR: undefined },
    {
      ...where.env,
      LO_USER_DATA_DIR: undefined,
      XDG_CONFIG_HOME: undefined,
      XDG_CACHE_HOME: undefined,
    },
  ];
  const folders = envs.flatMap((env) => {
    const data = appData(platform, home, env);
    const caching = [true, false].flatMap((packaged) => {
      const placing = { packaged, platform, home, env };
      return [cacheFolder({ ...placing, macFolder }), formerCacheFolder(placing) ?? []].flat();
    });
    return [
      // The installed Lo goes by its product name, `Lo`.
      join(data, 'Lo'),
      join(data, DEV_NAME),
      configFolder({ packaged: true, platform, home, appData: data, env }),
      ...caching,
    ];
  });
  return [...new Set(folders.map(realPath))];
}

/** Whether `folder` is `other` or inside it, as the platform's file system compares names. */
function within(folder: string, other: string, platform: NodeJS.Platform): boolean {
  // A Mac's disk takes names whatever their case.
  const fold = (path: string) => (platform === 'darwin' ? path.toLowerCase() : path);
  const path = relative(fold(other), fold(folder));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** What `folder` holds, by name: nothing when it isn't there yet. */
function held(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw new Error(`LO_USER_DATA_DIR is ${folder}, which Lo can't keep its data in.`, {
      cause: error,
    });
  }
}

/**
 * Lo's data folder in a live run: the folder `LO_USER_DATA_DIR` names, by its real path, which the
 * run must set to an absolute path. Every folder a Lo someone uses keeps its data, settings or
 * cache in must be neither it, nor in it, nor hold it: deleting the run's folder when it's done
 * deletes nothing of theirs. It must be empty, or not there yet, unless Lo made it, as a build run
 * from source does when it's signed in there first: anything else in it is someone's. Throws, saying
 * why, otherwise.
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
  const folder = realPath(chosen);
  const { platform } = where;
  for (const used of usedFolders(where)) {
    const inside = within(folder, used, platform);
    if (inside || within(used, folder, platform)) {
      throw new Error(
        `LO_USER_DATA_DIR is ${folder}, which ${inside ? 'is in' : 'holds'} ${used}, where a Lo you use keeps its data. A live run needs a folder of its own, apart from it.`,
      );
    }
  }
  const names = held(folder);
  if (!names.includes(DATABASE) && names.some((name) => !BEFORE_LO.has(name))) {
    throw new Error(
      `LO_USER_DATA_DIR is ${folder}, which holds files Lo didn't make. A live run needs an empty folder, or one Lo made.`,
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
