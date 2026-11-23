import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import type { ElectronApplication, Page } from '@playwright/test';

import { appFolder, expect, middleOf, opened, signedIn as test } from './app.ts';

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

test('a right-click lists Back and Forward with their keys in this system’s form, and on Linux About Lo, and Show licenses, which have none, and a screen reader hears an item’s name and key, not its key caps', async ({
  page,
}) => {
  const middle = middleOf(page);
  await middle.click({ button: 'right' });
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveText([
    new RegExp(`^Back${mac ? '⌃o' : 'Ctrl\\+O'}$`),
    new RegExp(`^Forward${mac ? '⌃i' : 'Ctrl\\+I'}$`),
    // Linux has no app menu to open About from, so its menu lists it, with no key.
    ...(mac ? [] : [/^About Lo$/]),
    // Both systems list how to read Lo's license, which the About panel says to look for here.
    /^Show licenses$/,
  ]);
  // Back and Forward are in the key table's Code group, so no separator sits between them. About
  // Lo and Show licenses, in another, sit after one.
  await expect(menu.getByRole('separator')).toHaveCount(1);
  // The menu is a scope of its own, which is how j and k move in it.
  await expect(menu).toHaveAttribute('data-lo-scope', 'menu');

  // The same menu, for a screen reader.
  // The name is the label alone, since the key caps are hidden from it.
  const back = menu.getByRole('menuitem', { name: 'Back', exact: true });
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Control+O');
  await expect(back.locator('kbd')).toHaveAttribute('aria-hidden', 'true');
  const forward = menu.getByRole('menuitem', { name: 'Forward', exact: true });
  await expect(forward).toHaveAttribute('aria-keyshortcuts', 'Control+I');
  // With nowhere to go, both are dimmed, with nothing under them: the dimmed label says it.
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(forward).toHaveAttribute('aria-disabled', 'true');
});

test('Esc closes the menu and gives focus back to where it was; and j and k move through the menu, ⏎ does nothing on a dimmed action, and runs one that can run, and the menu closes', async ({
  page,
}) => {
  const middle = middleOf(page);

  // First, while Lo has said nothing: the one that closes the menu checks that none ran.
  await test.step('Esc closes the menu and gives focus back to where it was', async () => {
    await middle.click({ button: 'right' });
    await expect(menuOf(page)).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('Escape');
    await expect(menuOf(page)).toBeHidden();
    await expect(middle).toBeFocused();
    // Nothing ran.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /\w/ })).toHaveCount(0);
  });

  await test.step('j and k move through the menu, ⏎ does nothing on a dimmed action, and runs one that can run, and the menu closes', async () => {
    await middle.click({ button: 'right' });
    const menu = menuOf(page);
    await expect(menu).toBeVisible();
    // Nothing is highlighted until the keys move it, and j and k move it as ↓ and ↑ do.
    await expect(highlighted(page)).toHaveCount(0);
    await page.keyboard.press('j');
    await expect(highlighted(page)).toContainText('Back');
    await page.keyboard.press('j');
    await expect(highlighted(page)).toContainText('Forward');
    await page.keyboard.press('k');
    await expect(highlighted(page)).toContainText('Back');
    await page.keyboard.press('ArrowDown');
    await expect(highlighted(page)).toContainText('Forward');
    // Forward, dimmed with nowhere to go, does nothing on ⏎, and says nothing: the menu stays.
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /\w/ })).toHaveCount(0);
    // ⏎ on one that can run runs it, through the same handler as its key, and the menu closes.
    await page.keyboard.press('j');
    if (!mac) await page.keyboard.press('j');
    await expect(highlighted(page)).toContainText('Show licenses');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect.poll(opened).toEqual([realpathSync(join(appFolder, 'dist', 'licenses.txt'))]);
    await expect(middle).toBeFocused();
  });
});

for (const key of ['Shift+F10', 'ContextMenu']) {
  test(`${key} opens the menu of what has focus, under the keyboard’s control`, async ({
    page,
  }) => {
    const middle = middleOf(page);
    await middle.focus();
    await page.keyboard.press(key);
    const menu = menuOf(page);
    await expect(menu).toBeVisible();
    // From the keyboard, the first action is highlighted already, dimmed or not.
    await expect(highlighted(page)).toContainText('Back');
    await page.keyboard.press('j');
    await expect(highlighted(page)).toContainText('Forward');
    await page.keyboard.press('k');
    await expect(highlighted(page)).toContainText('Back');
    // Esc closes it, and focus is back where the menu was opened.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(middle).toBeFocused();
  });
}

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
      .getByRole('dialog', { name: 'Every key' })
      .getByRole('searchbox', { name: 'Find a key or an action' });
    await expect(search).toBeFocused();
    await search.click({ button: 'right' });
    await expect.poll(() => nativeMenus(app)).toEqual(['cut,copy,paste,separator,selectall']);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});
