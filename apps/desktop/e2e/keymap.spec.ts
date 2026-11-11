import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import type { ElectronApplication, Page } from '@playwright/test';

import { dataFolder, expect, keymapPath, test } from './app.ts';

const mac = process.platform === 'darwin';

/** Opens key help by its key, from the middle of the window. */
async function openHelp(page: Page) {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Every key' });
  await expect(help).toBeVisible();
  return help;
}

/**
 * Replaces the system's way of opening a file with one that records the path and answers `result`,
 * so a test never starts an editor on a desktop that other work shares.
 */
async function stubOpenPath(app: ElectronApplication, result = ''): Promise<void> {
  await app.evaluate(({ shell }, answer) => {
    const opened: string[] = [];
    Reflect.set(globalThis, 'loOpened', opened);
    shell.openPath = async (path) => {
      opened.push(path);
      return answer;
    };
  }, result);
}

/** The paths the stub was asked to open. */
function openedPaths(app: ElectronApplication): Promise<unknown> {
  return app.evaluate((): unknown => Reflect.get(globalThis, 'loOpened'));
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

  test('key help shows its remap and a bad line’s error, and a change to the file applies', async ({
    page,
  }) => {
    const help = await openHelp(page);
    const palette = help.locator('[data-command="keys.palette"] kbd');
    await expect(palette).toHaveText([mac ? '⌘K' : 'Ctrl+K']);
    const alert = help.getByRole('alert');
    await expect(alert).toContainText("The keymap file has a line Lo can't use:");
    await expect(alert).toContainText("Line 4: There's no command called nope.nothing.");

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
    await expect(help.getByRole('alert')).toContainText(
      "Line 4: There's no command called keys.nope.",
    );
    await expect(palette).toHaveText([mac ? '⌘⇧P' : 'Ctrl+Shift+P']);
  });
});

test.describe('with a keymap file over the limit', () => {
  test.use({ keymap: `# ${'-'.repeat(1024 * 1024)}` });

  test('key help says Lo didn’t read it, and reads the next file that’s small enough', async ({
    page,
  }) => {
    const help = await openHelp(page);
    await expect(help.getByRole('alert')).toHaveText(
      "The keymap file is over 1 MiB, so Lo didn't read it.",
    );
    saveByRename('bind cmd+j keys.palette\n');
    await expect(help.getByRole('alert')).toHaveCount(0);
    await expect(help.locator('[data-command="keys.palette"] kbd')).toHaveText([
      mac ? '⌘J' : 'Ctrl+J',
      mac ? '⌘⇧P' : 'Ctrl+Shift+P',
    ]);
  });
});

test.describe('with no keymap file', () => {
  test('key help opens the keymap file, making it first, and never writes over one', async ({
    app,
    page,
  }) => {
    await stubOpenPath(app);
    const path = keymapPath(dataFolder());
    const help = await openHelp(page);
    await expect(help.getByRole('alert')).toHaveCount(0);

    await help.getByRole('button', { name: 'Open the keymap file' }).click();
    await expect.poll(() => openedPaths(app)).toEqual([path]);
    expect(readFileSync(path, 'utf8')).toMatch(/^# Lo's keymap\./);
    // Key help stays, so what's wrong with the file is there when its editor is closed.
    await expect(help).toBeVisible();
    await expect(help.getByRole('alert')).toHaveCount(0);

    // What the person writes there is theirs: opening it again leaves it as it is.
    const mine = 'bind cmd+j keys.palette\n';
    writeFileSync(path, mine);
    await expect(help.locator('[data-command="keys.palette"] kbd')).toHaveText([
      mac ? '⌘J' : 'Ctrl+J',
      mac ? '⌘⇧P' : 'Ctrl+Shift+P',
    ]);
    await help.getByRole('button', { name: 'Open the keymap file' }).click();
    await expect.poll(() => openedPaths(app)).toEqual([path, path]);
    expect(readFileSync(path, 'utf8')).toBe(mine);
  });

  test('g , opens it, and key help says when the system can’t', async ({ app, page }) => {
    await stubOpenPath(app, 'No application is set to open it.');
    await page.locator('main[data-lo-middle]').focus();
    await page.keyboard.press('g');
    await page.keyboard.press(',');
    await expect.poll(() => openedPaths(app)).toEqual([keymapPath(dataFolder())]);
    const help = await openHelp(page);
    await expect(help.getByRole('alert')).toHaveText("Lo couldn't open the keymap file.");
  });
});
