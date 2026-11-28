// A spec's page: built from its harness into a folder of its own, and opened in a copy of Electron,
// one window that's never shown. On Linux each worker opens its pages on an X display of its own
// (`@lo/testing/display`), so another worker's windows never take its focus or the pointer. As a
// file, the page loads its script as a plain one: Chromium loads no module from a `file:` address.
// A spec waits for a frame, or for what a frame brings, only through the page's `window.waits`,
// which fails within 10 s, saying what it waited for, where a frame that never came would otherwise
// fail as the test's whole time running out.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { onOwnDisplay } from '@lo/testing/display';
import { Scanner } from '@tailwindcss/oxide';
import { _electron as electron, test as base, type ElectronApplication } from '@playwright/test';
// Imported from Node, the electron package is the path to its binary, whatever its types say.
import electronPackage from 'electron';
import { build } from 'vite';

import { buildCss } from '../scripts/stylesheet.ts';

const electronBinary: unknown = electronPackage;

/**
 * The specs' tests, each worker on a display of its own. A spec builds its page as its first test
 * in a worker opens it (`buildPage`), not in a `beforeAll`: Playwright keeps the tests of a file
 * with one together, in a group for each shard or worker, where alone each test can go to any.
 */
export const test = base.extend<object, { display: string | undefined }>({
  display: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => onOwnDisplay(workerInfo.parallelIndex, use),
    { scope: 'worker', auto: true },
  ],
});

export { expect } from '@playwright/test';

/**
 * Electron's side: one window, never shown, with the page. Never shown, the page could be taken as
 * in the background, which holds back its frames and timers, so it's never throttled: a spec
 * waiting for a frame gets one.
 */
const MAIN = `
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  void window.loadFile(join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

/** How long a wait in a page for frames may take: far longer than frames take, and under a test's. */
const FRAME_LIMIT = 10_000;

/**
 * How long a page may take to draw its first frame. Its frames come once Electron's GPU process has
 * started, which in CI, with copies of Lo starting at once, has taken up to half a minute.
 */
const FIRST_FRAME_LIMIT = 60_000;

/** What a spec's code in the page waits on, as `window.waits`. */
interface Waits {
  /**
   * Waits for `count` frames, one unless it says, by when what changed before is laid out, measured
   * and drawn. Fails if they haven't come within `limit`, 10 s unless it says, saying it was waiting
   * for `what` and how many came.
   */
  frames(what: string, count?: number, limit?: number): Promise<void>;
  /**
   * Waits for a resize observer's first notice of `element`, which comes as the next frame lays it
   * out, after the notices of the page's own observers made before it, drawn or not. Fails
   * likewise.
   */
  resized(what: string, element: Element): Promise<void>;
}

declare global {
  interface Window {
    /** The waits for frames every page has, from before its harness runs (`putWaits`). */
    waits: Waits;
  }
}

/**
 * Puts the page's `window.waits`, each failing after `limit` unless what it waits for has come. The
 * page gets this function as text, so it uses nothing from outside itself.
 */
function putWaits(limit: number): void {
  /**
   * Waits for `wait` to call its `done`, failing after `until` with what it waited for and what of
   * it came (`came`).
   */
  const within = (
    what: string,
    came: () => string,
    wait: (done: () => void) => void,
    until = limit,
  ) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Waiting for ${what}, ${came()} in ${until / 1000} s.`));
      }, until);
      wait(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  window.waits = {
    frames: (what, count = 1, until = limit) => {
      let seen = 0;
      return within(
        what,
        () => `${seen} of ${count} ${count === 1 ? 'frame' : 'frames'} came`,
        (done) => {
          const next = (): void => {
            if (seen === count) done();
            else {
              requestAnimationFrame(() => {
                seen += 1;
                next();
              });
            }
          };
          next();
        },
        until,
      );
    },
    resized: (what, element) =>
      within(
        what,
        () => 'no resize notice came',
        (done) => {
          const observer = new ResizeObserver(() => {
            observer.disconnect();
            done();
          });
          observer.observe(element);
        },
      ),
  };
}

/** The folder of each page this worker has built, by its harness. */
const built = new Map<string, Promise<string>>();

/**
 * Builds the page `harness/<name>.tsx` (or `.ts`) draws into `#root`, titled `title`, with `style`
 * in its head, once in each worker, and says the folder it's in: one for each worker running at
 * once. A worker started again after a failure takes the place of the one before, and its folder,
 * rather than a new one.
 */
export function buildPage(
  entry: string,
  title: string,
  style: string | (() => Promise<string>) = '',
): Promise<string> {
  let folder = built.get(entry);
  if (!folder) {
    folder = buildOnce(entry, title, style);
    built.set(entry, folder);
  }
  return folder;
}

async function buildOnce(
  entry: string,
  title: string,
  style: string | (() => Promise<string>),
): Promise<string> {
  const name = entry.replace(/\.tsx?$/, '');
  const worker = base.info().parallelIndex;
  const folder = fileURLToPath(new URL(`../test-results/${name}-${worker}/`, import.meta.url));
  mkdirSync(folder, { recursive: true });
  await build({
    configFile: false,
    root: fileURLToPath(new URL('harness/', import.meta.url)),
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: folder,
      emptyOutDir: true,
      minify: false,
      lib: { entry, formats: ['iife'], name: 'harness', fileName: () => `${name}.js` },
    },
  });
  const css = typeof style === 'string' ? style : await style();
  const page =
    `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${css}</style>` +
    `<script>(${putWaits.toString()})(${FRAME_LIMIT});</script>` +
    `<div id="root" class="lo-app"></div><script src="./${name}.js"></script>`;
  writeFileSync(`${folder}index.html`, page);
  writeFileSync(`${folder}main.cjs`, MAIN);
  writeFileSync(`${folder}package.json`, JSON.stringify({ main: 'main.cjs' }));
  return folder;
}

/**
 * Lo's stylesheet with the utilities ui's source and the harnesses use, found as Tailwind finds
 * them in the window, and no margin on the page.
 */
export async function utilities(): Promise<string> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const scanner = new Scanner({
    sources: ['src/**/*', 'e2e/harness/**/*'].map((pattern) => ({
      base: root,
      pattern,
      negated: false,
    })),
  });
  return `${await buildCss(scanner.scan())}\nbody { margin: 0; }`;
}

/**
 * Opens the page `buildPage` built in `folder`, in a copy of Electron of its own, once the page has
 * drawn its first frame (`drawn`).
 */
export async function launch(folder: string): Promise<ElectronApplication> {
  if (typeof electronBinary !== 'string') throw new Error('The electron package gave no path.');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [folder],
    executablePath: electronBinary,
    env,
    chromiumSandbox: true,
  });
  try {
    await drawn(app);
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

/**
 * Waits for the page to draw its first frame, which can take far longer than a spec's wait for
 * frames may (`FIRST_FRAME_LIMIT`), and puts off the test's time limit for as long as it takes.
 */
async function drawn(app: ElectronApplication): Promise<void> {
  const info = base.info();
  const timeout = info.timeout;
  const from = performance.now();
  // Zero is no limit at all, which a wait can't add to.
  if (timeout > 0) info.setTimeout(timeout + FIRST_FRAME_LIMIT);
  const page = await app.firstWindow();
  // Checked on a timer, not on frames, which may not have come yet.
  await page.waitForFunction(() => 'waits' in window, undefined, { polling: 100 });
  await page.evaluate(
    (limit) => window.waits.frames('the page’s first frame', 1, limit),
    FIRST_FRAME_LIMIT,
  );
  if (timeout > 0) info.setTimeout(timeout + Math.ceil(performance.now() - from));
}
