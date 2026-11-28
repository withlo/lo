import type { ElectronApplication, Page } from '@playwright/test';

import { expect, middleOf, signedIn as test } from './app.ts';

const mac = process.platform === 'darwin';

/** The window's right-click menu: what a click on nothing in particular lists. */
const menuOf = (page: Page) => page.getByRole('menu', { name: 'Actions' });

/** The item the menu has highlighted. */
const highlighted = (page: Page) => menuOf(page).locator('[role="menuitem"][data-highlighted]');

/** Records the native menus main pops up, rather than showing one on the desktop. */
async function recordNativeMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const shown: string[][] = [];
    Reflect.set(globalThis, 'shownMenus', shown);
    Reflect.set(Menu.prototype, 'popup', function popup(this: Electron.Menu) {
      shown.push(this.items.map((item) => item.role ?? item.type));
    });
  });
}

/** The native menus main has popped up since `recordNativeMenus`, each as its items' roles. */
function nativeMenus(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const shown: unknown = Reflect.get(globalThis, 'shownMenus');
    return Array.isArray(shown) ? shown.map((menu) => String(menu)) : [];
  });
}

/**
 * Records the app menu main pops up on Linux, rather than showing it: its menus' names, then where
 * it opened, `@ x,y`.
 */
async function recordAppMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const shown: string[] = [];
    Reflect.set(globalThis, 'appMenus', shown);
    Reflect.set(
      Menu.prototype,
      'popup',
      function popup(this: Electron.Menu, options?: Electron.PopupOptions) {
        const names = this.items.map((item) => item.label).join(' ');
        shown.push(`${names} @ ${options?.x ?? '?'},${options?.y ?? '?'}`);
      },
    );
  });
}

/** The app menus main has popped up since `recordAppMenus`. */
function appMenus(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const shown: unknown = Reflect.get(globalThis, 'appMenus');
    return Array.isArray(shown) ? shown.map((menu) => String(menu)) : [];
  });
}

test('⇧F10 and the menu key each open the menu of what has focus, under the keyboard’s control, and Esc gives focus back', async ({
  page,
}) => {
  const middle = middleOf(page);
  for (const key of ['Shift+F10', 'ContextMenu']) {
    await test.step(key, async () => {
      await middle.focus();
      await page.keyboard.press(key);
      const menu = menuOf(page);
      await expect(menu).toBeVisible();
      // From the keyboard, the first action that can be done is highlighted already, past Back
      // and Forward, dimmed with nowhere to go, which `k` still reaches.
      const first = menu.locator('[role="menuitem"]:not([aria-disabled="true"])').first();
      await expect(first).toHaveAttribute('data-highlighted');
      await expect(menu.getByRole('menuitem', { name: /^Back/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await page.keyboard.press('k');
      await expect(highlighted(page)).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('j');
      await expect(first).toHaveAttribute('data-highlighted');
      // Esc closes it, and focus is back where the menu was opened.
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(middle).toBeFocused();
    });
  }
});

test('on Linux, the app menu opens under the menu button by a click and by F10, with the menus macOS’s menu bar has, keeping focus where it was; opened from the strip by the keyboard, it gives focus back to what had it', async ({
  app,
  page,
}) => {
  test.skip(mac, 'macOS’s app menu is its menu bar.');
  await recordAppMenus(app);
  const button = page.getByRole('button', { name: 'Show menu' });
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  const box = await button.boundingBox();
  const under = `@ ${Math.round(box?.x ?? 0)},${Math.round((box?.y ?? 0) + (box?.height ?? 0))}`;
  const middle = middleOf(page);
  await middle.focus();

  await test.step('a click opens it under the button, and focus stays where it was', async () => {
    await button.click();
    await expect.poll(() => appMenus(app)).toHaveLength(1);
    const [shown] = await appMenus(app);
    expect(shown).toMatch(/(^| )File Edit View Go Review Window Help @ /);
    expect(shown?.endsWith(under)).toBe(true);
    await expect(middle).toBeFocused();
  });

  await test.step('F10 opens it too, and focus stays where it was', async () => {
    await page.keyboard.press('F10');
    await expect.poll(() => appMenus(app)).toHaveLength(2);
    await expect(middle).toBeFocused();
  });

  await test.step('from the strip by the keyboard, it acts on what had focus before, which gets it back', async () => {
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => appMenus(app)).toHaveLength(3);
    await expect(middle).toBeFocused();
  });
});

test('a right-click in a code view’s text gets Lo’s menu, and one in a comment box the Edit menu; and one in a text field gets the system’s Edit menu, not Lo’s', async ({
  app,
  page,
}) => {
  await test.step('a right-click in a code view’s text gets Lo’s menu, and one in a comment box the Edit menu', async () => {
    await recordNativeMenus(app);
    // CodeMirror's text is editable content to the page, in a diff and in a comment box alike.
    await page.evaluate(() => {
      const window = document.querySelector('[data-lo-scope="window"]');
      for (const scope of ['diff', 'box']) {
        const view = document.createElement('div');
        view.dataset.loScope = scope;
        const text = document.createElement('div');
        text.id = scope;
        text.className = 'cm-content';
        text.contentEditable = 'true';
        text.textContent = 'const a = 1;';
        view.append(text);
        window?.append(view);
      }
    });
    await page.locator('#diff').click({ button: 'right' });
    await expect(menuOf(page)).toBeVisible();
    await expect(menuOf(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menuOf(page)).toBeHidden();
    expect(await nativeMenus(app)).toEqual([]);

    await page.locator('#box').click({ button: 'right' });
    await expect.poll(() => nativeMenus(app)).toEqual(['cut,copy,paste,separator,selectall']);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  await test.step('a right-click in a text field gets the system’s Edit menu, not Lo’s', async () => {
    // Counting the native menus afresh.
    await recordNativeMenus(app);
    await middleOf(page).focus();
    await page.keyboard.press('?');
    const search = page
      .getByRole('dialog', { name: 'Keyboard shortcuts' })
      .getByRole('searchbox', { name: 'Search keys and commands' });
    await expect(search).toBeFocused();
    await search.click({ button: 'right' });
    await expect.poll(() => nativeMenus(app)).toEqual(['cut,copy,paste,separator,selectall']);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});
