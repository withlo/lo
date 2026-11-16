import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';

import { MERGE_PULLS, STACK_PULLS, writeMergeRemote, writeStackRemote } from '@lo/testing/git';
import { fakeServer, readReport, type Scenario, type Seen } from '@lo/testing/lsp';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

import { liveArgs, liveDataFolder } from './live.ts';

/**
 * How long the window holds back what a tab shows first, in a test that isn't about that bound:
 * three times the real one, so a busy machine is never late enough to race it, and no longer, since
 * a test that leaves the overview before it's drawn is waiting on the bound to let it go. A test
 * that is about the bound asks for it itself, with `test.use({ holdLimit: HOLD_LIMIT })`.
 */
export const HELD_LONG = 3_000;

/** How long Lo's window has to draw its first frame before the test fails for it. */
const DRAW_LIMIT = 60_000;

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
 * stand-in keychain, and Linux's fallback store. Lo takes either only in a test run. Playwright
 * adds both to every Electron it starts as well, and a live run takes them off (`live`).
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
 * Where an unpackaged Lo with this data folder keeps its cache: `lo-cache`, never `cache`, which a
 * Mac's disk takes for Chromium's own `Cache` beside it.
 */
export function cachePath(data: string): string {
  return join(data, 'lo-cache');
}

/**
 * The program a test's Lo opens the keymap and settings files with, in place of the system's text
 * editor, so no test starts an editor on a desktop other work shares. It adds the path it's given
 * to `opened`, beside it in the data folder.
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

/**
 * The paths Lo has opened the keymap or settings file by in this test, in order, as the editor got
 * them.
 */
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
  env.LO_HOLD_LIMIT_MS = String(HELD_LONG);
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
  /**
   * How long, in milliseconds, the window holds back what a tab shows first. Long unless a test is
   * about that bound, which it asks for with `HOLD_LIMIT`.
   */
  holdLimit: number;
  /**
   * Whether CI records a trace of the window, kept when the test fails: not for a test that times
   * the page's frames, which recording slows.
   */
  traced: boolean;
  /**
   * Whether Lo runs live, for a run on GitHub itself that no test in the suite makes: with the
   * system's keychain rather than Chromium's stand-in for it, and its data in the folder
   * `LO_USER_DATA_DIR` names, which the run must set, apart from the folders of any Lo someone uses
   * (`liveDataFolder`). `live.config.ts` turns it on for the `*.live.ts` specs, one at a time.
   * `testing/README.md` says how.
   */
  live: boolean;
  /** Lo, started on the test's own empty data folder, or a live run's, with Chromium's sandbox on. */
  app: ElectronApplication;
  /** Lo's window, once its page has loaded and the window has drawn. */
  page: Page;
}

export const test = base.extend<Fixtures>({
  launch: [{}, { option: true }],
  holdLimit: [HELD_LONG, { option: true }],
  traced: [true, { option: true }],
  keymap: [undefined, { option: true }],
  settings: [undefined, { option: true }],
  live: [false, { option: true }],
  app: async ({ launch, keymap, settings, traced, holdLimit, live }, use, testInfo) => {
    const { env, args = [appFolder], ...options } = launch;
    if (live && testInfo.config.workers > 1) {
      // Each copy would start on the one folder, and Lo quits a second copy started on it.
      throw new Error('A live run starts one Lo at a time: run it with `nx run desktop:live`.');
    }
    const data = live
      ? liveDataFolder({ platform: process.platform, home: homedir(), env: process.env })
      : dataFolder();
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
      args: live ? liveArgs(args) : args,
      env: {
        ...appEnvironment(data),
        LO_HOLD_LIMIT_MS: String(holdLimit),
        ...env,
        // A live run's data stays in its own folder, whatever else it's started with.
        ...(live ? { LO_USER_DATA_DIR: data } : {}),
      },
      // Playwright turns the sandbox off on Linux unless asked; Lo must run with it.
      chromiumSandbox: true,
      ...options,
    });
    // In CI, a trace of the window, kept beside the test's results when it fails, which CI keeps:
    // what was on screen and asked for, for a failure that won't happen again on demand. A test that
    // closed Lo itself has no window left to trace.
    const tracing = process.env.CI && traced ? app.context().tracing : undefined;
    await tracing?.start({ screenshots: true, snapshots: true });
    await use(app);
    if (tracing) {
      const failed = testInfo.status !== testInfo.expectedStatus;
      await tracing
        .stop(failed ? { path: testInfo.outputPath('trace.zip') } : undefined)
        .catch((error: unknown) => {
          if (failed) console.error("The test's trace couldn't be kept:", error);
        });
    }
    await app.close();
  },
  page: [
    async ({ app }, use) => {
      await use(await loadedAndDrawn(app));
    },
    // Time of its own, so a late first frame never uses up the test's, and more of it than the
    // first frame has, so a window that never draws fails as that.
    { scope: 'test', timeout: DRAW_LIMIT + 30_000 },
  ],
});

export { expect };

/**
 * Lo's window, from a copy of Lo a test started itself, once its page has loaded and the window
 * has drawn, as the `page` fixture gives it. The wait has time of its own: the test's time grows by
 * however long it took. A test that sets its own time with `test.setTimeout` does so before it
 * starts Lo, as each one does, since a later call would set it afresh and take that back.
 */
export async function drawnWindow(app: ElectronApplication): Promise<Page> {
  const info = base.info();
  const timeout = info.timeout;
  const from = performance.now();
  // Zero is no limit at all, which a wait can't add to.
  if (timeout > 0) info.setTimeout(timeout + DRAW_LIMIT + 30_000);
  const page = await loadedAndDrawn(app);
  if (timeout > 0) info.setTimeout(timeout + Math.ceil(performance.now() - from));
  return page;
}

/**
 * Lo's window, once its page has loaded and the window has drawn. The page loads, runs and takes
 * keys before the window can draw: its frames come once Electron's GPU process has started, which
 * in CI, with copies of Lo and of the perf suite starting at once, has taken up to half a minute.
 * Until then nothing that waits on a frame happens, such as a closed dialog leaving or a click
 * finding its target still, so a test takes a window only once it has drawn.
 */
async function loadedAndDrawn(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await base.step(
    "Lo's window draws its first frame",
    async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Lo's window loaded but drew no frame in ${DRAW_LIMIT / 1000} s.`));
            }, DRAW_LIMIT);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    { box: true },
  );
  return page;
}

declare global {
  interface Window {
    /** How many times the page has been resized since `sizeWindow` last asked, and when last. */
    loSized?: { resizes: number; last: number };
  }
}

/**
 * Sets the window's size, as the reader would, and waits until the page has taken it: its last
 * resize was 100 ms ago, and two frames have drawn since. A window that was that size already sends
 * no resize, which is waited for half a second.
 */
export async function sizeWindow(
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  const page = await app.firstWindow();
  // Listening before the window moves, so no resize is missed.
  await page.evaluate(() => {
    const sized = window.loSized ?? { resizes: 0, last: 0 };
    sized.resizes = 0;
    if (!window.loSized) {
      window.addEventListener('resize', () => {
        sized.resizes += 1;
        sized.last = performance.now();
      });
    }
    window.loSized = sized;
  });
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height),
    { width, height },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const from = performance.now();
        const check = () => {
          const now = performance.now();
          const sized = window.loSized;
          const still = sized && sized.resizes > 0 ? now - sized.last >= 100 : now - from >= 500;
          if (!still) {
            setTimeout(check, 25);
            return;
          }
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        check();
      }),
  );
}

/**
 * The banners over a pull request's tab but the one saying language servers are off, which a tab of
 * a repository nobody trusts shows, as every test's is: what a test that isn't about trust waits
 * for, or for none of.
 */
export function tabBanners(page: Page): Locator {
  return page
    .locator('[data-lo-banners] > *')
    .filter({ hasNotText: /^Language servers are off for|^This PR comes from a fork/ });
}

/**
 * A settings file that opens a pull request on its diff, overview or not, for tests of the diff and
 * what's beside it, which would otherwise find the overview first.
 */
export const DIFF_FIRST = '{ "overview.open": "diff" }\n';

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

/**
 * The pull requests of the stacks `testing/fixtures/stack.sh` makes in rozed-dev/e2e, by their
 * numbers: #A, #B, #C and #D, a stack that branches, found by base branch and shared commits; #E,
 * on #M, which was squash-merged; and #G1 and #G2, a GitHub stack.
 */
export const STACK = {
  a: STACK_PULLS.a.number,
  b: STACK_PULLS.b.number,
  c: STACK_PULLS.c.number,
  d: STACK_PULLS.d.number,
  m: STACK_PULLS.m.number,
  e: STACK_PULLS.e.number,
  g1: STACK_PULLS.g1.number,
  g2: STACK_PULLS.g2.number,
} as const;

/** What GitHub holds back in a test of the stacks, until the test lets go. */
export interface Held {
  /** Resolves once the test lets go. */
  released(): Promise<void>;
  /** Lets go: the requests held back are answered, and those to come aren't held. */
  release(): void;
}

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `app_stack`, recorded
 * from the app on the stacks, or the cassette `cassette` names, and fetching from their repository,
 * built on this machine. With `account` false, Lo starts with no account.
 */
export const onStacks = test.extend<{
  /** The cassette GitHub answers from. */
  cassette: string;
  /** Whether Lo starts with rozed-bot's account. */
  account: boolean;
  github: ReplayServer;
  remote: string;
  /** Whether Lo starts without git, so it has only what GitHub says. */
  noGit: boolean;
  /** Whether the remote is written only once the test says, so the local copy comes late. */
  lateRemote: boolean;
  /**
   * Whether GitHub holds back the repository's rulesets until the test lets go of them, so no
   * stack is known until then.
   */
  holdStacks: boolean;
  /** Lets go of what GitHub holds back. */
  held: Held;
  /** Where Lo finds GitHub: the replay server, or one in front of it that holds requests back. */
  githubOrigin: string;
}>({
  cassette: ['app_stack', { option: true }],
  account: [true, { option: true }],
  noGit: [false, { option: true }],
  lateRemote: [false, { option: true }],
  holdStacks: [false, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  held: async ({}, use) => {
    const waiting: (() => void)[] = [];
    let released = false;
    const held: Held = {
      released: () =>
        released ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve)),
      release() {
        released = true;
        for (const resolve of waiting.splice(0)) resolve();
      },
    };
    await use(held);
    // A request still held as the test ends finds the replay server gone.
    held.release();
  },
  githubOrigin: async ({ github, holdStacks, held }, use) => {
    const origin = new URL(github.urls.api).origin;
    if (!holdStacks) {
      await use(origin);
      return;
    }
    // Passes each request on to the replay server, holding the repository's rulesets back until the
    // test lets go of them: until they're read once, no stack is known.
    const front = createHttpServer((incoming, outgoing) => {
      void (async () => {
        const body = await buffer(incoming);
        if (incoming.url?.endsWith('/graphql') && body.toString('utf8').includes('TrunkRules')) {
          await held.released();
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string' && name !== 'host') headers.set(name, value);
        }
        const method = incoming.method ?? 'GET';
        const response = await fetch(`${origin}${incoming.url ?? '/'}`, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
          redirect: 'manual',
        });
        const out: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name)) {
            out[name] = value;
          }
        });
        outgoing.writeHead(response.status, out);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      })().catch(() => {
        // The test has ended, and the replay server with it: the request goes unanswered.
        outgoing.destroy();
      });
    });
    await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
    const address = front.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    await use(`http://127.0.0.1:${address.port}`);
    front.closeAllConnections();
    await new Promise((resolve) => front.close(resolve));
  },
  remote: async ({ lateRemote }, use) => {
    const folder = base.info().outputPath('remote');
    await use(lateRemote ? `file://${folder}` : writeStackRemote(folder));
  },
  launch: async ({ githubOrigin, remote, noGit, account }, use) => {
    const tokenFile = base.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: githubOrigin,
        ...(account ? { LO_TEST_TOKEN_FILE: tokenFile } : {}),
        LO_GIT_REMOTE: remote,
        ...(noGit ? { LO_GIT: 'none' } : {}),
      },
    });
  },
});

/** The generation of `testing/fixtures/merge.sh`'s pull requests `app_merge` was recorded on. */
export const MERGE = MERGE_PULLS[3];

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `app_merge`, recorded
 * from the app on {@link MERGE}'s pull requests, and fetching from their repository, built on this
 * machine. With `account` false, Lo starts with no account.
 */
export const onMerge = test.extend<{
  /** Whether Lo starts with rozed-bot's account. */
  account: boolean;
  github: ReplayServer;
  remote: string;
}>({
  account: [true, { option: true }],
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_merge');
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    // `merge.sh` builds nothing inside a work tree, so not in the test's output folder.
    const folder = mkdtempSync(join(tmpdir(), 'lo-merge-'));
    await use(writeMergeRemote(join(folder, 'remote'), 3));
    rmSync(folder, { recursive: true, force: true });
  },
  launch: async ({ github, remote, account }, use) => {
    const tokenFile = base.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        ...(account ? { LO_TEST_TOKEN_FILE: tokenFile } : {}),
        LO_GIT_REMOTE: remote,
      },
    });
  },
});

/** The fake language server a test's Lo runs for TypeScript, in place of a real one. */
export interface TestServers {
  /** What Lo's environment needs to run it: where its manifest is. */
  readonly env: { readonly LO_TEST_SERVERS: string };
  /** What every copy of it Lo started has seen so far, in order. */
  seen(): Seen[];
  /** Kills every copy of it Lo started, with its group, once Lo is closed. */
  kill(): void;
}

/**
 * Writes, into `folder`, the manifest of test servers a build run from source reads from
 * `LO_TEST_SERVERS`: the fake server, named TypeScript, doing what `scenario` says. A packaged
 * build never reads one.
 */
export function testServers(folder: string, scenario: Omit<Scenario, 'report'>): TestServers {
  mkdirSync(folder, { recursive: true });
  const server = fakeServer(folder, scenario);
  const manifest = join(folder, 'servers.json');
  writeFileSync(
    manifest,
    JSON.stringify({
      servers: [
        {
          id: 'typescript',
          name: 'TypeScript',
          languages: { typescript: 'typescript', tsx: 'typescriptreact' },
          program: server.program,
          args: server.args,
        },
      ],
    }),
  );
  const seen = () => readReport(server.report);
  return {
    env: { LO_TEST_SERVERS: manifest },
    seen,
    kill: () => {
      for (const each of seen()) {
        if (each.event !== 'started') continue;
        try {
          process.kill(-each.pid, 'SIGKILL');
        } catch {
          // Gone already, as it should be once Lo has closed.
        }
      }
    },
  };
}

/**
 * Answers main's native dialogs (`dialog.showMessageBox`) from now on with the button labelled
 * `button`, or with none at all for a label they lack, for a test, which can't press a native
 * dialog. What each dialog asked is kept, for {@link dialogsAsked}. Only a build run from source can
 * be reached this way: a packaged one takes no debugger.
 */
export async function answerDialogs(app: ElectronApplication, button: string): Promise<void> {
  await app.evaluate(({ dialog }, label) => {
    const kept: unknown = Reflect.get(globalThis, 'loDialogs');
    const asked: unknown[] = Array.isArray(kept) ? kept : [];
    Reflect.set(globalThis, 'loDialogs', asked);
    const answer = (...args: unknown[]) => {
      const options: unknown = args.at(-1);
      const read = (key: string): unknown =>
        typeof options === 'object' && options !== null ? Reflect.get(options, key) : undefined;
      const listed = read('buttons');
      const buttons = Array.isArray(listed) ? listed.map(String) : [];
      asked.push({
        message: read('message'),
        detail: read('detail'),
        buttons,
        defaultId: read('defaultId'),
        cancelId: read('cancelId'),
        // The id of the window it's attached to, which comes before the options.
        window: args.length > 1 ? Reflect.get(Object(args[0]), 'id') : undefined,
      });
      return Promise.resolve({ response: buttons.indexOf(label), checkboxChecked: false });
    };
    Reflect.set(dialog, 'showMessageBox', answer);
  }, button);
}

/**
 * What each dialog main asked since {@link answerDialogs} first answered them said: its `message`,
 * `detail`, `buttons`, `defaultId` and `cancelId`, and the id of the `window` it was attached to.
 */
export async function dialogsAsked(app: ElectronApplication): Promise<unknown[]> {
  return app.evaluate(() => {
    const kept: unknown = Reflect.get(globalThis, 'loDialogs');
    return Array.isArray(kept) ? kept.map((each: unknown) => each) : [];
  });
}
