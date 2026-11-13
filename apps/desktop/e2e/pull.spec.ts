// A pull request's tab in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#80 with its header and its local copy, fetched from the same pull request built on
// this machine; says so in a banner when a pull request can't be opened; comes back offline with
// what it saved; and never gives the window the token.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';
const TITLE = "App: the pull request Lo's end-to-end tests open";

const test = base.extend<{ github: ReplayServer; remote: string; tokenFile: string }>({
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

type Opening = { owner: string; repo: string; number: number };
const E2E: Opening = { owner: 'rozed-dev', repo: 'e2e', number: APP_PULL.number };

/** Waits for the account from the token file, then opens `pull`'s tab, and returns its id. */
async function open(page: Page, pull: Opening): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (input) => window.lo.invoke('tab.open', { kind: 'pull', ...input }),
    pull,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** What main has for a tab, as the window asks it. */
async function state(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('tab.state', { id: tab }), id);
  return reply.ok ? reply.value : reply;
}

const strip = (page: Page) => page.getByRole('tablist', { name: 'Pull requests' });
const status = (page: Page) => page.locator('footer[aria-label="Status"]');

test('opens a pull request with its header, and fetches its local copy at the head it opened at', async ({
  page,
}) => {
  const id = await open(page, E2E);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
  const header = page.locator('header').first();
  await expect(header).toContainText('Open');
  await expect(header).toContainText('#80');
  await expect(header).toContainText('as rozed-bot');
  await expect(header).toContainText('rozed-bot wants to merge');
  await expect(header).toContainText('app/feature');
  await expect(header).toContainText('app/base');
  // The strip and the window take its title, once it's arrived.
  await expect(strip(page).getByRole('tab', { selected: true })).toContainText(TITLE);
  await expect(strip(page).getByRole('tab', { selected: true })).not.toHaveAttribute('aria-busy');
  await expect(page).toHaveTitle(`rozed-dev/e2e#80 — ${TITLE}`);

  await expect(status(page)).toContainText('Local copy', { timeout: 20_000 });
  await expect
    .poll(() => state(page, id), { timeout: 20_000 })
    .toMatchObject({
      local: {
        state: {
          kind: 'ready',
          head: APP_PULL.head,
          base: APP_PULL.base,
          mergeBase: APP_PULL.base,
          offline: false,
        },
      },
      files: { total: 7 },
    });
  // All's well, so there's no banner.
  await expect(page.locator('[data-lo-banners]')).toHaveCount(0);
});

test("says why a pull request GitHub doesn't have, or one no account can see, can't be opened", async ({
  page,
}) => {
  await open(page, { ...E2E, number: 9999 });
  const banner = page.getByRole('alert').filter({ hasText: "Lo can't open this pull request." });
  await expect(banner).toContainText(
    "GitHub has no pull request rozed-dev/e2e#9999, or rozed-bot can't see it.",
  );
  await expect(banner.getByRole('button', { name: 'Try again' })).toBeVisible();
  // The tab isn't busy: it's opened all it can.
  await expect(strip(page).getByRole('tab', { selected: true })).toHaveText('e2e #9999');
  await expect(strip(page).getByRole('tab', { selected: true })).not.toHaveAttribute('aria-busy');

  await open(page, { owner: 'rozed-dev', repo: 'gone', number: 1 });
  await expect(
    page.getByRole('alert').filter({ hasText: "Lo can't open this pull request." }),
  ).toContainText('GitHub has no public pull request rozed-dev/gone#1.');
  await expect(page.locator('header').first()).toContainText('Not signed in');
});

test('comes back offline with what it saved and what it fetched', async ({
  app,
  page,
  github,
  remote,
}) => {
  // Offline shows once it has lasted, here a second rather than the app's own wait.
  test.setTimeout(90_000);
  const id = await open(page, E2E);
  await expect
    .poll(() => state(page, id), { timeout: 20_000 })
    .toMatchObject({
      local: { state: { kind: 'ready' } },
      pull: { header: { author: 'rozed-bot' } },
    });
  await app.close();
  // GitHub goes away, at the same address.
  await github.close();

  const again = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(github.urls.api).origin,
      LO_GIT_REMOTE: remote,
      LO_OFFLINE_AFTER_MS: '1000',
    },
    chromiumSandbox: true,
  });
  try {
    const shown = await again.firstWindow();
    await shown.waitForLoadState('load');
    await expect(shown.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    await expect(shown.getByRole('status').filter({ hasText: "You're offline." })).toContainText(
      'Showing what Lo saved',
      { timeout: 30_000 },
    );
    await expect(shown.locator('header').first()).toContainText('Offline');
    await expect
      .poll(() => state(shown, id), { timeout: 20_000 })
      .toMatchObject({
        pull: { connection: { kind: 'offline' }, shown: APP_PULL.head, problem: null },
        local: { state: { kind: 'ready', head: APP_PULL.head } },
      });
  } finally {
    await again.close();
  }
});

test('shows a spinner and a placeholder on a tab still opening, until GitHub answers', async () => {
  // A GitHub that takes every connection and never answers.
  const sockets = new Set<Socket>();
  const silent = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const address = silent.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  const app = await electron.launch({
    args: [appFolder],
    env: { ...appEnvironment(dataFolder()), LO_GITHUB: `http://127.0.0.1:${address.port}` },
    chromiumSandbox: true,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    await page.evaluate(() =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 }),
    );
    const tab = strip(page).getByRole('tab', { selected: true });
    await expect(tab).toHaveAttribute('aria-busy', 'true');
    await expect(tab).toHaveText('e2e #80');
    await expect(tab.locator('.spinner')).toBeVisible();
    await expect(tab.locator('.skeleton')).toBeVisible();
    // The header holds the places of what hasn't arrived, and the middle says it's opening.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(page.getByText('Opening the pull request…')).toBeVisible();
  } finally {
    await app.close();
    for (const socket of sockets) socket.destroy();
    silent.close();
  }
});

test('never gives the window the token, nor puts it in any process’s arguments', async ({
  page,
}) => {
  // Everything main pushes the window from now, kept in the page.
  await page.evaluate(() => {
    const values: unknown[] = [];
    Reflect.set(window, 'loHeard', values);
    for (const topic of ['tab.pull', 'tab.files', 'tab.local', 'tab.tabs']) {
      window.lo.subscribe(topic, (value) => values.push(value));
    }
  });
  const id = await open(page, E2E);
  await expect
    .poll(() => state(page, id), { timeout: 20_000 })
    .toMatchObject({ local: { state: { kind: 'ready' } } });
  const values: unknown[] = await page.evaluate(() => {
    const heard: unknown = Reflect.get(window, 'loHeard');
    return Array.isArray(heard) ? heard : [];
  });
  expect(values.length).toBeGreaterThan(3);
  expect(JSON.stringify([values, await state(page, id)])).not.toContain(TOKEN);
  expect(execFileSync('ps', ['-A', '-ww', '-o', 'args='], { encoding: 'utf8' })).not.toContain(
    TOKEN,
  );
});
