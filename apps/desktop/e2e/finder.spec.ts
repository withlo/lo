// The file finder in the app: Lo started on the replay server, as rozed-bot, opens rozed-dev/e2e#78,
// and ⌘P lists the repository's files by name, the pull request's changes first and marked. Tab lists
// only the changed files, ⏎ goes to a file, ⌘⏎ opens it whole, and Esc gives focus back.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Locator, Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const mac = process.platform === 'darwin';
const held = mac ? 'Meta' : 'Control';

const test = base.extend<{ github: ReplayServer; remote: string; tokenFile: string }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeAppRemote(test.info().outputPath('remote')));
  },
  // oxlint-disable-next-line no-empty-pattern
  tokenFile: async ({}, use) => {
    const file = test.info().outputPath('token');
    writeFileSync(file, `${TOKEN}\n`);
    await use(file);
  },
  launch: async ({ github, remote, tokenFile }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
      },
    });
  },
});

/** Waits for the account from the token file, then opens #78's tab, and returns its id. */
async function openE2e(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (number) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
    APP_PULL.number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

const tree = (page: Page) => page.locator('[role="tree"][data-lo-scope="tree"]');
const row = (page: Page, key: string) => tree(page).locator(`[data-key="${key}"]`);
const finder = (page: Page) => page.getByRole('dialog', { name: 'Go to a file' });
const field = (page: Page) => finder(page).getByRole('combobox', { name: 'Go to a file' });
const options = (page: Page) => finder(page).getByRole('option');
const middle = (page: Page) => page.locator('main[data-lo-middle]');

/** The key of the row the tree's keyboard is on. */
async function focused(page: Page): Promise<string | null> {
  return tree(page).evaluate((element) => {
    const id = element.getAttribute('aria-activedescendant');
    return id === null ? null : (document.getElementById(id)?.getAttribute('data-key') ?? null);
  });
}

/** Opens #78 and waits for its tree from the local copy. */
async function shown(page: Page): Promise<void> {
  const id = await openE2e(page);
  await expect
    .poll(
      async () => {
        const reply = await page.evaluate(
          (tab) => window.lo.invoke('tree.current', { id: tab }),
          id,
        );
        return reply.ok ? reply.value : reply;
      },
      { timeout: 20_000 },
    )
    .toMatchObject({ at: APP_PULL.head, from: 'local', changesFrom: 'local' });
  await expect(row(page, 'src/parser.ts')).toBeVisible();
}

/** Opens the finder with `⌘P` and waits until it takes what's typed. */
async function openFinder(page: Page): Promise<void> {
  await page.keyboard.press(`${held}+p`);
  await expect(finder(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(options(page).first()).toBeVisible();
}

/** What the rows say, one string a row: the name, the folder and the marks. */
const texts = (rows: Locator) => rows.evaluateAll((all) => all.map((one) => one.textContent));

test('⌘P lists the files by name, the changed ones first and marked, and Esc gives focus back', async ({
  page,
}) => {
  await shown(page);
  await middle(page).focus();
  await openFinder(page);
  // The changed files come first, each with how it changed, then the rest of the repository.
  const labels = finder(page).locator('[role="group"]');
  await expect(labels.first()).toContainText('Changed in this pull request · 7');
  await expect(labels.nth(1)).toContainText('Everywhere else in e2e');
  const all = await texts(options(page));
  expect(all.slice(0, 7).toSorted()).toEqual([
    'format.tssrcM',
    'legacy.tssrcD',
    'mark.pngassetsM',
    'numbers.txtdataA',
    'parser.tssrcR',
    'pnpm-lock.yamlM',
    'wrap.tssrc/textA',
  ]);
  expect(all.slice(7).every((each) => each?.endsWith('whole file'))).toBe(true);
  await expect(options(page).filter({ hasText: 'README.md' })).toContainText('whole file');

  // The foot says what the keys do.
  const foot = finder(page).locator('kbd');
  await expect(foot).toContainText(
    mac ? ['⌘P', '⏎', '⌘⏎', 'Tab'] : ['Ctrl+P', 'Enter', 'Ctrl+Enter', 'Tab'],
  );

  // Typing narrows the list, with the letters that matched marked.
  await page.keyboard.type('parser');
  await expect(options(page)).toHaveCount(1);
  await expect(options(page).first()).toContainText('parser.ts');
  await expect(options(page).first().locator('mark')).toHaveText(['parser']);

  // Esc closes the finder and focus goes back to where it came from.
  await page.keyboard.press('Escape');
  await expect(finder(page)).toBeHidden();
  await expect(middle(page)).toBeFocused();

  // It forgets what was typed.
  await openFinder(page);
  await expect(field(page)).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(middle(page)).toBeFocused();
});

test('Tab lists only the changed files, and keeps the keyboard in the finder', async ({ page }) => {
  await shown(page);
  await middle(page).focus();
  await openFinder(page);
  const everything = await options(page).count();
  expect(everything).toBeGreaterThan(7);

  await page.keyboard.press('Tab');
  await expect(options(page)).toHaveCount(7);
  await expect(field(page)).toBeFocused();
  await expect(finder(page)).toContainText('7 of 7 changed files');
  await expect(finder(page).getByText('All files')).toBeVisible();
  expect((await texts(options(page))).some((each) => each?.endsWith('whole file'))).toBe(false);

  // A search narrows the changed files alone.
  await page.keyboard.type('src');
  await expect(options(page).first()).toContainText('src');
  expect((await texts(options(page))).every((each) => !each?.endsWith('whole file'))).toBe(true);
  await page.keyboard.press(`${held}+a`);
  await page.keyboard.press('Backspace');

  await page.keyboard.press('Tab');
  await expect(options(page)).toHaveCount(everything);
  await expect(field(page)).toBeFocused();
  await expect(finder(page).getByText('All files')).toBeHidden();

  // Nothing matches among the changed files, though a file that isn't changed does.
  await page.keyboard.type('readme');
  await expect(options(page)).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(options(page)).toHaveCount(0);
  await expect(finder(page)).toContainText('No changed file matches "readme".');
  await page.keyboard.press('Escape');
  await expect(middle(page)).toBeFocused();
});

test('⏎ reveals a changed file in the tree, and says why the diff can’t show it yet', async ({
  page,
}) => {
  await shown(page);
  // The tree's folders are closed, so the file has to be found there.
  await page.locator('[data-lo-middle]').focus();
  await page.keyboard.press('-');
  await expect(tree(page)).toBeFocused();
  await page.keyboard.press('z');
  await page.keyboard.press('Shift+M');
  await expect(row(page, 'src/text/wrap.ts')).toHaveCount(0);

  // Opened from the tree, the finder gives the tree its focus back.
  await openFinder(page);
  await page.keyboard.type('wrap');
  await expect(options(page).first()).toContainText('wrap.ts');
  await page.keyboard.press('Enter');
  await expect(finder(page)).toBeHidden();
  await expect(tree(page)).toBeFocused();
  await expect(row(page, 'src/text/wrap.ts')).toBeVisible();
  expect(await focused(page)).toBe('src/text/wrap.ts');
  // There's no diff yet to follow it.
  await expect(page.getByRole('status').filter({ hasText: 'Show the file' })).toContainText(
    'There’s no diff on screen to show it in.',
  );
});

test('⏎ on an unchanged file and ⌘⏎ ask for the whole file, and say why they can’t yet', async ({
  page,
}) => {
  await shown(page);
  await middle(page).focus();
  await openFinder(page);
  await page.keyboard.type('readme');
  await expect(options(page).first()).toContainText('README.md');
  await page.keyboard.press('Enter');
  await expect(finder(page)).toBeHidden();
  await expect(middle(page)).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Show the file' })).toContainText(
    'Lo has no whole-file view to open it in.',
  );

  // ⌘⏎ opens a changed file whole too.
  await openFinder(page);
  await page.keyboard.type('format');
  await expect(options(page).first()).toContainText('format.ts');
  await page.keyboard.press(`${held}+Enter`);
  await expect(finder(page)).toBeHidden();
  await expect(middle(page)).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Whole file' })).toContainText(
    'Lo has no whole-file view to open it in.',
  );
});

test('⌘P says there’s no pull request on screen when none is', async ({ page }) => {
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
  await middle(page).focus();
  await page.keyboard.press(`${held}+p`);
  await expect(finder(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Go to a file' })).toContainText(
    'There’s no pull request on screen.',
  );
});

test('Tab and ⌘⏎ do nothing in the other palettes, and Tab still keeps the keyboard there', async ({
  page,
}) => {
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();
  await middle(page).focus();
  for (const [open, name] of [
    [`${held}+Shift+p`, 'Command palette'],
    [`${held}+l`, 'Open a pull request'],
  ] as const) {
    await page.keyboard.press(open);
    const palette = page.getByRole('dialog', { name });
    const input = palette.getByRole('combobox', { name });
    await expect(input).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press(`${held}+Enter`);
    await expect(input).toBeFocused();
    await expect(palette).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /finder|highlighted/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  }
});
