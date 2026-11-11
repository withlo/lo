import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  _electron as electron,
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

/** The data folder a test's copy of Lo starts on: empty, and the test's own. */
export function dataFolder(): string {
  return base.info().outputPath('data');
}

/** Where an unpackaged Lo with this data folder reads its keymap file. */
export function keymapPath(data: string): string {
  return join(data, 'config', 'keymap');
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
  return env;
}

type LaunchOptions = NonNullable<Parameters<typeof electron.launch>[0]>;

interface Fixtures {
  /** What the keymap file says when Lo starts, or `undefined` for no file. */
  keymap: string | undefined;
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
  app: async ({ launch, keymap }, use) => {
    const { env, ...options } = launch;
    const data = dataFolder();
    if (keymap !== undefined) {
      mkdirSync(join(data, 'config'), { recursive: true });
      writeFileSync(keymapPath(data), keymap);
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

export { expect } from '@playwright/test';
