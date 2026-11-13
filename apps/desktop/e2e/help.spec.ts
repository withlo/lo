import type { Page } from '@playwright/test';

import { expect, signedIn as test, middleOf } from './app.ts';

const mac = process.platform === 'darwin';

/** Opens the command palette by its key, from the middle of the window. */
async function openPalette(page: Page) {
  await middleOf(page).focus();
  await page.keyboard.press(mac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox', { name: 'Command palette' })).toBeFocused();
  return palette;
}

test('? shows every key in this system’s form, and Esc closes it', async ({ page }) => {
  const middle = middleOf(page);
  await middle.focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Every key' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('group', { name: 'Code' })).toContainText('Back');
  await expect(help.locator('[data-command="keys.back"] kbd')).toHaveText(mac ? '⌃o' : 'Ctrl+O');
  await expect(help.locator('[data-command="keys.palette"] kbd')).toHaveText(
    mac ? '⌘⇧P' : 'Ctrl+Shift+P',
  );
  // Typing searches rather than running keys.
  await expect(help.getByRole('searchbox', { name: 'Find a key or an action' })).toBeFocused();
  await page.keyboard.type('forward');
  await expect(help.locator('[data-command]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(middle).toBeFocused();
});

test('the palette runs the highlighted command with ⏎', async ({ page }) => {
  const palette = await openPalette(page);
  // `?` typed in the palette is text, not key help.
  await page.keyboard.type('every key?');
  await expect(page.getByRole('dialog', { name: 'Every key' })).toBeHidden();
  await page.keyboard.press('Backspace');
  await expect(palette.getByRole('option').first()).toContainText('Every key');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Every key' })).toBeVisible();
});

test('⌥⏎ in the palette shows the highlighted command in key help', async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type('forward');
  await expect(palette.getByRole('option').first()).toContainText('Forward');
  await page.keyboard.press('Alt+Enter');
  await expect(palette).toBeHidden();
  const help = page.getByRole('dialog', { name: 'Every key' });
  await expect(help).toBeVisible();
  await expect(help.locator('[aria-current="true"]')).toHaveAttribute(
    'data-command',
    'keys.forward',
  );
});

test('the palette says an action’s key as aria-keyshortcuts, with its key caps hidden', async ({
  page,
}) => {
  const palette = await openPalette(page);
  const option = palette.getByRole('option').filter({ hasText: 'Command palette' }).first();
  await expect(option).toHaveAttribute(
    'aria-keyshortcuts',
    mac ? 'Meta+Shift+P' : 'Control+Shift+P',
  );
  await expect(option.locator('kbd')).toHaveAttribute('aria-hidden', 'true');
  // The name is the label, not the letters of its key.
  await expect(palette.getByRole('option', { name: 'Command palette', exact: true })).toHaveCount(
    1,
  );
});
