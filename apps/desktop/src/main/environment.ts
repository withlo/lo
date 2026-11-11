import { isAbsolute, join } from 'node:path';

import { GITHUB_URLS, type GitHubUrls } from '@lo/github';

type Environment = Readonly<Record<string, string | undefined>>;

/** What a build run from source goes by, beside an installed Lo: its data folder and cache too. */
export const DEV_NAME = 'Lo Dev';

/**
 * The name Lo goes by, or undefined to keep the one Electron takes from `package.json` ("Lo").
 *
 * A build run from source goes by {@link DEV_NAME}, so it never shares the installed Lo's key in the
 * system's keychain ("Lo Safe Storage"), which `safeStorage` names after the app. A build run from
 * source runs on Electron's own app, which every project built on it shares, so the installed
 * Lo's key must never trust it.
 */
export function appName(options: { packaged: boolean }): string | undefined {
  return options.packaged ? undefined : DEV_NAME;
}

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
  return join(options.appData, DEV_NAME);
}

/**
 * Where Lo keeps the files people edit: the keymap, and Settings' file. That's `~/.config/lo` on a
 * Mac, and `$XDG_CONFIG_HOME/lo` or `~/.config/lo` on Linux. A build run from source keeps them in
 * `config` in its data folder (`LO_USER_DATA_DIR` or its own `Lo Dev`), so it never touches an
 * installed Lo's and each test starts with none.
 */
export function configFolder(options: {
  packaged: boolean;
  platform: NodeJS.Platform;
  home: string;
  appData: string;
  env: Environment;
}): string {
  const data = dataFolder(options);
  if (data !== undefined) return join(data, 'config');
  const xdg = options.env.XDG_CONFIG_HOME;
  const config =
    options.platform !== 'darwin' && xdg !== undefined && isAbsolute(xdg)
      ? xdg
      : join(options.home, '.config');
  return join(config, 'lo');
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
 * The program that opens the keymap file in place of the system's text editor, from
 * `LO_KEYMAP_EDITOR`, so a test can see what Lo opens without starting an editor. It gets the
 * file's path as its one argument. A packaged build ignores it.
 */
export function keymapEditor(options: { packaged: boolean; env: Environment }): string | undefined {
  const program = options.env.LO_KEYMAP_EDITOR;
  if (options.packaged || !program) return undefined;
  if (!isAbsolute(program)) {
    throw new Error(`LO_KEYMAP_EDITOR must be an absolute path, not "${program}".`);
  }
  return program;
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

/** Which GitHub Lo talks to, and the account a test starts with. */
export interface GithubSettings {
  /** GitHub's addresses: github.com's, or a server on this machine standing in for it. */
  urls: GitHubUrls;
  /**
   * Whether this is a test run: a build run from source, talking to a GitHub on this machine.
   * Only then does Lo keep a token where the system's keychain is a stand-in.
   */
  testRun: boolean;
  /** A file holding a token, for an account added as Lo starts. */
  tokenFile: string | undefined;
}

/**
 * Which GitHub Lo talks to. A build run from source talks to a server on this machine instead,
 * such as the tests' replay server, when `LO_GITHUB` names its address (`http://127.0.0.1:<port>`,
 * which serves GitHub's API under `/api`, its website under `/web` and its uploads under
 * `/uploads`), and adds the account whose token is in the file `LO_TEST_TOKEN_FILE` names as it
 * starts. A packaged build ignores both, and always talks to github.com.
 */
export function githubSettings(options: { packaged: boolean; env: Environment }): GithubSettings {
  const settings = { urls: GITHUB_URLS, testRun: false, tokenFile: undefined };
  if (options.packaged) return settings;
  const address = options.env.LO_GITHUB;
  const tokenFile = options.env.LO_TEST_TOKEN_FILE;
  if (tokenFile !== undefined && !isAbsolute(tokenFile)) {
    throw new Error(`LO_TEST_TOKEN_FILE must be an absolute path, not "${tokenFile}".`);
  }
  if (address === undefined) return { ...settings, tokenFile };
  const url = URL.parse(address);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url?.hostname ?? '');
  const bare =
    url?.username === '' && url.password === '' && url.pathname === '/' && !url.search && !url.hash;
  if (!url || url.protocol !== 'http:' || !local || !bare) {
    throw new Error(`LO_GITHUB must be an http address on this machine, not "${address}".`);
  }
  const { origin } = url;
  return {
    urls: { api: `${origin}/api`, web: `${origin}/web`, uploads: `${origin}/uploads` },
    testRun: true,
    tokenFile,
  };
}

/**
 * The `gh` to run rather than one Lo finds, from `LO_GH`: an absolute path, or `none` for no gh at
 * all. Tests bring a gh of their own this way, so they never run the one on `PATH`, which holds the
 * tokens of whoever runs them. A test run, one talking to a GitHub on this machine, runs no gh
 * unless `LO_GH` names one, so a real github.com token never goes to the test's server. A packaged
 * build ignores it.
 */
export function ghProgram(options: {
  packaged: boolean;
  env: Environment;
  /** Whether this is a test run ({@link GithubSettings.testRun}). */
  testRun: boolean;
}): string | undefined {
  if (options.packaged) return undefined;
  const program = options.env.LO_GH;
  if (!program) return options.testRun ? 'none' : undefined;
  if (program !== 'none' && !isAbsolute(program)) {
    throw new Error(`LO_GH must be an absolute path or "none", not "${program}".`);
  }
  return program;
}

/**
 * The program that opens web pages in place of the system's browser, from `LO_BROWSER`, so a test
 * opens no browser and can see what Lo opened. It gets the page's address as its one argument. A
 * packaged build ignores it.
 */
export function browserProgram(options: {
  packaged: boolean;
  env: Environment;
}): string | undefined {
  const program = options.env.LO_BROWSER;
  if (options.packaged || !program) return undefined;
  if (!isAbsolute(program)) {
    throw new Error(`LO_BROWSER must be an absolute path, not "${program}".`);
  }
  return program;
}

/**
 * The folder to install the `lo` command in, in place of the system's and the person's, from
 * `LO_COMMAND_FOLDER`, so a test installs it where it can see it and nowhere else. Lo writes it
 * there without asking for an administrator. A packaged build ignores it.
 */
export function commandFolder(options: {
  packaged: boolean;
  env: Environment;
}): string | undefined {
  const folder = options.env.LO_COMMAND_FOLDER;
  if (options.packaged || !folder) return undefined;
  if (!isAbsolute(folder)) {
    throw new Error(`LO_COMMAND_FOLDER must be an absolute path, not "${folder}".`);
  }
  return folder;
}
