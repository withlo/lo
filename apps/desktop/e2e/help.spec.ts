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

test('? shows the keys that work here, and a tab for each area, in this system’s form, and Esc closes it', async ({
  page,
}) => {
  const middle = middleOf(page);
  await middle.focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('tab', { name: 'Here', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(help.getByRole('group', { name: 'View' })).toContainText('Command palette');
  await expect(help.locator('[data-command="keys.palette"] kbd')).toHaveText(
    mac ? '⌘⇧P' : 'Ctrl+Shift+P',
  );
  // Back has nowhere to go yet, so it's under Anywhere, not Here.
  await expect(help.locator('[data-command="keys.back"]')).toHaveCount(0);
  await help.getByRole('tab', { name: 'Anywhere' }).click();
  await expect(help.getByRole('group', { name: 'Go' })).toContainText('Back');
  await expect(help.locator('[data-command="keys.back"] kbd')).toHaveText(mac ? '⌃o' : 'Ctrl+O');
  // Typing searches every area rather than running keys.
  await help.getByRole('searchbox', { name: 'Search keys and commands' }).focus();
  await page.keyboard.type('forward');
  await expect(help.locator('[data-command]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(middle).toBeFocused();
});

test('the palette runs the highlighted command with ⏎', async ({ page }) => {
  const palette = await openPalette(page);
  // `?` typed in the palette is text, not keyboard shortcuts.
  await page.keyboard.type('keyboard shortcuts?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
  await page.keyboard.press('Backspace');
  await expect(palette.getByRole('option').first()).toContainText('Keyboard shortcuts');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('⌥⏎ in the palette shows the highlighted command in keyboard shortcuts', async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type('keyboard shortcuts');
  await expect(palette.getByRole('option').first()).toContainText('Keyboard shortcuts');
  await page.keyboard.press('Alt+Enter');
  await expect(palette).toBeHidden();
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.locator('[aria-current="true"]')).toHaveAttribute('data-command', 'keys.help');
});

test('the palette says a command’s key as aria-keyshortcuts, with its key caps hidden', async ({
  page,
}) => {
  const palette = await openPalette(page);
  const option = palette.getByRole('option').filter({ hasText: 'Open pull request…' }).first();
  await expect(option).toHaveAttribute('aria-keyshortcuts', mac ? 'Meta+L' : 'Control+L');
  await expect(option.locator('kbd')).toHaveAttribute('aria-hidden', 'true');
  // The name is the label, not the letters of its key.
  await expect(
    palette.getByRole('option', { name: 'Open pull request…', exact: true }),
  ).toHaveCount(1);
  // It doesn't list itself.
  await expect(palette.getByRole('option').filter({ hasText: 'Command palette' })).toHaveCount(0);
});
