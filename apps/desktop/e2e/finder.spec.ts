// The file finder in the app: Lo started on the replay server, as rozed-bot, opens rozed-dev/e2e#80,
// and ⌘P finds the repository's files: ⏎ goes to a file, and Esc gives focus back.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';

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

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });

/** Waits for the account from the token file, then opens #80's tab, and returns its id. */
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
const finder = (page: Page) => page.getByRole('dialog', { name: 'Go to file' });
const field = (page: Page) => finder(page).getByRole('combobox', { name: 'Go to file' });
const options = (page: Page) => finder(page).getByRole('option');
const middle = (page: Page) => page.locator('main[data-lo-middle]');
/** A file's header in the diff's new side. */
const diffHeader = (page: Page, path: string) =>
  page.locator('.lo-diffview .cm-editor').nth(1).locator(`.lo-diffhead[data-path="${path}"]`);

/** The key of the row the tree's keyboard is on. */
async function focused(page: Page): Promise<string | null> {
  return tree(page).evaluate((element) => {
    const id = element.getAttribute('aria-activedescendant');
    return id === null ? null : (document.getElementById(id)?.getAttribute('data-key') ?? null);
  });
}

/** Opens #80 and waits for its tree from the local copy. */
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

test('⏎ reveals a changed file in the tree, and the diff shows it', async ({ page }) => {
  await shown(page);
  await expect(page.locator('.lo-diffview')).toBeVisible();
  // The tree's folders are closed, so the file has to be found there.
  await page.locator('main[data-lo-middle]').focus();
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
  // The diff brings the file's header on screen, focus staying in the tree.
  await expect(diffHeader(page, 'src/text/wrap.ts')).toBeInViewport();
});

test('closing a palette or keyboard shortcuts gives focus back to where it was, in a pull request’s tab', async ({
  page,
}) => {
  await shown(page);
  const overlays = [
    [`${held}+Shift+p`, 'Command palette'],
    [`${held}+l`, 'Open pull request'],
    [`${held}+p`, 'Go to file'],
    ['?', 'Keyboard shortcuts'],
  ] as const;
  // The middle of the window takes focus without being tabbable, and holds the tree, which is.
  for (const [where, origin] of [
    ['the middle', middle(page)],
    ['the tree', tree(page)],
  ] as const) {
    for (const [open, name] of overlays) {
      await origin.focus();
      await page.keyboard.press(open);
      const overlay = page.getByRole('dialog', { name });
      await expect(overlay).toBeVisible();
      await expect(origin).not.toBeFocused();
      await page.keyboard.press('Escape');
      await expect(overlay).toBeHidden();
      await expect(origin, `${name} from ${where}`).toBeFocused();
    }
  }
});
