import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveReplay, type ReplayServer } from '@lo/testing/server';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/** The app's folder. Electron starts the built main process its `package.json` names. */
export const appFolder = fileURLToPath(new URL('..', import.meta.url));

/** The Electron binary: what the `electron` package exports to Node. */
export const electronBinary = binary(createRequire(import.meta.url)('electron'));

function binary(path: unknown): string {
  if (typeof path !== 'string') throw new Error('The electron package gave no path to its binary.');
  return path;
}

/**
 * Chromium's stand-ins for the system's keychain, so tests never touch a real one: the Mac's
 * stand-in keychain, and Linux's fallback store. Lo takes either only in a test run.
 */
export const KEYCHAIN =
  process.platform === 'darwin' ? ['--use-mock-keychain'] : ['--password-store=basic'];

/** A port on this machine nothing listens on: a GitHub that can't be reached. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === 'string') throw new Error('the server had no port');
  return address.port;
}

/**
 * The middle of the window while no pull request or Settings is open: the Recent list, where keys
 * go back to with `Esc`.
 */
export function middleOf(page: Page) {
  return page.getByRole('listbox', { name: 'Recent pull requests' });
}

/** The data folder a test's copy of Lo starts on: empty, and the test's own. */
export function dataFolder(): string {
  return base.info().outputPath('data');
}

/** Where an unpackaged Lo with this data folder reads its keymap file. */
export function keymapPath(data: string): string {
  return join(data, 'config', 'keymap');
}

/** Where an unpackaged Lo with this data folder keeps the settings file, beside the keymap file. */
export function settingsPath(data: string): string {
  return join(data, 'config', 'settings.json');
}

/**
 * The program a test's Lo opens the keymap file with, in place of the system's text editor, so no
 * test starts an editor on a desktop other work shares. It adds the path it's given to `opened`,
 * beside it in the data folder.
 */
function editorPath(data: string): string {
  return join(data, 'editor');
}

/** Writes the program that stands in for the system's editor. */
function writeEditor(data: string): void {
  const log = join(data, 'opened').replaceAll("'", `'\\''`);
  mkdirSync(data, { recursive: true });
  writeFileSync(editorPath(data), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\n`);
  chmodSync(editorPath(data), 0o755);
}

/**
 * The program a test's Lo opens web pages with, in place of the system's browser, so no test opens
 * a browser. It adds the address it's given to `browsed`, beside it in the data folder.
 */
function browserPath(data: string): string {
  return join(data, 'browser');
}

/** Writes the program that stands in for the system's browser. */
function writeBrowser(data: string): void {
  const log = join(data, 'browsed').replaceAll("'", `'\\''`);
  mkdirSync(data, { recursive: true });
  writeFileSync(browserPath(data), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\n`);
  chmodSync(browserPath(data), 0o755);
}

/** The pages Lo has opened in this test, in order, as the stand-in browser got them. */
export function browsed(): string[] {
  try {
    return readFileSync(join(dataFolder(), 'browsed'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** The paths Lo has opened the keymap file by in this test, in order, as the editor got them. */
export function opened(): string[] {
  try {
    return readFileSync(join(dataFolder(), 'opened'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The environment Lo starts with: this one, without anything that would point it at a dev server
 * or run Electron as plain Node, and with the test's data folder.
 */
export function appEnvironment(data: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  env.LO_USER_DATA_DIR = data;
  env.LO_KEYMAP_EDITOR = editorPath(data);
  env.LO_BROWSER = browserPath(data);
  // Never the gh on PATH, which holds the tokens of whoever runs the tests; a test brings its own.
  env.LO_GH = 'none';
  return env;
}

type LaunchOptions = NonNullable<Parameters<typeof electron.launch>[0]>;

interface Fixtures {
  /** What the keymap file says when Lo starts, or `undefined` for no file. */
  keymap: string | undefined;
  /** What the settings file says when Lo starts, or `undefined` for no file. */
  settings: string | undefined;
  /** Extra options for starting Lo, for tests that need it started differently. Its `env` adds to Lo's. */
  launch: LaunchOptions;
  /** Lo, started on an empty data folder with Chromium's sandbox on. */
  app: ElectronApplication;
  /** Lo's window, once its page has loaded. */
  page: Page;
}

export const test = base.extend<Fixtures>({
  launch: [{}, { option: true }],
  keymap: [undefined, { option: true }],
  settings: [undefined, { option: true }],
  app: async ({ launch, keymap, settings }, use) => {
    const { env, ...options } = launch;
    const data = dataFolder();
    writeEditor(data);
    writeBrowser(data);
    if (keymap !== undefined) {
      mkdirSync(join(data, 'config'), { recursive: true });
      writeFileSync(keymapPath(data), keymap);
    }
    if (settings !== undefined) {
      mkdirSync(join(data, 'config'), { recursive: true });
      writeFileSync(settingsPath(data), settings);
    }
    const app = await electron.launch({
      args: [appFolder],
      env: { ...appEnvironment(data), ...env },
      // Playwright turns the sandbox off on Linux unless asked; Lo must run with it.
      chromiumSandbox: true,
      ...options,
    });
    await use(app);
    await app.close();
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    await use(page);
  },
});

export { expect };

/** A stand-in token, never a real one: the `user` cassette answers for it as rozed-bot. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that knows only who that is. While no
 * account is signed in, the welcome screen covers the Recent list, so a test that needs Recent as
 * the window's middle, for keys and menus that work wherever focus is, starts like this.
 */
export const signedIn = test.extend<{ github: ReplayServer }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('user');
    await use(server);
    await server.close();
  },
  launch: async ({ github }, use) => {
    const tokenFile = base.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: new URL(github.urls.api).origin, LO_TEST_TOKEN_FILE: tokenFile },
    });
  },
  // Lo adds the account as it starts: the window is ready once it has, and Recent is its middle.
  page: async ({ page }, use) => {
    await expect
      .poll(async () =>
        JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))),
      )
      .toContain('rozed-bot');
    await expect(middleOf(page)).toBeVisible();
    await use(page);
  },
});
