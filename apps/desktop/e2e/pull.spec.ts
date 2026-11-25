// A pull request's tab in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#80 with its header and its local copy, fetched from the same pull request built on
// this machine; says why in place of its view when a pull request can't be opened, whatever GitHub
// answers; comes back offline with what it saved; and never gives the window the token.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { buffer } from 'node:stream/consumers';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type Page } from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  dataFolder,
  DIFF_FIRST,
  drawnWindow,
  expect,
  KEYCHAIN,
  tabBanners,
  test as base,
} from './app.ts';

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

// Some of their pull requests have no overview, and the cassette doesn’t answer for timelines.
test.use({ settings: DIFF_FIRST });

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

const strip = (page: Page) => page.getByRole('tablist', { name: 'Tabs' });
const status = (page: Page) => page.locator('footer[aria-label="Status bar"]');

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
  await expect(page).toHaveTitle(`rozed-dev/e2e#80 · ${TITLE}`);

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
  await expect(tabBanners(page)).toHaveCount(0);
});

test("says why a pull request GitHub doesn't have, or one no account can see, can't be opened", async ({
  page,
}) => {
  await open(page, { ...E2E, number: 9999 });
  // In place of the tab's view, with no banner over it.
  const failed = page.locator('[data-lo-failed]');
  const why = failed.getByRole('alert').filter({ hasText: 'Can’t open #9999' });
  await expect(why).toContainText('It doesn’t exist, or rozed-bot can’t see it.');
  await expect(tabBanners(page)).toHaveCount(0);
  // Nothing to try again: it can be looked for on GitHub, or closed.
  await expect(failed.getByRole('button', { name: 'Open on GitHub' })).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Close tab' })).toBeVisible();
  // The tab isn't busy: it's opened all it can.
  await expect(strip(page).getByRole('tab', { selected: true })).toHaveText('e2e #9999');
  await expect(strip(page).getByRole('tab', { selected: true })).not.toHaveAttribute('aria-busy');
  // Around it, nothing waits or acts: the header names what was asked for and holds no places, with
  // no merge status, review or revisions, and the view's controls and the files are inert, with no
  // files to wait for.
  const header = page.locator('[data-lo-pull] header');
  await expect(header.getByRole('heading', { level: 1 })).toHaveText('rozed-dev/e2e');
  await expect(header).toContainText('#9999');
  await expect(header.locator('.skeleton')).toHaveCount(0);
  for (const gone of [
    /^Checking/,
    /^Submit review/,
    /^Reading revisions/,
    /^Sign in to compare revisions/,
  ]) {
    await expect(header.getByRole('button', { name: gone })).toHaveCount(0);
  }
  await expect(header.locator('[inert]')).toHaveCount(1);
  const files = page.getByRole('complementary', { name: 'Files' });
  await expect(files).toHaveAttribute('inert', '');
  await expect(files.locator('.skeleton')).toHaveCount(0);

  await open(page, { owner: 'rozed-dev', repo: 'gone', number: 1 });
  const gone = page.locator('[data-lo-failed]');
  // Signed in, but no account can see it: nothing to sign in with.
  await expect(gone.getByRole('alert').filter({ hasText: 'Can’t open #1' })).toContainText(
    'It doesn’t exist, or none of your accounts can see it.',
  );
  await expect(gone.getByRole('button', { name: 'Close tab' })).toBeVisible();
  await expect(page.locator('header').first()).toContainText('Not signed in');
});

/**
 * How GitHub answers, behind the replay: as recorded; refusing every request's token but the one
 * that asks whose it is (`refused`), as for a token GitHub revoked after Lo signed in with it; with
 * the rate limit used up (`limited`); or never (`silent`), holding each connection open.
 */
type Answering = 'recorded' | 'refused' | 'limited' | 'silent';

/** When the rate limit `limited` staged resets, in seconds since the Unix epoch. */
const RESET = Math.floor(Date.now() / 1000) + 3600;

/** GitHub's own answer to each request it doesn't answer as recorded, as `answering` stages it. */
function staged(
  answering: Exclude<Answering, 'recorded' | 'silent'>,
  path: string,
): { status: number; headers: Record<string, string>; body: string } | undefined {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  switch (answering) {
    case 'refused':
      return path === '/api/user'
        ? undefined
        : {
            status: 401,
            headers,
            body: JSON.stringify({
              message: 'Bad credentials',
              documentation_url: 'https://docs.github.com/rest',
            }),
          };
    case 'limited':
      return {
        status: 403,
        headers: {
          ...headers,
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(RESET),
          'x-ratelimit-resource': 'core',
        },
        body: JSON.stringify({
          message: 'API rate limit exceeded for 127.0.0.1.',
          documentation_url: 'https://docs.github.com/rest',
        }),
      };
    default:
      answering satisfies never;
      throw new Error(`Answering GitHub doesn't know: ${String(answering)}`);
  }
}

/**
 * `test`, with GitHub answering as the test stages it, from a server in front of the replay, and
 * Lo saying it's offline once that has lasted a second. With `account` false, Lo starts with no
 * account.
 */
const onStaged = test.extend<{
  /** How GitHub answers as Lo starts. */
  answering: Answering;
  /** How GitHub answers now, which a test changes as it goes. */
  stage: { answering: Answering };
  account: boolean;
  /** How long Lo waits for an answer to begin, in milliseconds, in place of 15 s, where a test says. */
  answerStart: number | undefined;
}>({
  answering: ['recorded', { option: true }],
  account: [true, { option: true }],
  answerStart: [undefined, { option: true }],
  stage: async ({ answering }, use) => {
    await use({ answering });
  },
  launch: async ({ github, remote, tokenFile, stage, account, answerStart }, use) => {
    const origin = new URL(github.urls.api).origin;
    const held = new Set<Socket>();
    const front = createHttpServer((incoming, outgoing) => {
      void (async () => {
        const body = await buffer(incoming);
        const { answering } = stage;
        if (answering === 'silent') {
          held.add(incoming.socket);
          return;
        }
        const path = new URL(incoming.url ?? '/', origin).pathname;
        const own = answering === 'recorded' ? undefined : staged(answering, path);
        if (own) {
          outgoing.writeHead(own.status, own.headers);
          outgoing.end(own.body);
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string' && name !== 'host') headers.set(name, value);
        }
        const method = incoming.method ?? 'GET';
        const response = await fetch(`${origin}${incoming.url ?? '/'}`, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
          redirect: 'manual',
        });
        const out: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name)) {
            out[name] = value;
          }
        });
        outgoing.writeHead(response.status, out);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      })().catch(() => {
        // The test has ended, and the replay server with it: the request goes unanswered.
        outgoing.destroy();
      });
    });
    await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
    const address = front.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: `http://127.0.0.1:${address.port}`,
        ...(account ? { LO_TEST_TOKEN_FILE: tokenFile } : {}),
        LO_GIT_REMOTE: remote,
        LO_OFFLINE_AFTER_MS: '1000',
        ...(answerStart === undefined ? {} : { LO_ANSWER_START_MS: String(answerStart) }),
      },
    });
    for (const socket of held) socket.destroy();
    front.closeAllConnections();
    await new Promise((resolve) => front.close(resolve));
  },
});

/** Opens `pull`'s tab, as whoever can open it, and returns its id. */
async function openAs(page: Page, pull: Opening): Promise<string> {
  const reply = await page.evaluate(
    (input) => window.lo.invoke('tab.open', { kind: 'pull', ...input }),
    pull,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

onStaged.describe('opened with nobody signed in, while the rate limit is used up', () => {
  onStaged.use({ account: false, answering: 'limited' });

  onStaged(
    'says why in place of its view, with when the limit resets, and offers a sign-in',
    async ({ page }) => {
      await openAs(page, E2E);
      const failed = page.locator('[data-lo-failed]');
      const why = failed.getByRole('alert').filter({ hasText: 'Can’t open #80' });
      await expect(why).toContainText('GitHub’s rate limit resets at', { timeout: 20_000 });
      // Nothing to try until it resets, but signing in reads past it, under the account's own limit.
      await expect(failed.getByRole('button', { name: /^Try/ })).toHaveCount(0);
      const signIn = failed.getByRole('button', { name: 'Sign in with GitHub…' });
      await expect(signIn).toBeVisible();
      // The problem says the limit, once: no chip in the header, and nothing around the view waits.
      const header = page.locator('[data-lo-pull] header');
      await expect(header.getByRole('button', { name: /^Rate limit/ })).toHaveCount(0);
      await expect(header.locator('.skeleton')).toHaveCount(0);
      await expect(page.getByText('Opening pull request…')).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Files' })).toHaveAttribute('inert', '');
      await signIn.click();
      await expect(page.getByTestId('sign-in')).toBeVisible();
    },
  );
});

onStaged.describe('opened while GitHub refuses the account’s token', () => {
  onStaged.use({ answering: 'refused' });

  onStaged(
    'says the account is signed out in place of its view, with Sign in again',
    async ({ page }) => {
      await open(page, E2E);
      const failed = page.locator('[data-lo-failed]');
      const why = failed.getByRole('alert').filter({ hasText: 'Can’t open #80' });
      await expect(why).toContainText('rozed-bot is signed out.', { timeout: 20_000 });
      await expect(failed.getByRole('button', { name: 'Sign in again' })).toBeVisible();
      await expect(page.getByText('Opening pull request…')).toHaveCount(0);
    },
  );
});

onStaged.describe('opened with nobody signed in, then GitHub takes reads and never answers', () => {
  // A request GitHub never answers is given up on once its answer hasn't begun: after 3 s here, in
  // place of 15 s.
  onStaged.use({ account: false, answerStart: 3_000 });

  onStaged(
    'says “No response” in the header’s chip, not “Offline”, and the view stays',
    async ({ page, stage }) => {
      const id = await openAs(page, E2E);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);

      stage.answering = 'silent';
      await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
      const header = page.locator('header').first();
      const chip = header.getByRole('button', { name: 'No response' });
      await expect(chip).toBeVisible({ timeout: 15_000 });
      await expect(header.getByRole('button', { name: 'Offline' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
      await chip.click();
      const details = page.getByRole('dialog');
      await expect(details).toContainText('GitHub didn’t respond.');
      await expect(details).not.toContainText('Offline');
    },
  );
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
    const shown = await drawnWindow(again);
    await expect(shown.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    // The header's chip says it, once, and its details say when Lo last heard from GitHub.
    const chip = shown.locator('header').first().getByRole('button', { name: 'Offline' });
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(tabBanners(shown)).toHaveCount(0);
    await chip.click();
    const details = shown.getByRole('dialog');
    await expect(details).toContainText('Offline.');
    await expect(details).toContainText(/Checked (just now|\d+ (min|h) ago)/);
    await expect(details.getByRole('button', { name: /^Try (now|again)$/ })).toBeVisible();
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
    const page = await drawnWindow(app);
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
    await expect(
      page.getByRole('status').filter({ hasText: 'Opening pull request…' }),
    ).toBeVisible();
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
