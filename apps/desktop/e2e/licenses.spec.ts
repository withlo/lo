import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { appFolder, expect, middleOf, opened, signedIn as test } from './app.ts';

const mac = process.platform === 'darwin';

test('Open licenses opens the licenses file the build wrote, as text: from the palette, and from the right-click menu, where the About panel says to look', async ({
  page,
}) => {
  const licenses = realpathSync(join(appFolder, 'dist', 'licenses.txt'));
  // The build made it: Lo's license first, then each package's.
  expect(existsSync(licenses)).toBe(true);
  expect(readFileSync(licenses, 'utf8')).toMatch(/^Lo\n==\n\nCopyright © 2026 Mike Scornavacca/);

  await test.step('from the palette', async () => {
    await middleOf(page).focus();
    await page.keyboard.press(mac ? 'Meta+Shift+P' : 'Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('Open licenses');
    await expect(palette.getByRole('option').first()).toContainText('Open licenses');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    // The test's stand-in for the system's editor is given the file's path.
    await expect.poll(opened).toEqual([licenses]);
  });

  await test.step('from the right-click menu', async () => {
    await middleOf(page).click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Actions' });
    await menu.getByRole('menuitem', { name: 'Open licenses', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect.poll(opened).toEqual([licenses, licenses]);
  });
});
