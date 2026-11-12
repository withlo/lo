// Accounts in the app: Lo started on the replay server with a token in LO_TEST_TOKEN_FILE adds
// its account as it starts, keeps its token encrypted by Electron's safeStorage, and gives the
// window the account's summary and never its token.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, test as base } from './app.ts';

/** A stand-in token, never a real one. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/**
 * Chromium's stand-ins for the system's keychain, so tests never touch a real one: the Mac's
 * stand-in keychain, and Linux's fallback store. Lo takes either only in a test run.
 */
const KEYCHAIN =
  process.platform === 'darwin' ? ['--use-mock-keychain'] : ['--password-store=basic'];

const test = base.extend<{ github: ReplayServer; tokenFile: string }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('user');
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  tokenFile: async ({}, use) => {
    const file = test.info().outputPath('token');
    writeFileSync(file, `${TOKEN}\n`);
    await use(file);
  },
  launch: async ({ github, tokenFile }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: new URL(github.urls.api).origin, LO_TEST_TOKEN_FILE: tokenFile },
    });
  },
});

function rows(sql: string): Record<string, unknown>[] {
  const database = new DatabaseSync(join(dataFolder(), 'lo.db'), { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

/** The grant Lo keeps for rozed-bot, as it's stored. */
function sealedGrant(): Buffer {
  const [grant] = rows("SELECT sealed FROM accounts_grants WHERE login = 'rozed-bot'");
  const sealed = grant?.['sealed'];
  if (!(sealed instanceof Uint8Array)) throw new Error('rozed-bot has no grant');
  return Buffer.from(sealed);
}

/** Lo's accounts, as the window lists them once the one from the token file is in. */
async function listed(page: Page): Promise<unknown> {
  let reply: unknown;
  await expect
    .poll(async () => {
      reply = await page.evaluate(() => window.lo.invoke('accounts.list'));
      return JSON.stringify(reply).includes('rozed-bot');
    })
    .toBe(true);
  return reply;
}

test('the account in the token file is added as Lo starts, and the window gets only its summary', async ({
  page,
}) => {
  const reply = await listed(page);
  expect(reply).toEqual({
    ok: true,
    value: [
      {
        login: 'rozed-bot',
        name: null,
        source: 'deviceFlow',
        signedOut: null,
        cantSave: false,
        needsKeyring: false,
      },
    ],
  });
  expect(JSON.stringify(reply)).not.toContain(TOKEN);
  expect(rows('SELECT login FROM accounts_accounts')).toEqual([{ login: 'rozed-bot' }]);
});

test('the token is kept encrypted by safeStorage, and is never in a file or argv in the clear', async ({
  app,
  page,
}) => {
  await listed(page);
  expect(rows('SELECT login FROM accounts_grants')).toEqual([{ login: 'rozed-bot' }]);
  const sealed = sealedGrant();
  expect(sealed.includes(TOKEN)).toBe(false);
  for (const file of readdirSync(dataFolder(), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name);
    expect(readFileSync(path).includes(TOKEN), path).toBe(false);
  }
  // No process Lo runs has the token in its arguments.
  expect(execFileSync('ps', ['-A', '-ww', '-o', 'args='], { encoding: 'utf8' })).not.toContain(
    TOKEN,
  );

  // What Lo stored is safeStorage's own ciphertext, of the whole grant, for the GitHub it's for.
  const opened = await app.evaluate(
    ({ safeStorage }, base64) => safeStorage.decryptStringAsync(Buffer.from(base64, 'base64')),
    sealed.toString('base64'),
  );
  expect(JSON.parse(opened.result)).toEqual({
    github: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/api$/),
    token: TOKEN,
  });
});

test('the account stays across a restart, and removing it removes its token', async ({
  app,
  page,
  github,
}) => {
  await listed(page);
  const sealed = sealedGrant().toString('base64');
  await app.close();

  // Started again without the token file, Lo still has the account, and its grant still decrypts.
  const again: ElectronApplication = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: { ...appEnvironment(dataFolder()), LO_GITHUB: new URL(github.urls.api).origin },
    chromiumSandbox: true,
  });
  try {
    const shown = await again.firstWindow();
    await shown.waitForLoadState('load');
    await listed(shown);
    const opened = await again.evaluate(
      ({ safeStorage }, base64) => safeStorage.decryptStringAsync(Buffer.from(base64, 'base64')),
      sealed,
    );
    expect(JSON.parse(opened.result)).toMatchObject({ token: TOKEN });

    const pushed = shown.evaluate(
      () =>
        new Promise((resolve) => {
          const stop = window.lo.subscribe('accounts.accounts', (accounts) => {
            stop();
            resolve(accounts);
          });
        }),
    );
    expect(
      await shown.evaluate(() => window.lo.invoke('accounts.remove', { login: 'ROZED-BOT' })),
    ).toEqual({ ok: true, value: undefined });
    expect(await pushed).toEqual([]);
    expect(rows('SELECT count(*) AS n FROM accounts_grants')).toEqual([{ n: 0 }]);
    expect(rows('SELECT count(*) AS n FROM accounts_accounts')).toEqual([{ n: 0 }]);
    expect(
      await shown.evaluate(() => window.lo.invoke('accounts.remove', { login: 'rozed-bot' })),
    ).toEqual({
      ok: false,
      error: { code: 'missing', message: "Lo isn't signed in to rozed-bot." },
    });
  } finally {
    await again.close();
  }
});

test('Sign out… in the palette asks first, then removes the account and its token', async ({
  page,
}) => {
  await listed(page);
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+KeyP`);
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.type('Sign out');
  await page.keyboard.press('Enter');
  // One account: the dialog says what happens, with nothing done yet, and `⏎` does it.
  const dialog = page.getByTestId('sign-out');
  await expect(dialog).toContainText('Sign out of rozed-bot?');
  expect(rows('SELECT count(*) AS n FROM accounts_grants')).toEqual([{ n: 1 }]);
  await expect(dialog.getByRole('button', { name: /^Sign out/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(() => rows('SELECT count(*) AS n FROM accounts_accounts')).toEqual([{ n: 0 }]);
  expect(rows('SELECT count(*) AS n FROM accounts_grants')).toEqual([{ n: 0 }]);
});

test('the app menu has Add an account and Sign out…', async ({ app, page }) => {
  test.skip(process.platform !== 'darwin', 'The app menu is the Mac’s.');
  await listed(page);
  const labels = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items[0]?.submenu?.items ?? []).map((item) => item.label),
  );
  expect(labels).toContain('Add an account');
  expect(labels).toContain('Sign out…');
});

test("Linux's fallback encrypts with the built-in key, marked v10, which Lo takes only in a test run", async ({
  app,
  page,
}) => {
  test.skip(process.platform !== 'linux', "Only Linux has safeStorage's fallback store.");
  await listed(page);
  const backend = await app.evaluate(async ({ safeStorage }) => {
    await safeStorage.isAsyncEncryptionAvailable();
    return safeStorage.getSelectedStorageBackend();
  });
  expect(backend).toBe('basic_text');
  // What it encrypted is marked as the built-in key's, which is what Lo goes by.
  expect(sealedGrant().subarray(0, 3).toString()).toBe('v10');
});

test('a build run from source goes by Lo Dev, so its keychain key is its own', async ({ app }) => {
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe('Lo Dev');
});

test("Lo follows GitHub's redirect itself, sending the token only to GitHub's API", async () => {
  // A GitHub on this machine whose `/user` has moved, as a renamed repository's address does.
  const asked: { path: string; token: boolean; cookie: boolean }[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    asked.push({
      path,
      token: request.headers.authorization === `token ${TOKEN}`,
      cookie: request.headers.cookie !== undefined,
    });
    if (path === '/api/user') {
      response.writeHead(301, { location: '/api/user/moved', 'set-cookie': 'kept=no' });
      response.end();
    } else if (path === '/api/user/moved') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'x-oauth-scopes': 'read:org, repo, workflow',
      });
      response.end(JSON.stringify({ login: 'rozed-bot', id: 353226052, name: null }));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  const file = test.info().outputPath('token');
  writeFileSync(file, TOKEN);

  const app = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: `http://127.0.0.1:${address.port}`,
      LO_TEST_TOKEN_FILE: file,
    },
    chromiumSandbox: true,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('load');
    await listed(page);
    expect(asked).toEqual([
      { path: '/api/user', token: true, cookie: false },
      { path: '/api/user/moved', token: true, cookie: false },
    ]);
  } finally {
    await app.close();
    server.close();
  }
});
