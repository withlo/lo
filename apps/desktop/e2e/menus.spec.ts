import type { ElectronApplication, Page } from '@playwright/test';

import { expect, test } from './app.ts';

const mac = process.platform === 'darwin';

/** The window's right-click menu: what a click on nothing in particular lists. */
const menuOf = (page: Page) => page.getByRole('menu', { name: 'Actions' });

/** The item the menu has highlighted. */
const highlighted = (page: Page) => menuOf(page).locator('[role="menuitem"][data-highlighted]');

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

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

test('a right-click lists Back and Forward with their keys in this system’s form', async ({
  page,
}) => {
  const middle = page.locator('main[data-lo-middle]');
  await middle.click({ button: 'right' });
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveText([
    new RegExp(`^Back${mac ? '⌃o' : 'Ctrl\\+O'}$`),
    new RegExp(`^Forward${mac ? '⌃i' : 'Ctrl\\+I'}$`),
  ]);
  // Both are in the key table's Code group, so no separator sits between them.
  await expect(menu.getByRole('separator')).toHaveCount(0);
  // The menu is a scope of its own, which is how j and k move in it.
  await expect(menu).toHaveAttribute('data-lo-scope', 'menu');
});

test('an item is 26px tall, and its key sits 8px from its label', async ({ page }) => {
  await page.locator('main[data-lo-middle]').click({ button: 'right' });
  const back = menuOf(page).getByRole('menuitem').first();
  await expect(back).toBeVisible();
  const item = await back.boundingBox();
  expect(item?.height).toBe(26);
  const gap = await back.evaluate((element) => getComputedStyle(element).columnGap);
  expect(gap).toBe('8px');
});

test('a screen reader hears an item’s name and key, not its key caps', async ({ page }) => {
  await page.locator('main[data-lo-middle]').click({ button: 'right' });
  const menu = menuOf(page);
  // The name is the label alone, since the key caps are hidden from it.
  const back = menu.getByRole('menuitem', { name: 'Back', exact: true });
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Control+O');
  await expect(back.locator('kbd')).toHaveAttribute('aria-hidden', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Forward', exact: true })).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+I',
  );
});

test('j and k move through the menu, ⏎ runs the highlighted action, and the menu closes', async ({
  page,
}) => {
  const middle = page.locator('main[data-lo-middle]');
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
  // ⏎ runs the command through the same handler its key does, and with nowhere to go, says so.
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(said(page, "There's nowhere to go forward to.")).toBeVisible();
  await expect(middle).toBeFocused();
});

test('the menu runs what the key runs: Back with no history says why, by menu or by key', async ({
  page,
}) => {
  const middle = page.locator('main[data-lo-middle]');
  await middle.focus();
  await page.keyboard.press('Control+O');
  const note = said(page, "There's nowhere to go back to.");
  await expect(note).toBeVisible();
  // The note goes by itself.
  await expect(note).toHaveCount(0, { timeout: 10_000 });
  await middle.click({ button: 'right' });
  await menuOf(page).getByRole('menuitem', { name: 'Back', exact: true }).click();
  await expect(menuOf(page)).toBeHidden();
  await expect(said(page, "There's nowhere to go back to.")).toBeVisible();
});

test('Esc closes the menu and gives focus back to where it was', async ({ page }) => {
  const middle = page.locator('main[data-lo-middle]');
  await middle.click({ button: 'right' });
  await expect(menuOf(page)).toBeVisible();
  await page.keyboard.press('j');
  await page.keyboard.press('Escape');
  await expect(menuOf(page)).toBeHidden();
  await expect(middle).toBeFocused();
  // Nothing ran: Back would have said it had nowhere to go.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /\w/ })).toHaveCount(0);
});

for (const key of ['Shift+F10', 'ContextMenu']) {
  test(`${key} opens the menu of what has focus, under the keyboard’s control`, async ({
    page,
  }) => {
    const middle = page.locator('main[data-lo-middle]');
    await middle.focus();
    await page.keyboard.press(key);
    const menu = menuOf(page);
    await expect(menu).toBeVisible();
    // From the keyboard, the first action is highlighted already.
    await expect(highlighted(page)).toContainText('Back');
    await page.keyboard.press('j');
    await expect(highlighted(page)).toContainText('Forward');
    await page.keyboard.press('k');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(said(page, "There's nowhere to go back to.")).toBeVisible();
    // Focus is back where the menu was opened.
    await expect(middle).toBeFocused();
  });
}

test('no other command runs while a menu is open: not key help, the palette or back', async ({
  page,
}) => {
  const middle = page.locator('main[data-lo-middle]');
  await middle.click({ button: 'right' });
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  await page.keyboard.press('?');
  await page.keyboard.press(mac ? 'Meta+Shift+P' : 'Control+Shift+P');
  await page.keyboard.press('Control+O');
  await page.keyboard.press('Control+I');
  // Still one menu, and nothing opened over it or ran under it.
  await expect(menu).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /\w/ })).toHaveCount(0);
  // The menu's own keys still work, and Esc closes it and nothing else.
  await page.keyboard.press('j');
  await expect(highlighted(page)).toContainText('Back');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(middle).toBeFocused();
  // Closed, the same keys run again.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Every key' })).toBeVisible();
});

test('the menu key is in key help, in this system’s form', async ({ page }) => {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Every key' });
  await expect(help.locator('[data-command="keys.menu"] kbd')).toHaveText(
    mac ? ['Menu', '⇧F10'] : ['Menu', 'Shift+F10'],
  );
});

test('a right-click in a text field gets the system’s Edit menu, not Lo’s', async ({
  app,
  page,
}) => {
  await recordNativeMenus(app);
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press('?');
  const search = page
    .getByRole('dialog', { name: 'Every key' })
    .getByRole('searchbox', { name: 'Find a key or an action' });
  await expect(search).toBeFocused();
  await search.click({ button: 'right' });
  await expect.poll(() => nativeMenus(app)).toEqual(['cut,copy,paste,separator,selectall']);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('a right-click in a code view’s text gets Lo’s menu, and one in a comment box the Edit menu', async ({
  app,
  page,
}) => {
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
