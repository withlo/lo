import { createSocket } from 'node:dgram';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { cassette, Replay } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { ElectronApplication, Page } from '@playwright/test';

import { buildCommit } from '../scripts/commit.ts';
import { appFolder, expect, HELD_LONG, KEYCHAIN, test, VIM_KEYS } from './app.ts';

declare global {
  interface Window {
    /** Code views on their own, which a build run from source gives the smoke test. */
    loCodeViews?: {
      mount(kind: 'diff' | 'file'): Promise<void>;
      unmount(): void;
      readonly heard: { event: string; args: unknown[] }[];
    };
  }
}

/** Settings of the window's web contents, as Electron reads them back. */
async function windowSettings(app: ElectronApplication, names: string[]) {
  return app.evaluate(({ BrowserWindow }, wanted) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    // Electron reads a web contents' settings back with this method, which its types leave out.
    const read: unknown = contents && Reflect.get(contents, 'getLastWebPreferences');
    const all: unknown = typeof read === 'function' ? Reflect.apply(read, contents, []) : {};
    return Object.fromEntries(
      wanted.map((name) => [name, all && typeof all === 'object' ? Reflect.get(all, name) : null]),
    );
  }, names);
}

/** Whether a process runs in the operating system's sandbox, not only with the setting on. */
async function inSandbox(app: ElectronApplication, pid: number): Promise<boolean | undefined> {
  if (process.platform === 'linux') {
    return /^Seccomp:\s+2$/m.test(await readFile(`/proc/${pid}/status`, 'utf8'));
  }
  return app.evaluate(
    (electron, renderer) =>
      electron.app.getAppMetrics().find((metric) => metric.pid === renderer)?.sandboxed,
    pid,
  );
}

/** The policy of a page whose style elements may carry `nonce`. */
function policy(nonce: string): string {
  return (
    `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; ` +
    "img-src 'self' lo-image:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
}

/** What became of each image the page loaded: its size once loaded, or `refused`. */
async function loaded(page: Page, addresses: readonly string[]): Promise<string[]> {
  return page.evaluate(
    (all) =>
      Promise.all(
        all.map(
          (src) =>
            new Promise<string>((resolve) => {
              const image = new Image();
              image.addEventListener('load', () =>
                resolve(`${image.naturalWidth}x${image.naturalHeight}`),
              );
              image.addEventListener('error', () => resolve('refused'));
              image.src = src;
            }),
        ),
      ),
    addresses,
  );
}

/** The nonce `app.info` hands the page. */
async function infoNonce(page: Page): Promise<unknown> {
  const reply = await page.evaluate(() => window.lo.invoke('app.info'));
  return reply.ok && typeof reply.value === 'object' && reply.value !== null
    ? Reflect.get(reply.value, 'nonce')
    : undefined;
}

/**
 * Starts WebRTC in the page against an ICE server, and waits until it has gathered its candidates.
 * The content security policy has no say over WebRTC, so this runs with it in force.
 */
async function gather(page: Page, ice: RTCIceServer): Promise<string[]> {
  return page.evaluate(async (server) => {
    const connection = new RTCPeerConnection({ iceServers: [server] });
    connection.createDataChannel('probe');
    const candidates: string[] = [];
    connection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) candidates.push(candidate.candidate);
    });
    const gathered = new Promise<void>((resolve) => {
      connection.addEventListener('icegatheringstatechange', () => {
        if (connection.iceGatheringState === 'complete') resolve();
      });
    });
    await connection.setLocalDescription(await connection.createOffer());
    await Promise.race([gathered, new Promise((resolve) => setTimeout(resolve, 5000))]);
    connection.close();
    return candidates;
  }, ice);
}

/** Closes the hidden windows a check made in main, leaving Lo's own. */
async function closeHidden(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isVisible()) window.destroy();
  });
}

/**
 * Mounts a diff's code view and a file's on their own, presses keys that bring in the styles of
 * their own of Vim's cursor and prompt, `vim`, or of the plain search's field, and checks that
 * every style was the page's, with its nonce, and none refused.
 */
async function codeViewsStyled(page: Page, vim: boolean): Promise<void> {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => messages.push(error.message));
  const violations = await page.evaluateHandle(() => {
    const violated: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      violated.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    return violated;
  });
  await page.waitForFunction(() => window.loCodeViews !== undefined);
  for (const kind of ['diff', 'file'] as const) {
    await page.evaluate((each) => window.loCodeViews?.mount(each), kind);
    // The one on screen: the welcome, open over Recent, holds its practice's box out of sight.
    const editor = page.locator('.cm-editor:visible').first();
    await expect(editor).toBeVisible();
    // CodeMirror's own styles, from its style element, lay the editor out.
    expect(await editor.evaluate((element) => getComputedStyle(element).display)).toBe('flex');
    if (vim) {
      // Keys that move, select and open Vim's prompt, whose panel brings styles of its own.
      for (const key of ['j', 'Shift+G', 'v', 'Escape', ':', 'Escape'])
        await page.keyboard.press(key);
      expect(
        await editor
          .locator('.cm-vimCursorLayer')
          .first()
          .evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('none');
    } else {
      // Keys that move, and open the search, whose field is a panel with styles of its own.
      for (const key of ['j', 'Shift+G', '/']) await page.keyboard.press(key);
      const field = page.locator('.lo-codesearch__field').first();
      await expect(field).toBeFocused();
      expect(await field.evaluate((element) => getComputedStyle(element).fontFamily)).not.toBe('');
      await page.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
    }
  }
  // The file view's jump went to its caller.
  expect(
    await page.evaluate(() => window.loCodeViews?.heard.some(({ event }) => event === 'jumped')),
  ).toBe(true);
  await page.evaluate(() => window.loCodeViews?.unmount());
  expect(await violations.evaluate((violated) => violated)).toEqual([]);
  expect(messages.filter((message) => /security policy/i.test(message))).toEqual([]);
}

/**
 * Every guard that holds whatever the page has done before: one Lo, a check at a time, each of
 * which leaves Lo as it found it. The navigations Lo stops, from the page and the downloads' links,
 * leave Playwright's locators waiting, so they come after every check that waits on one; and the
 * last replaces the window's request filter.
 */
test('the window is locked down: sandboxed and isolated, under its content security policy, with nothing but its own files, windows, pages, permissions or downloads, no way out by WebRTC or a proxy, and a bridge to main that answers only Lo’s page', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  await test.step('the page gets invoke and subscribe, and nothing else, and a malformed request, or a name that is no feature’s, reaches nothing', async () => {
    await test.step('the page gets invoke and subscribe, and nothing else', async () => {
      expect(
        await page.evaluate(() => ({
          keys: Object.keys(window.lo).toSorted(),
          types: [typeof window.lo.invoke, typeof window.lo.subscribe],
          ipcRenderer: 'ipcRenderer' in globalThis,
          require: typeof require,
        })),
      ).toEqual({
        keys: ['invoke', 'subscribe'],
        types: ['function', 'function'],
        ipcRenderer: false,
        require: 'undefined',
      });
    });

    await test.step('a malformed request is refused before it reaches a handler', async () => {
      const reply = await page.evaluate(() => window.lo.invoke('app.info', { theme: 'hunter2' }));
      expect(reply).toEqual({
        ok: false,
        error: { code: 'invalid', message: 'app.info got a malformed request (input).' },
      });
    });

    await test.step("names that aren't a feature's requests or topics reach nothing", async () => {
      const replies = await page.evaluate(() => {
        // The page can pass anything, whatever the bridge's types say.
        const bridge: { invoke(channel: unknown): Promise<unknown> } = window.lo;
        return Promise.all([
          // Not a request, a name Electron uses for itself, and not a name at all.
          bridge.invoke('app.nothing'),
          bridge.invoke('ELECTRON_BROWSER_WINDOW_CLOSE'),
          bridge.invoke('app.info\n'),
          bridge.invoke(42),
        ]);
      });
      for (const reply of replies) {
        expect(reply).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      }
      const subscribed = await page.evaluate(() => {
        try {
          window.lo.subscribe('ELECTRON_RENDERER_EVENT', () => {});
          return 'subscribed';
        } catch (error) {
          return error instanceof Error ? error.message : 'thrown';
        }
      });
      expect(subscribed).toBe('There’s no topic named ELECTRON_RENDERER_EVENT.');
    });
  });

  await test.step('app.info answers', async () => {
    // The first digits of a commit when the build could find one, as in a checkout. Which commit it
    // names is the build's, so a build made before the last commit names an earlier one.
    const found = buildCommit(process.env, import.meta.dirname) !== '';
    const reply = await page.evaluate(() => window.lo.invoke('app.info'));
    expect(reply).toEqual({
      ok: true,
      value: {
        version: '0.0.0',
        platform: process.platform,
        theme: expect.stringMatching(/^(dark|light)$/),
        git: expect.objectContaining({
          status: expect.stringMatching(/^(checking|found|missing|tooOld)$/),
        }),
        packaged: false,
        ...(found ? { commit: expect.stringMatching(/^[0-9a-f]{7}$/) } : {}),
        // What the suite asks for, so its tests aren't racing the bound on what a tab holds back.
        holdLimit: HELD_LONG,
        nonce: expect.stringMatching(/^[A-Za-z0-9+/]{24}$/),
      },
    });
  });

  await test.step('the window runs sandboxed, isolated and without Node', async () => {
    const settings = await windowSettings(app, [
      'sandbox',
      'contextIsolation',
      'nodeIntegration',
      'webSecurity',
    ]);
    expect(settings).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });

    const pid = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId() ?? 0,
    );
    expect(await inSandbox(app, pid)).toBe(true);

    // Nothing of Node or Electron is reachable from the page.
    expect(
      await page.evaluate(() => ({
        require: typeof require,
        process: typeof process,
        module: typeof module,
        buffer: typeof Buffer,
        ipcRenderer: 'ipcRenderer' in globalThis,
        electron: 'electron' in globalThis,
      })),
    ).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      buffer: 'undefined',
      ipcRenderer: false,
      electron: false,
    });
  });

  await test.step('every page runs in the sandbox, even one whose window asks not to', async () => {
    const pid = await app.evaluate(async ({ BrowserWindow, session }) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: false, session: session.fromPartition('persist:window') },
      });
      await window.loadURL('about:blank');
      return window.webContents.getOSProcessId();
    });
    expect(await inSandbox(app, pid)).toBe(true);
    await closeHidden(app);
  });

  await test.step('the page loads with its content security policy and no violations', async () => {
    // Lo's page has already loaded once by now, so load it again with the console being watched.
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', (error) => messages.push(error.message));
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();

    const header = await page.evaluate(async () =>
      (await fetch('/index.html')).headers.get('content-security-policy'),
    );
    const nonce = await infoNonce(page);
    expect(nonce).toEqual(expect.any(String));
    expect(header).toBe(policy(String(nonce)));
    expect(messages).toEqual([]);
  });

  await test.step('each load of the page has a nonce of its own, in its policy and in app.info', async () => {
    const nonces: unknown[] = [];
    for (let load = 0; load < 3; load++) {
      const response = await page.reload();
      await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();
      const nonce = await infoNonce(page);
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
      expect(response?.headers()['content-security-policy']).toBe(policy(String(nonce)));
      nonces.push(nonce);
    }
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  await test.step('code views style themselves with the nonce, with no inline style refused', () =>
    codeViewsStyled(page, false));

  await test.step('the content security policy blocks inline code and outside content', async () => {
    const violations = await page.evaluateHandle(() => {
      const violated: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        violated.push(event.effectiveDirective);
      });

      const script = document.createElement('script');
      script.textContent = 'document.documentElement.dataset.inlineScript = "ran"';
      document.head.append(script);

      const style = document.createElement('style');
      style.textContent = ':root { --inline-style: applied; }';
      document.head.append(style);

      const image = document.createElement('img');
      image.src = 'https://example.com/image.png';
      document.body.append(image);
      return violated;
    });
    // Playwright's own calls may use eval, so the page tries it later, in a task of its own.
    const evaluated = await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            const run: unknown = Reflect.get(globalThis, 'eval');
            try {
              resolve(
                typeof run === 'function' ? Reflect.apply(run, globalThis, ['1 + 1']) : 'none',
              );
            } catch (error) {
              resolve(error instanceof Error ? error.name : 'thrown');
            }
          });
        }),
    );

    expect(evaluated).toBe('EvalError');
    await expect
      .poll(() => violations.evaluate((violated) => violated.toSorted()))
      .toEqual(['img-src', 'script-src', 'script-src-elem', 'style-src-elem']);
    expect(
      await page.evaluate(() => ({
        script: document.documentElement.dataset.inlineScript,
        style: getComputedStyle(document.documentElement).getPropertyValue('--inline-style'),
      })),
    ).toEqual({ script: undefined, style: '' });
  });

  await test.step("Lo's scheme serves only the window's own files", async () => {
    const statuses = await page.evaluate(() =>
      Promise.all(
        ['/index.html', '/..%2fmain%2findex.js', '/missing.js'].map(
          async (path) => (await fetch(path)).status,
        ),
      ),
    );
    // The second is main's own bundle, beside the window's folder.
    expect(statuses).toEqual([200, 404, 404]);
  });

  await test.step('spellcheck is off', async () => {
    // The page can't see spellcheck run: macOS checks words through the system in the background,
    // with no sign to the page, and Linux would first download a dictionary, which the window's
    // proxy stops. So this reads the session's switch, which covers every page in it.
    await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();
    const enabled = await app.evaluate(({ session }) =>
      session.fromPartition('persist:window').isSpellCheckerEnabled(),
    );
    expect(enabled).toBe(false);
  });

  await test.step('WebRTC sends no UDP', async () => {
    const stun = createSocket('udp4');
    const packets: number[] = [];
    stun.on('message', (message) => packets.push(message.length));
    await new Promise<void>((resolve) => stun.bind(0, '127.0.0.1', resolve));

    const candidates = await gather(page, { urls: `stun:127.0.0.1:${stun.address().port}` });
    stun.close();
    expect(candidates).toEqual([]);
    expect(packets).toEqual([]);
  });

  await test.step('WebRTC opens no connection, even over TCP', async () => {
    let connections = 0;
    const turn = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => turn.listen(0, '127.0.0.1', resolve));
    const address = turn.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const candidates = await gather(page, {
      urls: `turn:127.0.0.1:${port}?transport=tcp`,
      username: 'lo',
      credential: 'lo',
    });
    await new Promise((resolve) => turn.close(resolve));
    expect(candidates).toEqual([]);
    expect(connections).toBe(0);
  });

  await test.step("the window's session sends everything to a proxy nothing can listen on", async () => {
    // The window opens once its session is secured.
    await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();
    const proxies = await app.evaluate(({ session }) => {
      const windowSession = session.fromPartition('persist:window');
      return Promise.all(
        ['https://example.com/', 'http://127.0.0.1:8080/', 'http://localhost/'].map((url) =>
          windowSession.resolveProxy(url),
        ),
      );
    });
    expect(proxies).toEqual(['PROXY 127.0.0.1:0', 'PROXY 127.0.0.1:0', 'PROXY 127.0.0.1:0']);
  });

  await test.step("a page that isn't Lo's gets nothing from main, even with the bridge", async () => {
    await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();
    // A window with Lo's preload, on a page that isn't Lo's.
    const reply: unknown = await app.evaluate(
      async ({ BrowserWindow, session }, preload) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: { preload, session: session.fromPartition('persist:window') },
        });
        await window.loadURL('about:blank');
        const answer: unknown = await window.webContents.executeJavaScript(
          "window.lo.invoke('app.info')",
        );
        window.destroy();
        return answer;
      },
      join(appFolder, 'dist', 'preload', 'index.cjs'),
    );
    expect(reply).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'app.info answers only Lo’s own page.' },
    });
  });

  await test.step("a handler main has outside the features is out of the page's reach", async () => {
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['internal', 'INTERNAL_CHANNEL']) {
        ipcMain.handle(channel, () => ({ ok: true, value: 'reached' }));
      }
    });
    const replies = await page.evaluate(() =>
      Promise.all(['internal', 'INTERNAL_CHANNEL'].map((channel) => window.lo.invoke(channel))),
    );
    for (const reply of replies) {
      expect(reply).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    }
  });

  await test.step("app.theme arrives, and the window follows the system's appearance", async () => {
    // What each push hands a listener: only the value, never Electron's event.
    const pushes = await page.evaluateHandle(() => {
      const received: unknown[][] = [];
      window.lo.subscribe('app.theme', (...values: unknown[]) => received.push(values));
      // A listener that stopped listening hears nothing.
      const stop = window.lo.subscribe('app.theme', () => received.push(['after stopping']));
      stop();
      return received;
    });
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const dark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect.poll(theme).toBe(dark ? 'dark' : 'light');

    const appearances = dark ? (['light', 'dark'] as const) : (['dark', 'light'] as const);
    for (const appearance of appearances) {
      await app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, appearance);
      await expect.poll(theme).toBe(appearance);
    }
    expect(await pushes.jsonValue()).toEqual(appearances.map((appearance) => [appearance]));
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'system';
    });
  });

  await test.step('the window opens no other windows', async () => {
    const opened = await page.evaluate(() => [
      window.open('https://example.com/'),
      window.open('/index.html'),
      window.open('about:blank'),
    ]);
    expect(opened).toEqual([null, null, null]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(app.windows()).toEqual([page]);
  });

  for (const target of ['https://example.com/', 'lo-app://app/index.html?elsewhere']) {
    await test.step(`the window can't navigate to ${target}`, async () => {
      // Listens in main after Lo's own listener, so it sees whether Lo stopped the navigation. Every
      // frame's navigation, the page's included, is announced here first.
      const navigation = await app.evaluateHandle(({ BrowserWindow }) => ({
        promise: new Promise<{ url: string; prevented: boolean }>((resolve) => {
          BrowserWindow.getAllWindows()[0]?.webContents.once('will-frame-navigate', (event) => {
            resolve({ url: event.url, prevented: event.defaultPrevented });
          });
        }),
      }));
      await page.evaluate((url) => {
        document.documentElement.dataset.stayed = 'yes';
        window.location.href = url;
      }, target);

      expect(await navigation.evaluate(({ promise }) => promise)).toEqual({
        url: target,
        prevented: true,
      });
      expect(page.url()).toBe('lo-app://app/index.html');
      expect(await page.evaluate(() => document.documentElement.dataset.stayed)).toBe('yes');
    });
  }

  await test.step("a window that allows webviews still can't attach one", async () => {
    const attached = await app.evaluateHandle(async ({ BrowserWindow, session }) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: { webviewTag: true, session: session.fromPartition('persist:window') },
      });
      await window.loadURL('lo-app://app/index.html');
      const promise = new Promise<boolean>((resolve) => {
        window.webContents.once('will-attach-webview', (event) => resolve(event.defaultPrevented));
      });
      await window.webContents.executeJavaScript(
        "document.body.append(Object.assign(document.createElement('webview'), { src: 'about:blank' }))",
      );
      return { promise };
    });
    expect(await attached.evaluate(({ promise }) => promise)).toBe(true);
    expect(
      await app.evaluate(({ webContents }) =>
        webContents.getAllWebContents().some((contents) => contents.getType() === 'webview'),
      ),
    ).toBe(false);
    await closeHidden(app);
  });

  await test.step('every permission is refused', async () => {
    const answers = await page.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
      position: await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve('allowed'),
          (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : error.message),
          // Allowed, it would wait for a position, which a test machine may never have.
          { timeout: 2000 },
        );
      }),
    }));
    expect(answers).toEqual({ notifications: 'denied', geolocation: 'denied', position: 'denied' });
  });

  await test.step('the window downloads nothing', async () => {
    // Listens in main after Lo's own listener, so it sees whether Lo stopped each download.
    const downloads = await app.evaluateHandle(({ session }) => {
      const seen: { name: string; prevented: boolean }[] = [];
      session.fromPartition('persist:window').on('will-download', (event, item) => {
        seen.push({ name: item.getFilename(), prevented: event.defaultPrevented });
      });
      return seen;
    });
    await page.evaluate(() => {
      for (const href of ['data:text/plain,echo', URL.createObjectURL(new Blob(['echo']))]) {
        const link = Object.assign(document.createElement('a'), { href, download: 'run.command' });
        document.body.append(link);
        link.click();
      }
    });
    await expect
      .poll(() => downloads.evaluate((seen) => seen))
      .toEqual([
        { name: 'run.command', prevented: true },
        { name: 'run.command', prevented: true },
      ]);
  });

  await test.step("the window can't follow a redirect away from a page Lo loads", async () => {
    const redirect = await app.evaluateHandle(({ BrowserWindow, session }) => {
      // Lo's files never redirect, and its scheme can't, so a redirect is made in front of them.
      session.fromPartition('persist:window').webRequest.onBeforeRequest((details, callback) => {
        callback(details.url.endsWith('/start') ? { redirectURL: 'https://example.com/' } : {});
      });
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      const promise = new Promise<{ url: string; prevented: boolean }>((resolve) => {
        contents?.once('will-redirect', (event) => {
          resolve({ url: event.url, prevented: event.defaultPrevented });
        });
      });
      contents?.loadURL('lo-app://app/start').catch(() => {});
      return { promise };
    });
    expect(await redirect.evaluate(({ promise }) => promise)).toEqual({
      url: 'https://example.com/',
      prevented: true,
    });
    expect(page.url()).toBe('lo-app://app/index.html');
  });
});

test.describe('with Vim keys on', () => {
  // Vim's cursor layer and prompt bring styles of their own, as the plain search's field does.
  test.use({ settings: VIM_KEYS });

  test('code views style themselves with the nonce, with no inline style refused', ({ page }) =>
    codeViewsStyled(page, true));
});

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** A 2x2 PNG attached in rozed-dev/e2e, as a post's Markdown holds it. */
const ATTACHMENT =
  'https://github.com/user-attachments/assets/08c730b3-f0b0-4c7d-93a2-95f8d167d0d9';

/** Where the window loads a post's image in `view` from. */
const postImage = (view: string, address: string) =>
  `lo-image://post/${encodeURIComponent(view)}/${encodeURIComponent(address)}`;

/** Lo as rozed-bot, on a GitHub that answers for #80 and for the images `images_e2e` recorded. */
const onGithub = test.extend<{ github: ReplayServer }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const interactions = ['app_e2e', 'images_e2e'].flatMap((name) =>
      cassette(name).interactions.map(({ interaction }) => interaction),
    );
    const server = await serveReplay(new Replay('app_e2e with images_e2e', interactions));
    await use(server);
    await server.close();
  },
  launch: async ({ github }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
      },
    });
  },
});

onGithub(
  "images load only from main, from GitHub's image hosts, with the token for an attachment alone",
  async ({ page, github }) => {
    await expect
      .poll(async () =>
        JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))),
      )
      .toContain('rozed-bot');
    const reply = await page.evaluate(
      (number) =>
        window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
      APP_PULL.number,
    );
    if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
    const view = reply.value;
    // The tab acts as rozed-bot, so an attachment in its posts is fetched as rozed-bot.
    await expect(page.locator('header').first()).toContainText('as rozed-bot');

    const origin = new URL(github.urls.api).origin;
    expect(
      await loaded(page, [
        postImage(view, ATTACHMENT),
        'lo-image://avatar/rozed-bot?s=56',
        postImage(view, 'https://example.com/a.png'),
        postImage(view, 'http://camo.githubusercontent.com/a.png'),
        'lo-image://avatar/dependabot%5Bbot%5D?s=56',
        'lo-image://elsewhere/a.png',
        `${origin}/images/avatars.githubusercontent.com/rozed-bot?s=56`,
        'https://avatars.githubusercontent.com/rozed-bot?s=56',
      ]),
    ).toEqual(['2x2', '420x420', ...Array<string>(6).fill('refused')]);
    // A view acting as nobody, as one Lo doesn't know does, never gets the image fetched as
    // rozed-bot: main asks GitHub again, without a token. GitHub refuses that for an attachment in
    // a private repository; the stand-in answers whoever asks.
    expect(await loaded(page, [postImage('nobody', ATTACHMENT)])).toEqual(['2x2']);

    // Main asked for the attachment with the tab's token, and for where it led, and the avatar,
    // without it; then for the attachment as nobody. Nothing else reached an image host.
    const images = github.replay.seen
      .filter(
        ({ url }) => !/^https:\/\/(api\.|uploads\.)?github\.com\/(?!user-attachments\/)/.test(url),
      )
      .map(({ url, headers }) => `${new URL(url).host} ${headers.get('authorization') ?? 'nobody'}`)
      .toSorted();
    expect(images).toEqual([
      'avatars.githubusercontent.com nobody',
      'github-production-user-asset-6210df.s3.amazonaws.com nobody',
      'github-production-user-asset-6210df.s3.amazonaws.com nobody',
      'github.com nobody',
      `github.com token ${TOKEN}`,
    ]);
  },
);

onGithub('the page can draw an image from main, but never read it back', async ({ page }) => {
  const avatar = 'lo-image://avatar/rozed-bot?s=56';
  const outcome = await page.evaluate(async (src) => {
    const drawn = new Image();
    drawn.src = src;
    await drawn.decode();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D canvas');
    context.drawImage(drawn, 0, 0);
    let pixels: string;
    try {
      context.getImageData(0, 0, 1, 1);
      pixels = 'read';
    } catch (error) {
      pixels = error instanceof DOMException ? error.name : String(error);
    }
    // Asked for as an image another origin may read, it doesn't load at all.
    const shared = new Image();
    shared.crossOrigin = 'anonymous';
    shared.src = src;
    const asShared = await shared.decode().then(
      () => 'loaded',
      () => 'refused',
    );
    return { pixels, asShared };
  }, avatar);
  expect(outcome).toEqual({ pixels: 'SecurityError', asShared: 'refused' });
});

test.describe('with the content security policy bypassed', () => {
  test.use({ launch: { bypassCSP: true } });

  test("a request outside Lo's files is cancelled before it leaves", async ({ page }) => {
    const failed = page.waitForEvent('requestfailed');
    const result = await page.evaluate(() =>
      fetch('https://example.com/').then(
        () => 'loaded',
        () => 'refused',
      ),
    );
    expect(result).toBe('refused');
    const request = await failed;
    expect(request.url()).toBe('https://example.com/');
    expect(request.failure()?.errorText).toBe('net::ERR_BLOCKED_BY_CLIENT');
  });

  test('the window asks main for an image only as an image', async ({ page }) => {
    // With the policy bypassed, only the window's request filter stands between the page and
    // main's images: it cancels an image's address asked for as a script or a style sheet, as it
    // cancels a request outside Lo's files, before main sees it.
    const src = 'lo-image://avatar/rozed-bot?s=56';
    const failed: { url: string; error: string | undefined }[] = [];
    page.on('requestfailed', (request) =>
      failed.push({ url: request.url(), error: request.failure()?.errorText }),
    );
    const outcomes = await page.evaluate(
      (address) =>
        Promise.all(
          [document.createElement('script'), document.createElement('link')].map(
            (element) =>
              new Promise<string>((resolve) => {
                element.addEventListener('load', () => resolve('loaded'));
                element.addEventListener('error', () => resolve('refused'));
                if (element instanceof HTMLScriptElement) element.src = address;
                else {
                  element.rel = 'stylesheet';
                  element.href = address;
                }
                document.head.append(element);
              }),
          ),
        ),
      src,
    );
    expect(outcomes).toEqual(['refused', 'refused']);
    await expect
      .poll(() => failed)
      .toEqual([
        { url: src, error: 'net::ERR_BLOCKED_BY_CLIENT' },
        { url: src, error: 'net::ERR_BLOCKED_BY_CLIENT' },
      ]);
    // The scheme isn't one `fetch` may ask at all, whatever the filter would say.
    const read = await page.evaluate(
      (address) =>
        fetch(address).then(
          () => 'read',
          () => 'refused',
        ),
      src,
    );
    expect(read).toBe('refused');
  });
});
