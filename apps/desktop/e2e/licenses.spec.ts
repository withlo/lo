import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { appFolder, expect, middleOf, opened, signedIn, test } from './app.ts';

const mac = process.platform === 'darwin';

test('Show licenses in the palette opens the licenses file the build wrote, as text', async ({
  page,
}) => {
  const licenses = join(appFolder, 'dist', 'licenses.txt');
  // The build made it: Lo's license first, then each package's.
  expect(existsSync(licenses)).toBe(true);
  expect(readFileSync(licenses, 'utf8')).toMatch(/^Lo\n==\n\nCopyright © 2026 Mike Scornavacca/);

  await middleOf(page).focus();
  await page.keyboard.press(mac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Show licenses');
  await expect(palette.getByRole('option').first()).toContainText('Show licenses');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  // The test's stand-in for the system's editor is given the file's path.
  await expect.poll(opened).toEqual([realpathSync(licenses)]);
});

signedIn(
  'Show licenses in the right-click menu, where the About panel says to look, opens the same file',
  async ({ page }) => {
    await middleOf(page).click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Actions' });
    await menu.getByRole('menuitem', { name: 'Show licenses', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect.poll(opened).toEqual([realpathSync(join(appFolder, 'dist', 'licenses.txt'))]);
  },
);
