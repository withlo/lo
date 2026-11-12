// A pull request's revisions in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#80, whose second push rebased its first onto a newer base. The header's button and
// the revision picker (`gv`) compare any two revisions, across the rebase, and the diff and the tree
// follow; a tab the reader left at the first push opens on what changed since; and a revision
// GitHub no longer has, which Lo never fetched, shows as no longer available.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  tokenFile: string;
  /** Whether the remote has the first push, as GitHub does. */
  firstPush: boolean;
}>({
  firstPush: [true, { option: true }],
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    await use(server);
    await server.close();
  },
  remote: async ({ firstPush }, use) => {
    await use(writeAppRemote(test.info().outputPath('remote'), { firstPush }));
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

/** What main has of a tab's revisions. */
async function revisions(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('revisions.list', { id: tab }), id);
  return reply.ok ? reply.value : reply;
}

/** The diff's files, by path, in the order the view shows them, once it's drawn. */
async function diffFiles(page: Page): Promise<string[]> {
  return page.evaluate(() => window.loDiff?.files.map((file) => file.path) ?? []);
}

const button = (page: Page) => page.locator('header').getByRole('button', { name: /→/ });
const picker = (page: Page) => page.getByRole('listbox', { name: 'Revisions' });
const option = (page: Page, head: string) => picker(page).locator(`[data-key="${head}"]`);
const note = (page: Page) => page.getByRole('note', { name: 'What the diff compares' });
const row = (page: Page, key: string) =>
  page.locator('[role="tree"][data-lo-scope="tree"]').locator(`[data-key="${key}"]`);

/** Opens #80, and waits for its revisions and for its diff from the local copy. */
async function shown(page: Page): Promise<string> {
  const id = await openE2e(page);
  await expect
    .poll(() => revisions(page, id), { timeout: 30_000 })
    .toMatchObject({
      status: 'ready',
      revisions: [{ head: APP_PULL.firstHead }, { head: APP_PULL.head }],
    });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  return id;
}

test('the picker lists the revisions and compares two, across the rebase', async ({ page }) => {
  const id = await shown(page);
  await expect(button(page)).toContainText('base → r2');
  await expect(note(page)).toContainText('Every change, base → r2');
  await expect.poll(() => diffFiles(page)).toHaveLength(7);

  // `gv` from the diff opens the picker at the comparison on screen.
  await page.locator('.lo-diffview').click();
  await page.keyboard.press('g');
  await page.keyboard.press('v');
  await expect(picker(page)).toBeFocused();
  await expect(option(page, APP_PULL.head)).toContainText('r2');
  await expect(option(page, APP_PULL.head)).toContainText('Force-pushed · rebased onto app/base');
  await expect(option(page, APP_PULL.head)).toContainText('Newest');
  await expect(option(page, APP_PULL.firstHead)).toContainText('r1');
  await expect(option(page, 'base')).toContainText('app/base');
  await expect(option(page, APP_PULL.head)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'base')).toHaveAttribute('aria-selected', 'true');

  // `j` to r1, `Space` makes it the older end, `⏎` compares.
  await page.keyboard.press('j');
  await page.keyboard.press(' ');
  await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'base')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('button', { name: /Compare r1 → r2/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);

  // Only what the author changed since r1 shows: the base's README and everything r1 had stay out.
  await expect(button(page)).toContainText('r1 → r2');
  await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  await expect(note(page)).toContainText('r1 → r2 · across a rebase: only what the author changed');
  await expect
    .poll(() => revisions(page, id))
    .toMatchObject({
      comparison: { from: APP_PULL.firstHead, to: APP_PULL.head },
      replay: 'clean',
    });
  // The tree marks the file that changed between them, and steps the pull request's others back.
  await expect(row(page, 'src/parser.ts')).toHaveAttribute('data-hit', '');
  await expect(row(page, 'src/format.ts')).not.toHaveAttribute('data-hit');
  await expect(row(page, 'src/format.ts')).toHaveClass(/text-fg-dim/);

  // The picker's shortcut back to the whole pull request.
  await page.locator('.lo-diffview').click();
  await page.keyboard.press('g');
  await page.keyboard.press('v');
  await expect(picker(page)).toBeFocused();
  await page.keyboard.press('w');
  await expect(button(page)).toContainText('base → r2');
  await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toHaveLength(7);
  await expect(row(page, 'src/format.ts')).not.toHaveClass(/text-fg-dim/);
});

test('opens on what changed since the reader last looked, across the rebase, and `gv` comes back to it', async ({
  app,
  github,
  remote,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  // A first run makes the database; the reader left the pull request at its first push.
  await app.close();
  const database = new DatabaseSync(join(dataFolder(), 'lo.db'));
  try {
    database
      .prepare('INSERT INTO revisions_lastseen (login, pull, head, seen_at) VALUES (?, ?, ?, ?)')
      .run('rozed-bot', 'rozed-dev/e2e#80', APP_PULL.firstHead, Date.now() - 60_000);
  } finally {
    database.close();
  }
  const again = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(github.urls.api).origin,
      LO_TEST_TOKEN_FILE: tokenFile,
      LO_GIT_REMOTE: remote,
    },
    chromiumSandbox: true,
  });
  try {
    const page = await again.firstWindow();
    await page.waitForLoadState('load');
    const id = await openE2e(page);
    // It opens on r1 → r2, and draws nothing of the whole pull request first.
    await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 30_000 });
    await expect(button(page)).toContainText('r1 → r2');
    await expect(button(page)).toContainText('since you last looked');
    expect(await diffFiles(page)).toEqual(['src/parser.ts']);
    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(1);
    await expect(note(page)).toContainText('r1 → r2, since you last looked');
    await expect
      .poll(() => revisions(page, id))
      .toMatchObject({ markers: { lastSeen: APP_PULL.firstHead } });

    // The whole pull request, then `gv` and the shortcut back to since last seen.
    await page.locator('.lo-diffview').click();
    await page.keyboard.press('g');
    await page.keyboard.press('v');
    await expect(option(page, APP_PULL.firstHead)).toContainText('Last seen here');
    await page.keyboard.press('w');
    await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toHaveLength(7);
    await page.locator('.lo-diffview').click();
    await page.keyboard.press('g');
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: /Since last seen · r1 → r2/ })).toBeVisible();
    await page.keyboard.press('s');
    await expect(button(page)).toContainText('r1 → r2');
    await expect.poll(() => diffFiles(page), { timeout: 20_000 }).toEqual(['src/parser.ts']);
  } finally {
    await again.close();
  }
});

test.describe('without the first push', () => {
  test.use({ firstPush: false });

  test('shows a revision GitHub no longer has, which Lo never fetched, as no longer available', async ({
    page,
  }) => {
    const id = await shown(page);
    await expect
      .poll(() => revisions(page, id), { timeout: 20_000 })
      .toMatchObject({
        revisions: [
          { head: APP_PULL.firstHead, available: false },
          { head: APP_PULL.head, available: true },
        ],
      });
    await button(page).click();
    await expect(picker(page)).toBeFocused();
    await expect(option(page, APP_PULL.firstHead)).toContainText('No longer available');
    await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-disabled', 'true');
    // It can't be an end.
    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        ([tab, from, to]) => window.lo.invoke('revisions.compare', { id: tab, from, to }),
        [id, APP_PULL.firstHead, APP_PULL.head],
      ),
    ).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
