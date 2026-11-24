import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { dataFolder, expect, keymapPath, opened, test } from './app.ts';

const mac = process.platform === 'darwin';

/** Opens keyboard shortcuts by its key, from the middle of the window. */
async function openHelp(page: Page) {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  return help;
}

/** Saves the keymap file as editors that write a new file and rename it over the old one do. */
function saveByRename(text: string): void {
  const path = keymapPath(dataFolder());
  writeFileSync(`${path}~`, text);
  renameSync(`${path}~`, path);
}

test.describe('with a keymap file', () => {
  test.use({
    keymap: [
      '# Open the palette with the key most apps use.',
      'bind cmd+k keys.palette',
      'unbind cmd+shift+p keys.palette',
      'bind x nope.nothing',
      'vim normal Y y$',
      '',
    ].join('\n'),
  });

  test('keyboard shortcuts shows its remap and a bad line’s error, and a change to the file applies', async ({
    page,
  }) => {
    const help = await openHelp(page);
    const palette = help.locator('[data-command="keys.palette"] kbd');
    await expect(palette).toHaveText([mac ? '⌘K' : 'Ctrl+K']);
    const alert = help.getByRole('alert');
    await expect(alert).toContainText('Can’t use 1 line of the keymap file');
    await expect(alert).toContainText('Line 4 · No command nope.nothing');

    // The remap works: the palette opens on its new key.
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.keyboard.press(mac ? 'Meta+K' : 'Control+K');
    const commands = page.getByRole('dialog', { name: 'Command palette' });
    await expect(commands.getByRole('combobox', { name: 'Command palette' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(commands).toBeHidden();

    // A new file, saved the way editors save: the keys change, and the error goes.
    await openHelp(page);
    saveByRename('bind cmd+j keys.palette\n');
    await expect(palette).toHaveText([mac ? '⌘J' : 'Ctrl+J', mac ? '⌘⇧P' : 'Ctrl+Shift+P']);
    await expect(help.getByRole('alert')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.keyboard.press(mac ? 'Meta+J' : 'Control+J');
    await expect(commands.getByRole('combobox', { name: 'Command palette' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(commands).toBeHidden();

    // Writing it in place applies too, and a line that can't apply is reported where it is.
    await openHelp(page);
    writeFileSync(keymapPath(dataFolder()), '# nothing here\n\n\nbind alt+p keys.nope\n');
    await expect(help.getByRole('alert')).toContainText('Line 4 · No command keys.nope');
    await expect(palette).toHaveText([mac ? '⌘⇧P' : 'Ctrl+Shift+P']);
  });
});

/** Presses `g` and `,` in the middle of the window, which open the keymap file. */
async function pressOpen(page: Page): Promise<void> {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press('g');
  await page.keyboard.press(',');
}

/** The toast Lo says why something didn't happen in. */
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

const openKeymap = (help: ReturnType<Page['locator']>) =>
  help.getByRole('button', { name: 'Open keymap file' });

test.describe('with no keymap file', () => {
  test('keyboard shortcuts opens the keymap file, making it first, and never writes over one', async ({
    page,
  }) => {
    const path = keymapPath(dataFolder());
    const help = await openHelp(page);
    await expect(help.getByRole('alert')).toHaveCount(0);

    await openKeymap(help).click();
    // Lo makes the file as it opens it, so there is nothing to resolve until it has.
    await expect.poll(() => existsSync(path)).toBe(true);
    await expect.poll(opened).toEqual([realpathSync(path)]);
    expect(readFileSync(path, 'utf8')).toMatch(/^# Lo’s keymap\./);
    // Keyboard shortcuts stays, so what's wrong with the file is there when its editor is closed.
    await expect(help).toBeVisible();
    await expect(help.getByRole('alert')).toHaveCount(0);

    // What the person writes there is theirs: opening it again leaves it as it is.
    const mine = 'bind cmd+j keys.palette\n';
    writeFileSync(path, mine);
    await expect(help.locator('[data-command="keys.palette"] kbd')).toHaveText([
      mac ? '⌘J' : 'Ctrl+J',
      mac ? '⌘⇧P' : 'Ctrl+Shift+P',
    ]);
    await openKeymap(help).click();
    await expect.poll(opened).toEqual([realpathSync(path), realpathSync(path)]);
    expect(readFileSync(path, 'utf8')).toBe(mine);
  });

  test('g , opens it too', async ({ page }) => {
    const path = keymapPath(dataFolder());
    await pressOpen(page);
    await expect.poll(() => existsSync(path)).toBe(true);
    await expect.poll(opened).toEqual([realpathSync(path)]);
    await expect(page.getByRole('status').filter({ hasText: /\w/ })).toHaveCount(0);
  });
});

test.describe('with a keymap file that opening could run', () => {
  const script = '#!/bin/sh\necho hello\nbind cmd+j keys.palette\n';
  test.use({ keymap: script });

  test('an executable one is not opened: keyboard shortcuts says why and has no button, and g , says why too', async ({
    page,
  }) => {
    const path = keymapPath(dataFolder());
    chmodSync(path, 0o755);
    const help = await openHelp(page);
    await expect(help.getByRole('alert').first()).toContainText('The keymap file is executable');
    await expect(help.getByRole('alert').first()).toContainText(
      'Clear its execute permission to open it from here.',
    );
    await expect(openKeymap(help)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await pressOpen(page);
    await expect(toast(page, 'The keymap file is executable')).toBeVisible();
    // The reason alone, not under the command's name.
    await expect(toast(page, 'Open keymap file')).toHaveCount(0);
    // Nothing was started.
    await page.waitForTimeout(300);
    expect(opened()).toEqual([]);

    // Once it is a plain file, keyboard shortcuts offers it again, and it opens.
    chmodSync(path, 0o644);
    await openHelp(page);
    await expect(openKeymap(help)).toBeVisible();
    await openKeymap(help).click();
    await expect.poll(opened).toEqual([realpathSync(path)]);
  });

  test('a link to an app is not opened, whatever is at the end of it', async ({ page }) => {
    const path = keymapPath(dataFolder());
    const app = join(dataFolder(), 'Calculator.app');
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'MacOS', 'Calculator'), '#!/bin/sh\n');
    chmodSync(join(app, 'Contents', 'MacOS', 'Calculator'), 0o755);
    rmSync(path);
    symlinkSync(app, path);

    const help = await openHelp(page);
    await expect(help.getByRole('alert')).toContainText('Can’t read the keymap file');
    await expect(help.getByRole('alert')).toContainText('It isn’t a file.');
    await expect(openKeymap(help)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await pressOpen(page);
    await expect(toast(page, 'The keymap file can’t be opened')).toBeVisible();
    await page.waitForTimeout(300);
    expect(opened()).toEqual([]);
  });
});
