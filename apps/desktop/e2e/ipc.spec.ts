import { join } from 'node:path';

import { appFolder, expect, test } from './app.ts';

test('the page gets invoke and subscribe, and nothing else', async ({ page }) => {
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

test('app.info answers', async ({ page }) => {
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
    },
  });
});

test('a malformed request is refused before it reaches a handler', async ({ page }) => {
  const reply = await page.evaluate(() => window.lo.invoke('app.info', { theme: 'hunter2' }));
  expect(reply).toEqual({
    ok: false,
    error: { code: 'invalid', message: 'app.info got a malformed request (input).' },
  });
});

test("names that aren't a feature's requests or topics reach nothing", async ({ page }) => {
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
  expect(subscribed).toBe("There's no topic named ELECTRON_RENDERER_EVENT.");
});

test("app.theme arrives, and the window follows the system's appearance", async ({ app, page }) => {
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
});

test("a page that isn't Lo's gets nothing from main, even with the bridge", async ({
  app,
  page,
}) => {
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
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
    error: { code: 'forbidden', message: "app.info answers only Lo's own page." },
  });
});

test("a handler main has outside the features is out of the page's reach", async ({
  app,
  page,
}) => {
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
