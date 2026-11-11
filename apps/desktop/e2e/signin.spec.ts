// Signing in and importing accounts in the app: GitHub's device flow on the replay server, a stand-in
// gh, and a system with no keychain Lo keeps tokens with. The token never reaches the window, a
// file in the clear, or another process's arguments.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, browsed, dataFolder, expect, test as base } from './app.ts';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

/**
 * Chromium's stand-ins for the system's keychain, so tests never touch a real one: the Mac's
 * stand-in keychain, and Linux's fallback store. Lo takes either only in a test run.
 */
const KEYCHAIN = mac ? ['--use-mock-keychain'] : ['--password-store=basic'];

/** The stand-in tokens the cassettes and the stand-in gh hand over, never real ones. */
const SIGNED_IN = 'gho_FAKE_SIGNED_IN';
const REFRESH = 'ghr_FAKE_SIGNED_IN';
const FROM_GH = 'gho_FAKE_FROM_GH';

const test = base.extend<{ cassette: string; github: ReplayServer }>({
  /** The cassette the test's GitHub replays. */
  cassette: ['device_flow_success', { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  launch: async ({ github }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: new URL(github.urls.api).origin },
    });
  },
});

/** The rows of `sql` in Lo's database. */
function rows(sql: string): Record<string, unknown>[] {
  const database = new DatabaseSync(join(dataFolder(), 'lo.db'), { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

/** Opens Settings by its key, from the middle of the window. */
async function openSettings(page: Page): Promise<void> {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press(`${cmd}+Comma`);
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
}

/** The polls a sign-in sent the replay server. */
function polls(github: ReplayServer): number {
  return github.replay.seen.filter(({ url }) => url.endsWith('/login/oauth/access_token')).length;
}

/** Fails if `secret` is in any file in the data folder, or in any process's arguments. */
function nowhereInTheClear(secret: string): void {
  for (const file of readdirSync(dataFolder(), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name);
    expect(readFileSync(path).includes(secret), path).toBe(false);
  }
  expect(execFileSync('ps', ['-A', '-ww', '-o', 'args='], { encoding: 'utf8' })).not.toContain(
    secret,
  );
}

test('signs in with GitHub: the code, GitHub’s page, and the account, never its token', async ({
  app,
  page,
  github,
}) => {
  // Three polls, 6 s apart.
  test.setTimeout(60_000);
  await openSettings(page);
  await page.getByRole('button', { name: 'Add an account' }).click();
  const dialog = page.getByTestId('sign-in');
  await expect(dialog.getByRole('img', { name: 'Code F A K E - 1 2 3 4' })).toBeVisible();
  const origin = new URL(github.urls.api).origin;
  await expect(dialog).toContainText(
    `Enter this code at ${origin.slice('http://'.length)}/web/login/device`,
  );
  await expect(dialog.getByRole('button', { name: /Copy and open GitHub/ })).toBeFocused();

  // `⏎` copies the code and opens GitHub's page for codes, and only that page.
  await page.keyboard.press('Enter');
  await expect.poll(browsed).toEqual([`${origin}/web/login/device`]);
  await expect(dialog).toContainText('Copied FAKE-1234.');
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('FAKE-1234');
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  // `y y` copies it again.
  await page.keyboard.press('y');
  await page.keyboard.press('y');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('FAKE-1234');

  await expect(dialog).toContainText('Signed in as rozed-bot', { timeout: 30_000 });
  expect(polls(github)).toBe(3);
  await expect(dialog.getByRole('button', { name: /Done/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  // Settings lists it, signed in.
  const listed = page.getByRole('list', { name: 'Accounts' }).getByRole('listitem');
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText('rozed-bot');
  await expect(listed).toContainText('Signed in');
  await expect(listed).toContainText('signed in with GitHub');

  // The window has its summary, and nothing of its tokens.
  const reply = await page.evaluate(() => window.lo.invoke('accounts.list'));
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
  const html = await page.content();
  for (const secret of [SIGNED_IN, REFRESH, 'FAKE-DEVICE-CODE']) {
    expect(html).not.toContain(secret);
  }
  // Kept encrypted, the refresh token with it.
  const [grant] = rows("SELECT sealed FROM accounts_grants WHERE login = 'rozed-bot'");
  const sealed = grant?.['sealed'];
  if (!(sealed instanceof Uint8Array)) throw new Error('rozed-bot has no grant');
  const opened = await app.evaluate(
    ({ safeStorage }, base64) => safeStorage.decryptStringAsync(Buffer.from(base64, 'base64')),
    Buffer.from(sealed).toString('base64'),
  );
  expect(JSON.parse(opened.result)).toMatchObject({
    token: SIGNED_IN,
    refresh: { token: REFRESH },
  });
  nowhereInTheClear(SIGNED_IN);
  nowhereInTheClear(REFRESH);
});

test.describe('a sign-in that is cancelled', () => {
  // A code that lasts 20 s, never entered.
  test.use({ cassette: 'device_flow_deadline' });

  test('stops polling GitHub once its dialog closes', async ({ page, github }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Add an account' }).click();
    const dialog = page.getByTestId('sign-in');
    await expect(dialog).toContainText('Waiting for you to approve.');
    // The first poll, 6 s in.
    await expect.poll(() => polls(github), { timeout: 10_000 }).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // The next would have gone 6 s after the first.
    await page.waitForTimeout(8_000);
    expect(polls(github)).toBe(1);
    expect(rows('SELECT login FROM accounts_accounts')).toEqual([]);
  });
});

test.describe('a system with no keychain Lo keeps tokens with', () => {
  // Outside a test run, Chromium's stand-in keychain and Linux's fallback key count as none, so
  // Lo starts with no GitHub of its own: it must refuse before asking GitHub anything.
  test.use({ launch: { args: [appFolder, ...KEYCHAIN] } });

  test('refuses to sign in or import before asking GitHub, and says what to do', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Add an account' }).click();
    const dialog = page.getByTestId('sign-in');
    await expect(dialog).toContainText("Lo can't keep your token safely");
    // Playwright starts Electron with Chromium's stand-in keychain on every system, which Lo
    // names first; without it, Linux's fallback key would be refused for want of a keyring.
    await expect(dialog.getByRole('alert')).toContainText(
      /stand-in keychain|GNOME Keyring or KWallet/,
    );
    await expect(dialog.getByRole('button', { name: /Quit Lo/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Import from gh' }).click();
    const importing = page.getByTestId('import-gh');
    await expect(importing).toContainText("Lo can't keep your tokens safely");
    expect(
      await page.evaluate(() => window.lo.invoke('accounts.importGh', { logins: ['rozed-bot'] })),
    ).toMatchObject({ ok: false, error: { code: 'noKeyring' } });
  });
});

/**
 * A stand-in gh in `folder` that lists two accounts and prints their stand-in tokens, and fails if
 * its environment holds a token.
 */
function fakeGh(folder: string): string {
  const program = join(folder, 'gh');
  writeFileSync(
    join(folder, 'status.json'),
    JSON.stringify({
      hosts: {
        'github.com': [
          {
            state: 'success',
            active: true,
            host: 'github.com',
            login: 'rozed-bot',
            tokenSource: 'keyring',
            scopes: 'read:org, repo, workflow',
          },
          {
            state: 'success',
            active: false,
            host: 'github.com',
            login: 'someone-else',
            tokenSource: 'keyring',
            scopes: 'gist, read:org, repo',
          },
        ],
      },
    }),
  );
  writeFileSync(
    program,
    `#!/bin/sh
if [ -n "\${GH_TOKEN+set}" ] || [ -n "\${GITHUB_TOKEN+set}" ]; then
  echo "a token is set in gh's environment" >&2
  exit 3
fi
case "$*" in
  "--version") echo "gh version 2.103.3 (2026-10-26)" ;;
  "auth status --json hosts --hostname github.com") cat "$(dirname "$0")/status.json" ;;
  "auth token --hostname github.com --user=rozed-bot") echo "${FROM_GH}" ;;
  "auth token --hostname github.com --user=someone-else") echo "gho_FAKE_SOMEONE_ELSE" ;;
  *) echo "no oauth token found for github.com" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(program, 0o755);
  return program;
}

test.describe('importing from gh', () => {
  // GitHub says whichever token it's given is rozed-bot's.
  test.use({ cassette: 'user' });
  test.use({
    launch: async ({ github }, use) => {
      // In a folder only this user can change, as Lo runs no other gh.
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-gh-')));
      const gh = fakeGh(folder);
      await use({
        args: [appFolder, ...KEYCHAIN],
        env: {
          LO_GITHUB: new URL(github.urls.api).origin,
          LO_GH: gh,
          // Never handed on to gh, which would fail.
          GH_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
          GITHUB_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
        },
      });
      rmSync(folder, { recursive: true, force: true });
    },
  });

  test("imports gh's accounts once GitHub says whose each token is", async ({ page, github }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Import from gh' }).click();
    const dialog = page.getByTestId('import-gh');
    await expect(dialog).toContainText('gh 2.103.3 at');
    await expect(dialog).toContainText('is signed in to 2 accounts');
    const bot = dialog.getByRole('switch', { name: 'Import rozed-bot' });
    const other = dialog.getByRole('switch', { name: 'Import someone-else' });
    await expect(bot).toBeChecked();
    await expect(other).toBeChecked();
    await expect(dialog).toContainText(
      "someone-else's token can't merge PRs that change workflows.",
    );
    await expect(dialog.getByRole('button', { name: /Import 2 accounts/ })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog).toContainText('Imported 1 account');
    await expect(dialog.getByRole('alert')).toContainText(
      "someone-else: gh's token for someone-else is rozed-bot's.",
    );
    await expect(dialog.getByRole('button', { name: /Done/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    const listed = page.getByRole('list', { name: 'Accounts' }).getByRole('listitem');
    await expect(listed).toHaveCount(1);
    await expect(listed).toContainText('imported from gh');
    // Each token went to GitHub's API only.
    expect(github.replay.seen.map(({ url }) => new URL(url).pathname)).toEqual(['/user', '/user']);
    expect(await page.content()).not.toContain(FROM_GH);
    nowhereInTheClear(FROM_GH);
    expect(rows('SELECT login, source FROM accounts_accounts')).toEqual([
      { login: 'rozed-bot', source: 'gh' },
    ]);
  });
});
