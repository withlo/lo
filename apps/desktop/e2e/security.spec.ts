import { readFile } from 'node:fs/promises';

import type { ElectronApplication, Page } from '@playwright/test';

import { expect, test } from './app.ts';

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
    `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; ` +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'"
  );
}

/** The nonce `app.info` hands the page. */
async function infoNonce(page: Page): Promise<unknown> {
  const reply = await page.evaluate(() => window.lo.invoke('app.info'));
  return reply.ok && typeof reply.value === 'object' && reply.value !== null
    ? Reflect.get(reply.value, 'nonce')
    : undefined;
}

test('the window runs sandboxed, isolated and without Node', async ({ app, page }) => {
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

test('every page runs in the sandbox, even one whose window asks not to', async ({ app }) => {
  const pid = await app.evaluate(async ({ BrowserWindow, session }) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: false, session: session.fromPartition('persist:window') },
    });
    await window.loadURL('about:blank');
    return window.webContents.getOSProcessId();
  });
  expect(await inSandbox(app, pid)).toBe(true);
});

test('the page loads with its content security policy and no violations', async ({ page }) => {
  // Lo's page has already loaded once by now, so load it again with the console being watched.
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => messages.push(error.message));
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();

  const header = await page.evaluate(async () =>
    (await fetch('/index.html')).headers.get('content-security-policy'),
  );
  const nonce = await infoNonce(page);
  expect(nonce).toEqual(expect.any(String));
  expect(header).toBe(policy(String(nonce)));
  expect(messages).toEqual([]);
});

test('each load of the page has a nonce of its own, in its policy and in app.info', async ({
  page,
}) => {
  const nonces: unknown[] = [];
  for (let load = 0; load < 3; load++) {
    const response = await page.reload();
    await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
    const nonce = await infoNonce(page);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(response?.headers()['content-security-policy']).toBe(policy(String(nonce)));
    nonces.push(nonce);
  }
  expect(new Set(nonces).size).toBe(nonces.length);
});

test('code views style themselves with the nonce, with no inline style refused', async ({
  page,
}) => {
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
    const editor = page.locator('.cm-editor').first();
    await expect(editor).toBeVisible();
    // CodeMirror's own styles, from its style element, lay the editor out.
    expect(await editor.evaluate((element) => getComputedStyle(element).display)).toBe('flex');
    // Keys that move, select and open Vim's prompt, whose panel brings styles of its own.
    for (const key of ['j', 'Shift+G', 'v', 'Escape', ':', 'Escape'])
      await page.keyboard.press(key);
    expect(
      await page
        .locator('.cm-vimCursorLayer')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
  }
  // The file view's jump went to its caller.
  expect(
    await page.evaluate(() => window.loCodeViews?.heard.some(({ event }) => event === 'jumped')),
  ).toBe(true);
  await page.evaluate(() => window.loCodeViews?.unmount());
  expect(await violations.evaluate((violated) => violated)).toEqual([]);
  expect(messages.filter((message) => /security policy/i.test(message))).toEqual([]);
});

test('the content security policy blocks inline code and outside content', async ({ page }) => {
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
            resolve(typeof run === 'function' ? Reflect.apply(run, globalThis, ['1 + 1']) : 'none');
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

test("Lo's scheme serves only the window's own files", async ({ page }) => {
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

test('the window opens no other windows', async ({ app, page }) => {
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
  test(`the window can't navigate to ${target}`, async ({ app, page }) => {
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

test("the window can't follow a redirect away from a page Lo loads", async ({ app, page }) => {
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

test("a window that allows webviews still can't attach one", async ({ app }) => {
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
});

test('every permission is refused', async ({ page }) => {
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

test('the window downloads nothing', async ({ app, page }) => {
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

test('spellcheck is off', async ({ app, page }) => {
  // The page can't see spellcheck run: macOS checks words through the system in the background,
  // with no sign to the page, and Linux would first download a dictionary, which the window's
  // proxy stops. So this reads the session's switch, which covers every page in it.
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
  const enabled = await app.evaluate(({ session }) =>
    session.fromPartition('persist:window').isSpellCheckerEnabled(),
  );
  expect(enabled).toBe(false);
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
});
