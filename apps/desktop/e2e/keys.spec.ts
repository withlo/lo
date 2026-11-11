import type { ElectronApplication, Page } from '@playwright/test';

import { expect, test } from './app.ts';

const mac = process.platform === 'darwin';

/** Every role and accelerator in the app menu, however deep, or null when there's no menu. */
async function menuContents(app: ElectronApplication): Promise<string[] | null> {
  return app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return null;
    const walk = (items: Electron.MenuItem[]): string[] =>
      items.flatMap((item) => [
        ...(item.role ? [`role:${item.role}`] : []),
        ...(item.accelerator ? [`key:${item.accelerator}`] : []),
        ...(item.id ? [`id:${item.id}`] : []),
        ...(item.submenu ? walk(item.submenu.items) : []),
      ]);
    return walk(menu.items);
  });
}

/** Whether the page has been reloaded since `mark` ran. */
async function mark(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    Reflect.set(window, 'loMarked', true);
  });
  return () => page.evaluate(() => Reflect.get(window, 'loMarked') !== true);
}

test('Electron’s menu is gone: Linux has none, and macOS’s reloads nothing', async ({
  app,
  page,
}) => {
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
  const contents = await menuContents(app);
  if (!mac) {
    expect(contents).toBeNull();
    return;
  }
  for (const missing of ['role:reload', 'role:forcereload', 'role:close', 'role:toggledevtools']) {
    expect(contents).not.toContain(missing);
  }
  expect(
    contents?.filter((each) => /^key:(?:CommandOrControl|CmdOrCtrl|Command)\+R$/i.test(each)),
  ).toEqual([]);
  // The window lists Lo's commands, with their keys.
  await expect
    .poll(() => menuContents(app))
    .toEqual(
      expect.arrayContaining(['id:keys.back', 'key:Control+O', 'id:keys.forward', 'key:Control+I']),
    );
});

test('reload and developer-tools keys do nothing in the built app', async ({ app, page }) => {
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
  const reloaded = await mark(page);
  const keys = mac
    ? ['Meta+R', 'Meta+Shift+R', 'Meta+Alt+I', 'Meta+Alt+J']
    : ['Control+R', 'F5', 'Control+Shift+R', 'Control+Shift+I', 'Control+Alt+I', 'F12'];
  for (const key of keys) await page.keyboard.press(key);
  // Long enough for a reload to have started.
  await page.waitForTimeout(500);
  expect(await reloaded()).toBe(false);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.webContents.isDevToolsOpened()),
    ),
  ).toBe(false);
});

test('Esc gives focus back to the middle of the window', async ({ page }) => {
  const open = page.getByRole('button', { name: 'Open a pull request' });
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('main[data-lo-middle]')).toBeFocused();
});

test('the window runs only the app menu’s own commands that main sends back', async ({
  app,
  page,
}) => {
  const open = page.getByRole('button', { name: 'Open a pull request' });
  await open.focus();
  // Esc's command isn't in the app menu, so a click can't have sent it.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('keys.run', { id: 'keys.escape' });
  });
  await page.waitForTimeout(200);
  await expect(open).toBeFocused();
  // The same command by its key.
  await page.keyboard.press('Escape');
  await expect(page.locator('main[data-lo-middle]')).toBeFocused();
});

test('a click in the macOS app menu runs its command once, and its key never through the menu', async ({
  app,
  page,
}) => {
  test.skip(!mac, 'Linux has no app menu.');
  await expect.poll(() => menuContents(app)).toContain('id:keys.back');
  // Count what main sends back.
  await page.evaluate(() => {
    const runs: unknown[] = [];
    Reflect.set(window, 'loRuns', runs);
    window.lo.subscribe('keys.run', (value) => runs.push(value));
  });
  const runs = () =>
    page.evaluate((): unknown => {
      const got: unknown = Reflect.get(window, 'loRuns');
      return Array.isArray(got) ? [...got] : got;
    });
  const click = (triggeredByAccelerator: boolean) =>
    app.evaluate(({ BrowserWindow, Menu }, byKey) => {
      const window = BrowserWindow.getAllWindows()[0];
      const event = {
        triggeredByAccelerator: byKey,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      };
      Menu.getApplicationMenu()
        ?.getMenuItemById('keys.back')
        ?.click(event, window, window?.webContents);
    }, triggeredByAccelerator);

  await click(true);
  await click(false);
  await expect.poll(runs).toEqual([{ id: 'keys.back' }]);
  // The page takes ⌃O itself, so the menu never sees it.
  await page.keyboard.press('Control+O');
  await page.waitForTimeout(200);
  expect(await runs()).toEqual([{ id: 'keys.back' }]);
});

test('Tab moves focus only through commands, and forms that ask keep the browser’s Tab', async ({
  page,
}) => {
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.dataset.loScope = 'box';
    const text = document.createElement('textarea');
    text.id = 'text';
    box.append(text);
    const after = document.createElement('button');
    after.textContent = 'After';
    const form = document.createElement('form');
    form.dataset.loScope = 'settings';
    form.dataset.loTab = 'browser';
    for (const id of ['first', 'second']) {
      const input = document.createElement('input');
      input.id = id;
      form.append(input);
    }
    document.body.append(box, after, form);
  });
  const text = page.locator('#text');
  await text.focus();
  for (const key of ['Tab', 'Shift+Tab', 'Alt+Tab', 'Alt+Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(text).toBeFocused();
  }
  // The next letter still lands in the box.
  await page.keyboard.type('e');
  await expect(text).toHaveValue('e');

  await page.locator('#first').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#second')).toBeFocused();

  // Nor out of the window's own scope: the tab strip's button keeps focus.
  const open = page.getByRole('button', { name: 'Open a pull request' });
  await open.focus();
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
});

/** The window's zoom level, as Chromium has it. */
function zoom(app: ElectronApplication): Promise<number | undefined> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel(),
  );
}

test('⌘ or Ctrl with =, - and 0 zooms the window', async ({ app, page }) => {
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
  const held = mac ? 'Meta' : 'Control';
  expect(await zoom(app)).toBe(0);
  await page.keyboard.press(`${held}+Equal`);
  await expect.poll(() => zoom(app)).toBe(0.5);
  await page.keyboard.press(`${held}+Minus`);
  await page.keyboard.press(`${held}+Minus`);
  await expect.poll(() => zoom(app)).toBe(-0.5);
  await page.keyboard.press(`${held}+Digit0`);
  await expect.poll(() => zoom(app)).toBe(0);
});

test('macOS’s View menu lists zooming, with its keys', async ({ app }) => {
  test.skip(!mac, 'Linux has no app menu.');
  await expect
    .poll(() => menuContents(app))
    .toEqual(
      expect.arrayContaining([
        'id:app.zoomIn',
        'key:Command+=',
        'id:app.zoomOut',
        'key:Command+-',
        'id:app.actualSize',
        'key:Command+0',
      ]),
    );
});

test.describe('on Linux, with no app menu', () => {
  test.skip(mac, 'macOS’s app menu quits and goes full screen.');

  test('F11 asks for full screen', async ({ app, page }) => {
    await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
    // Counted where main asks, since a display without a window manager may not go full screen.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) return;
      const asked: boolean[] = [];
      Reflect.set(globalThis, 'loFullScreen', asked);
      const setFullScreen = window.setFullScreen.bind(window);
      window.setFullScreen = (flag: boolean) => {
        asked.push(flag);
        setFullScreen(flag);
      };
    });
    await page.keyboard.press('F11');
    await expect
      .poll(() => app.evaluate((): unknown => Reflect.get(globalThis, 'loFullScreen')))
      .toEqual([true]);
  });

  test('Ctrl+Q quits', async ({ app, page }) => {
    await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
    const closed = app.waitForEvent('close');
    // Lo may be gone before the key comes back up.
    await page.keyboard.press('Control+Q').catch(() => undefined);
    await closed;
  });
});
