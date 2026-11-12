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
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  dataFolder,
  DIFF_FIRST,
  expect,
  KEYCHAIN,
  test as base,
} from './app.ts';

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

/**
 * Closes the first copy of Lo, which made the database, and notes that the reader left the pull
 * request at its first push; then starts Lo again on the same data, fetching from `remote`, and
 * waiting `wait` milliseconds for the comparison that asks for.
 */
async function leftAtFirstPush(
  app: ElectronApplication,
  options: { github: ReplayServer; tokenFile: string; remote: string; wait: number },
): Promise<ElectronApplication> {
  await app.close();
  const database = new DatabaseSync(join(dataFolder(), 'lo.db'));
  try {
    database
      .prepare('INSERT INTO revisions_lastseen (login, pull, head, seen_at) VALUES (?, ?, ?, ?)')
      .run('rozed-bot', 'rozed-dev/e2e#80', APP_PULL.firstHead, Date.now() - 60_000);
  } finally {
    database.close();
  }
  return electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(options.github.urls.api).origin,
      LO_TEST_TOKEN_FILE: options.tokenFile,
      LO_GIT_REMOTE: options.remote,
      LO_COMPARE_WAIT_MS: String(options.wait),
    },
    chromiumSandbox: true,
  });
}

/** The file at the top of the diff, by its id in the view. */
async function fileAtTop(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const top = window.loDiff?.viewport().at;
    return top?.kind === 'line' ? top.at.file : top?.file;
  });
}

test('opens on what changed since the reader last looked, across the rebase, and `gv` comes back to it', async ({
  app,
  github,
  remote,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  // Waiting long enough for the comparison, however slow the machine: it's drawn first.
  const again = await leftAtFirstPush(app, { github, tokenFile, remote, wait: 30_000 });
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

test('draws the whole pull request when the local copy comes late, and only offers what changed since the reader last looked', async ({
  app,
  github,
  tokenFile,
}) => {
  test.setTimeout(90_000);
  // No remote yet: the local copy can't be fetched, so the comparison can't be ready in time.
  const late = test.info().outputPath('late-remote');
  const again = await leftAtFirstPush(app, {
    github,
    tokenFile,
    remote: `file://${late}`,
    wait: 1_000,
  });
  try {
    const page = await again.firstWindow();
    await page.waitForLoadState('load');
    const id = await openE2e(page);
    // GitHub's diff of the whole pull request, once the wait is over.
    await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => diffFiles(page)).toHaveLength(7);
    await expect(button(page)).toContainText('base → r2');
    // The reader moves on, two files down.
    await page.locator('.lo-diffview').click();
    await page.keyboard.press(']');
    await page.keyboard.press('f');
    await page.keyboard.press(']');
    await page.keyboard.press('f');
    await page.waitForTimeout(300);
    const top = await fileAtTop(page);
    expect(top).toBeDefined();

    // The local copy comes: the comparison is ready, and offered.
    writeAppRemote(late);
    await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
    await expect
      .poll(() => revisions(page, id), { timeout: 30_000 })
      .toMatchObject({
        comparison: { from: null, to: APP_PULL.head },
        offered: { from: APP_PULL.firstHead, to: APP_PULL.head },
        waitingFor: null,
      });
    await expect
      .poll(
        async () => {
          const reply = await page.evaluate(
            (tab) => window.lo.invoke('diff.versions', { id: tab }),
            id,
          );
          return reply.ok ? reply.value : reply;
        },
        { timeout: 30_000 },
      )
      .toMatchObject({ from: 'local', comparison: null });
    await expect(note(page)).toContainText('r1 → r2, since you last looked: gv');
    await page.waitForTimeout(1500);
    // Nothing changed by itself: the same view, its files, and the reader's place in it.
    expect(await page.evaluate(() => window.loDiff?.draws)).toBe(1);
    expect(await diffFiles(page)).toHaveLength(7);
    expect(await fileAtTop(page)).toBe(top);
    await expect(button(page)).toContainText('base → r2');

    // Until the reader asks: `gv` opens at the comparison offered, and `⏎` takes it.
    await page.keyboard.press('g');
    await page.keyboard.press('v');
    await expect(picker(page)).toBeFocused();
    await expect(option(page, APP_PULL.firstHead)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, APP_PULL.head)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
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
