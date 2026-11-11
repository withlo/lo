import { isAbsolute, join } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Where Lo keeps its data, or undefined to keep Electron's default (`<appData>/Lo`).
 *
 * A packaged build always uses the default. An unpackaged one keeps its own folder, so a copy built
 * from source never touches an installed Lo's data, and uses `LO_USER_DATA_DIR` when it's set, so
 * each test can start from an empty folder.
 */
export function dataFolder(options: {
  packaged: boolean;
  appData: string;
  env: Environment;
}): string | undefined {
  if (options.packaged) return undefined;
  const chosen = options.env.LO_USER_DATA_DIR;
  if (chosen) {
    if (!isAbsolute(chosen)) {
      throw new Error(`LO_USER_DATA_DIR must be an absolute path, not "${chosen}".`);
    }
    return chosen;
  }
  return join(options.appData, 'Lo Dev');
}

/**
 * The address of Vite's dev server, which `electron-vite dev` passes in `ELECTRON_RENDERER_URL`.
 * Only an unpackaged build reads it, and only a server on this machine counts, so a packaged Lo
 * always loads its own files.
 */
export function devServer(options: { packaged: boolean; env: Environment }): URL | undefined {
  const address = options.env.ELECTRON_RENDERER_URL;
  if (options.packaged || !address) return undefined;
  const url = URL.parse(address);
  const local = url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
  if (!url || url.protocol !== 'http:' || !local) {
    throw new Error(
      `ELECTRON_RENDERER_URL must be an http address on this machine, not "${address}".`,
    );
  }
  return url;
}

/**
 * Whether Lo offers the developer tools: only when it runs from source on Vite's dev server
 * (`desktop:dev`). A packaged build never does, and neither does a build run as it would ship, so
 * its smoke test can check that their keys do nothing.
 */
export function devTools(options: { packaged: boolean; env: Environment }): boolean {
  return devServer(options) !== undefined;
}

/** The background process's settings. */
export interface BackgroundSettings {
  /** Whether it offers the smoke test's jobs. */
  testJobs: boolean;
  /** The memory, in bytes, past which main restarts it. */
  memoryCap: number;
}

/**
 * The background process's settings. Its memory cap is 2 GB. A build run from source offers the
 * smoke test's jobs with `LO_TEST_JOBS=1`, and takes another cap from `LO_BACKGROUND_MEMORY_CAP_MB`
 * so the test can pass it without taking 2 GB. A packaged build ignores both.
 */
export function backgroundSettings(options: {
  packaged: boolean;
  env: Environment;
}): BackgroundSettings {
  const settings = { testJobs: false, memoryCap: 2 * 1024 ** 3 };
  if (options.packaged) return settings;
  const cap = options.env.LO_BACKGROUND_MEMORY_CAP_MB;
  if (cap !== undefined && !/^[1-9]\d*$/.test(cap)) {
    throw new Error(
      `LO_BACKGROUND_MEMORY_CAP_MB must be a whole number of megabytes, not "${cap}".`,
    );
  }
  return {
    testJobs: options.env.LO_TEST_JOBS === '1',
    memoryCap: cap === undefined ? settings.memoryCap : Number(cap) * 1024 ** 2,
  };
}

/**
 * The background process's whole environment. Electron passes main's on to a utility process
 * unless it's given a map with something in it, so this always has a marker and the memory cap
 * (which sizes the process's pool of workers), plus the switch for the test jobs when they're on:
 * nothing of main's, and so no token, reaches the process.
 */
export function backgroundEnvironment(settings: BackgroundSettings): Record<string, string> {
  return {
    LO_BACKGROUND: '1',
    LO_BACKGROUND_MEMORY_CAP_MB: String(Math.floor(settings.memoryCap / 1024 ** 2)),
    ...(settings.testJobs ? { LO_TEST_JOBS: '1' } : {}),
  };
}
