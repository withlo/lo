// Opening pull requests in the app, on the replay server: the open box (`⌘L`) with what it opens
// and as whom, a public pull request read only without signing in, links from other apps (`lo://`,
// a second launch's arguments, the arguments Lo starts with), the Recent list and its keys, and
// the `lo` command, installed and run.

import { execFile } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { ElectronApplication, Page } from '@playwright/test';

import { appFolder, browsed, dataFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';
const TITLE = "App: the pull request Lo's end-to-end tests open";
const E2E = 'https://github.com/rozed-dev/e2e/pull/80';

const mac = process.platform === 'darwin';
const cmd = (key: string) => `${mac ? 'Meta' : 'Control'}+${key}`;

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  /** Whether Lo starts signed in as rozed-bot. */
  signedIn: boolean;
  /** Arguments Lo starts with, after its own. */
  links: string[];
}>({
  signedIn: [true, { option: true }],
  links: [[], { option: true }],
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    // Closed once, by the test that takes GitHub away or after it.
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= server.close());
    await use({ ...server, close });
    await close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeAppRemote(test.info().outputPath('remote')));
  },
  launch: async ({ github, remote, signedIn, links }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN, ...links],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_GIT_REMOTE: remote,
        LO_COMMAND_FOLDER: test.info().outputPath('bin'),
        ...(signedIn ? { LO_TEST_TOKEN_FILE: tokenFile } : {}),
      },
    });
  },
});

/** Waits for the account from the token file. */
async function accountIn(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
}

const box = (page: Page) => page.getByRole('dialog', { name: 'Open a pull request' });
const input = (page: Page) => box(page).getByRole('combobox', { name: 'Open a pull request' });
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const header = (page: Page) => page.locator('header').first();
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Opens the box with `⌘L` and types `text` into it. */
async function type(page: Page, text: string): Promise<void> {
  await page.keyboard.press(cmd('L'));
  await expect(box(page)).toBeVisible();
  await input(page).fill(text);
}

test('⌘L opens a pull request link as the account that can see it', async ({ page }) => {
  await accountIn(page);
  await type(page, `${E2E}/files#diff-1`);
  const row = box(page).getByRole('option');
  await expect(row).toContainText('e2e #80');
  await expect(row).toContainText(TITLE);
  await expect(row).toContainText('as rozed-bot');
  await expect(box(page)).toContainText('Open');
  await page.keyboard.press('Enter');

  await expect(box(page)).toBeHidden();
  await expect(heading(page)).toHaveText(TITLE);
  await expect(header(page)).toContainText('as rozed-bot');
  // `⌘O` opens it too on macOS, and the link to an open pull request shows its tab.
  await page.keyboard.press(mac ? 'Meta+O' : 'Control+L');
  await input(page).fill(E2E);
  await expect(box(page).getByRole('option')).toContainText('as rozed-bot');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tablist', { name: 'Pull requests' }).getByRole('tab')).toHaveCount(
    1,
  );
});

test('says what a link it doesn’t open is, and sends a web link to the browser', async ({
  page,
}) => {
  await accountIn(page);
  await type(page, 'https://github.com/rozed-dev/e2e/issues/12');
  await expect(box(page)).toContainText('That’s an issue, not a pull request');
  await expect(box(page)).toContainText('Open in the browser');
  await page.keyboard.press('Enter');
  await expect(box(page)).toBeHidden();
  await expect.poll(browsed).toEqual(['https://github.com/rozed-dev/e2e/issues/12']);

  await type(page, 'rozed-dev/e2e#80');
  await expect(box(page)).toContainText('That isn’t a link Lo opens');
  await page.keyboard.press('Enter');
  await expect(box(page)).toBeVisible();

  await input(page).fill('https://github.com/rozed-dev/gone/pull/1');
  await expect(box(page)).toContainText('None of your accounts can see rozed-dev/gone');
  await expect(box(page).getByRole('button', { name: 'Add an account' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box(page)).toBeHidden();
  expect(browsed()).toHaveLength(1);
});

test.describe('without an account', () => {
  test.use({ signedIn: false });

  test('opens a public pull request read only, unpolled and not in Recent', async ({ page }) => {
    await expect(page.getByText('No pull requests yet')).toBeVisible();
    await type(page, E2E);
    await expect(box(page).getByRole('option')).toContainText('read only, without signing in');
    await page.keyboard.press('Enter');

    await expect(heading(page)).toHaveText(TITLE);
    await expect(header(page)).toContainText('Not signed in');
    await expect(header(page)).toContainText('Read only');
    await expect(
      header(page).getByRole('button', { name: 'Sign in to see revisions' }),
    ).toBeVisible();

    // Closed, it isn't among the pull requests opened lately.
    // Once the box has closed: keys under it are its own until then.
    await expect(box(page)).toBeHidden();
    await page.keyboard.press(cmd('W'));
    await expect(page.getByText('No pull requests yet')).toBeVisible();
    expect(await page.evaluate(() => window.lo.invoke('open.recent'))).toEqual({
      ok: true,
      value: [],
    });
  });
});

/** Hands Lo a link the way the system does, as if another app opened it. */
async function openUrl(app: ElectronApplication, url: string): Promise<void> {
  await app.evaluate(({ app: electron }, link) => {
    electron.emit('open-url', { preventDefault: () => undefined }, link);
  }, url);
}

test('opens lo:// links and a second launch’s links as a typed link, and says why it can’t', async ({
  app,
  page,
}) => {
  await accountIn(page);
  await openUrl(app, 'lo://github.com/rozed-dev/e2e/pull/80');
  await expect(heading(page)).toHaveText(TITLE);

  await openUrl(app, 'lo://github.com/rozed-dev/e2e/issues/12');
  await expect(toast(page, 'lo:// links to pull requests only')).toBeVisible();
  expect(browsed()).toEqual([]);

  // A second launch's switches are never taken, nor anything but links.
  await app.evaluate(({ app: electron }) => {
    electron.emit(
      'second-instance',
      {},
      [
        '/Applications/Lo.app/Contents/MacOS/Lo',
        '--inspect=9229',
        'https://github.com/rozed-dev/e2e/pull/9999',
      ],
      '/',
    );
  });
  await expect(page.getByRole('tablist', { name: 'Pull requests' }).getByRole('tab')).toHaveCount(
    2,
  );
  await expect(
    page.getByRole('alert').filter({ hasText: "Lo can't open this pull request." }),
  ).toBeVisible();
});

test.describe('started with a link', () => {
  test.use({ links: [E2E, '--not-a-link-just-a-switch', 'file:///etc/passwd'] });

  test('opens the pull request it was started with', async ({ page }) => {
    await expect(heading(page)).toHaveText(TITLE);
    await expect(page.getByRole('tablist', { name: 'Pull requests' }).getByRole('tab')).toHaveCount(
      1,
    );
  });
});

test('lists the pull requests opened lately, filters them and opens one by its keys', async ({
  page,
  github,
}) => {
  await accountIn(page);
  await expect(page.getByText('No pull requests yet')).toBeVisible();
  await type(page, E2E);
  await expect(box(page).getByRole('option')).toContainText('as rozed-bot');
  await page.keyboard.press('Enter');
  await expect(heading(page)).toHaveText(TITLE);
  // Its poller has read it, which keeps it among the recent ones, with its title.
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('open.recent'))))
    .toContain(TITLE);
  // Opened again, its poller would read the repository's list again, which the cassette doesn't
  // hold, so GitHub goes away first, which checks everything asked of it so far: the row opens
  // with its account, from what Lo saved.
  await github.close();
  // Once the box has closed: keys under it are its own until then.
  await expect(box(page)).toBeHidden();
  await page.keyboard.press(cmd('W'));

  const list = page.getByRole('listbox', { name: 'Recent pull requests' });
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('rozed-dev/e2e #80');
  await expect(list.getByRole('option')).toContainText(TITLE);
  await expect(list.getByRole('option')).toContainText('rozed-bot');
  await expect(list).toBeFocused();

  await page.keyboard.press('/');
  const filter = page.getByRole('searchbox', { name: 'Filter recent pull requests' });
  await expect(filter).toBeFocused();
  await page.keyboard.type('nothing like it');
  await expect(page.getByText('No recent pull request matches “nothing like it”.')).toBeVisible();
  await filter.fill('e2e 80');
  await expect(list.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(list).toBeFocused();
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(heading(page)).toHaveText(TITLE);
  await expect(header(page)).toContainText('as rozed-bot');
});

test('fills the box from the clipboard, and never takes anything else on it', async ({
  app,
  page,
}) => {
  // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
  test.skip(mac, "The Mac's clipboard is its user's.");
  await accountIn(page);
  await app.evaluate(({ clipboard }) => clipboard.writeText('a secret, not a link'));
  await page.keyboard.press(cmd('L'));
  await expect(box(page)).toBeVisible();
  await expect(input(page)).toHaveValue('');
  await page.keyboard.press('Escape');
  // Once the box has closed: keys under it are its own until then.
  await expect(box(page)).toBeHidden();

  await app.evaluate(
    ({ clipboard }, link) => clipboard.writeText(`${link}/files?token=abc#x`),
    E2E,
  );
  await page.keyboard.press(cmd('L'));
  await expect(input(page)).toHaveValue(E2E);
  await expect(box(page)).toContainText('from clipboard');
  await expect(box(page).getByRole('option')).toContainText('as rozed-bot');
  await page.keyboard.press('Escape');

  // `⌘V` in Recent opens it.
  await expect(page.getByRole('listbox', { name: 'Recent pull requests' })).toBeFocused();
  await page.keyboard.press(cmd('V'));
  await expect(heading(page)).toHaveText(TITLE);
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
});

/** Runs `program` with `args`, and resolves once it exits. */
function run(program: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile(program, args, { timeout: 30_000 }, (error) => {
      resolve(error ? Number(error.code ?? 1) : 0);
    });
  });
}

test('installs the lo command, which hands a link to the Lo running', async ({ app, page }) => {
  await accountIn(page);
  if (mac) {
    const labels = await app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items[0]?.submenu?.items ?? []).map((item) => item.label),
    );
    expect(labels).toContain('Install command-line tool');
  }
  const reply = await page.evaluate(() => window.lo.invoke('open.installCommand'));
  const lo = join(test.info().outputPath('bin'), 'lo');
  expect(reply).toEqual({ ok: true, value: { kind: 'installed', path: lo, onPath: false } });
  expect(statSync(lo).mode & 0o111).not.toBe(0);
  expect(readFileSync(lo, 'utf8')).toContain(`LO_USER_DATA_DIR=${dataFolder()}`);

  // An option never reaches Lo.
  expect(await run(lo, ['--remote-debugging-port=9222'])).toBe(2);
  expect(await run(lo, [E2E])).toBe(0);
  await expect(heading(page)).toHaveText(TITLE);
});
