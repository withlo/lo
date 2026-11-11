import type { Page } from '@playwright/test';

import { expect, test } from './app.ts';

const mac = process.platform === 'darwin';

/** The window's right-click menu: what a click on nothing in particular lists. */
const menuOf = (page: Page) => page.getByRole('menu', { name: 'Actions' });

/** The item the menu has highlighted. */
const highlighted = (page: Page) => menuOf(page).locator('[role="menuitem"][data-highlighted]');

test('a right-click lists the actions with their keys in this system’s form', async ({ page }) => {
  const middle = page.locator('main[data-lo-middle]');
  await middle.click({ button: 'right' });
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveText([
    new RegExp(`^Back${mac ? '⌃o' : 'Ctrl\\+O'}$`),
    new RegExp(`^Forward${mac ? '⌃i' : 'Ctrl\\+I'}$`),
    new RegExp(`^Command palette${mac ? '⌘⇧P' : 'Ctrl\\+Shift\\+P'}$`),
    /^Every key\?$/,
  ]);
  // Sections follow the key table's groups: Code, Find, Tabs and window.
  await expect(menu.getByRole('separator')).toHaveCount(2);
  // The menu is a scope of its own, which is how j and k move in it.
  await expect(menu).toHaveAttribute('data-lo-scope', 'menu');
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
  await page.keyboard.press('ArrowDown');
  await expect(highlighted(page)).toContainText('Command palette');
  await page.keyboard.press('k');
  await expect(highlighted(page)).toContainText('Forward');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(highlighted(page)).toContainText('Every key');
  // ⏎ runs the command through the same handler the key `?` does.
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  const help = page.getByRole('dialog', { name: 'Every key' });
  await expect(help).toBeVisible();
  // It ran with focus back where the menu was opened, so closing it returns focus there.
  await expect(help.getByRole('searchbox', { name: 'Find a key or an action' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(middle).toBeFocused();
});

test('clicking an action runs it', async ({ page }) => {
  await page.locator('main[data-lo-middle]').click({ button: 'right' });
  await menuOf(page)
    .getByRole('menuitem', { name: /^Command palette/ })
    .click();
  await expect(menuOf(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
});

test('Esc closes the menu and gives focus back to where it was', async ({ page }) => {
  const middle = page.locator('main[data-lo-middle]');
  await middle.click({ button: 'right' });
  await expect(menuOf(page)).toBeVisible();
  await page.keyboard.press('j');
  await page.keyboard.press('Escape');
  await expect(menuOf(page)).toBeHidden();
  await expect(middle).toBeFocused();
  // Nothing ran: key help would be open if the first action had.
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
    await page.keyboard.press('j');
    await expect(highlighted(page)).toContainText('Command palette');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox', { name: 'Command palette' })).toBeFocused();
    // The palette closes on Esc, and focus is back where the menu was opened.
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(middle).toBeFocused();
  });
}

test('the menu key is in key help, in this system’s form', async ({ page }) => {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Every key' });
  await expect(help.locator('[data-command="keys.menu"] kbd')).toHaveText(
    mac ? ['Menu', '⇧F10'] : ['Menu', 'Shift+F10'],
  );
});
