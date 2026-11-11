// The welcome screen in the app: it covers the Recent tab on a first launch, signs in with `⏎`,
// imports accounts from gh, opens a public pull request without an account, looks for git again,
// installs the `lo` command and shows the rules for link routers.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitProgram, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, browsed, expect, KEYCHAIN, test as base } from './app.ts';

const TITLE = "App: the pull request Lo's end-to-end tests open";
const E2E = 'https://github.com/rozed-dev/e2e/pull/78';
const DOCS = 'https://github.com/withlo/lo/blob/main/docs/link-routers.md';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const test = base.extend<{ github: ReplayServer; cassette: string }>({
  cassette: ['app_e2e', { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  launch: async ({ github }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
        LO_COMMAND_FOLDER: test.info().outputPath('bin'),
      },
    });
  },
});

const welcome = (page: Page) => page.locator('[data-lo-scope="welcome"]');
const signIn = (page: Page) => welcome(page).getByRole('button', { name: /^Sign in with GitHub/ });
const recent = (page: Page) => page.getByRole('listbox', { name: 'Recent pull requests' });
/** The screen's headline: Recent, under it, has a heading of its own, out of reach of readers. */
const heading = (page: Page) => welcome(page).getByRole('heading', { level: 1 });
/** A pull request's title. */
const title = (page: Page) => page.getByRole('heading', { level: 1 });
const linkField = (page: Page) => welcome(page).getByRole('textbox', { name: 'Pull request link' });

/** One of gh's accounts on github.com, as `gh auth status` lists it. */
const account = (login: string, active: boolean) => ({
  state: 'success',
  active,
  host: 'github.com',
  login,
  tokenSource: 'keyring',
  scopes: 'read:org, repo, workflow',
});

/** An executable shell script at `path`. */
function script(path: string, lines: readonly string[]): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
  return path;
}

test('a first launch shows the welcome screen over Recent, with sign-in ready', async ({
  page,
}) => {
  await expect(heading(page)).toHaveText('Review pull requests from the keyboard.');
  await expect(welcome(page).getByRole('img', { name: 'Lo' })).toBeVisible();
  await expect(welcome(page)).toContainText(
    'Lo reads whole stacks, shows the overviews your coding agent writes, and has a key for every action.',
  );
  // The default action has focus and shows its key.
  await expect(signIn(page)).toBeFocused();
  await expect(signIn(page)).toContainText('⏎');
  await expect(welcome(page).getByText('or open a public PR without signing in')).toBeVisible();
  await expect(welcome(page).getByRole('list', { name: 'Optional steps' })).toContainText(
    'Send PR links to Lo',
  );
  // With no gh and a git found, there is nothing to import and nothing to warn of.
  await expect(welcome(page).getByRole('button', { name: 'Import from gh' })).toHaveCount(0);
  await expect(welcome(page).getByRole('button', { name: 'Check again' })).toHaveCount(0);
  // The strip is still there, and Recent is under the screen, out of reach of keys and readers.
  await expect(page.getByRole('tab', { name: 'Recent pull requests' })).toBeVisible();
  expect(await recent(page).evaluate((list) => list.closest('[inert]') !== null)).toBe(true);
  await expect(recent(page)).not.toBeFocused();
  // Esc gives focus back to the screen, not to the list under it.
  await linkField(page).focus();
  await page.keyboard.press('Escape');
  await expect(signIn(page)).toBeFocused();
});

test.describe('signing in', () => {
  test.use({ cassette: 'device_flow_success' });

  test('⏎ starts the device flow, and Esc stops it', async ({ page }) => {
    await expect(signIn(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('sign-in');
    await expect(dialog.getByRole('img', { name: 'Code F A K E - 1 2 3 4' })).toBeVisible();
    // Focus moves into the dialog a moment after it shows; Esc is the dialog's once it has.
    await expect(dialog.getByRole('button', { name: /Copy and open GitHub/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(signIn(page)).toBeFocused();
    // The button does the same.
    await signIn(page).click();
    await expect(dialog).toBeVisible();
  });
});

test('⏎ with focus on another control does what that control does', async ({ page }) => {
  // `Tab` walks the screen's controls, as it does Settings' fields: the field is next.
  await expect(signIn(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(linkField(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(welcome(page).getByRole('button', { name: 'Open' })).toBeDisabled();
  // Typing a link and pressing ⏎ opens it, where ⏎ would otherwise sign in.
  await linkField(page).fill('owner/repo#1');
  await page.keyboard.press('Enter');
  await expect(welcome(page).getByRole('alert')).toContainText('Lo opens links to pull requests');
  await expect(page.getByTestId('sign-in')).toHaveCount(0);
});

test('a link that is not a pull request goes where the open box sends it', async ({ page }) => {
  await linkField(page).fill('https://github.com/rozed-dev/e2e/issues/12');
  await welcome(page).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(browsed).toEqual(['https://github.com/rozed-dev/e2e/issues/12']);
});

test('opens a public pull request without signing in, and returns when it closes', async ({
  page,
}) => {
  await linkField(page).fill(E2E);
  await welcome(page).getByRole('button', { name: 'Open', exact: true }).click();

  await expect(title(page)).toHaveText(TITLE);
  const header = page.locator('header').first();
  await expect(header).toContainText('Not signed in');
  await expect(header).toContainText('Read only');
  // The screen covers Recent only: a pull request is drawn as it is.
  await expect(welcome(page)).toHaveCount(0);

  await page.keyboard.press(`${cmd}+W`);
  await expect(welcome(page)).toBeVisible();
  await expect(signIn(page)).toBeFocused();
  // And with ⏎ in the field, it opens the same way.
  await linkField(page).fill(E2E);
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText(TITLE);
  expect(await page.evaluate(() => window.lo.invoke('open.recent'))).toEqual({
    ok: true,
    value: [],
  });
});

test.describe('with gh', () => {
  test.use({ cassette: 'user' });
  test.use({
    launch: async ({ github }, use) => {
      // In a folder only this user can change, as Lo runs no other gh.
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-gh-')));
      const status = JSON.stringify({
        hosts: { 'github.com': [account('rozed-bot', true), account('someone-else', false)] },
      });
      const gh = script(join(folder, 'gh'), [
        'case "$*" in',
        '  "--version") echo "gh version 2.103.3 (2026-10-26)" ;;',
        `  "auth status --json hosts --hostname github.com") echo '${status}' ;;`,
        '  "auth token --hostname github.com --user=rozed-bot") echo "gho_FAKE_FROM_GH" ;;',
        '  *) echo "no oauth token found for github.com" >&2; exit 1 ;;',
        'esac',
      ]);
      await use({
        args: [appFolder, ...KEYCHAIN],
        env: { LO_GITHUB: new URL(github.urls.api).origin, LO_GH: gh },
      });
      rmSync(folder, { recursive: true, force: true });
    },
  });

  test('offers to import its accounts with their count, and leaves for Recent once one is in', async ({
    page,
  }) => {
    const importing = welcome(page).getByRole('button', { name: 'Import from gh' });
    await expect(importing).toBeVisible();
    await expect(welcome(page)).toContainText('gh 2.103.3 is signed in to 2 accounts');

    // ⏎ with focus on it opens the import, and doesn't sign in.
    await importing.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('import-gh');
    await expect(dialog).toContainText('is signed in to 2 accounts');
    await expect(page.getByTestId('sign-in')).toHaveCount(0);
    await dialog.getByRole('button', { name: /^Import 2 accounts/ }).click();
    await expect(dialog).toContainText('Imported 1 account');
    await dialog.getByRole('button', { name: /Done/ }).click();
    await expect(dialog).toBeHidden();

    // With an account signed in, the screen is gone and Recent is what is under it.
    await expect(welcome(page)).toHaveCount(0);
    await expect(recent(page)).toBeVisible();
    await expect(recent(page)).toBeFocused();
    expect(await recent(page).evaluate((list) => list.closest('[inert]') !== null)).toBe(false);
  });
});

test.describe('with a git too old', () => {
  let marker = '';
  test.use({
    launch: async ({ github }, use) => {
      marker = test.info().outputPath('git-installed');
      // Too old until the marker is there, then the test's own git.
      const program = script(test.info().outputPath('git', 'git'), [
        `if [ -e '${marker}' ]; then exec '${gitProgram()}' "$@"; fi`,
        "echo 'git version 2.30.0'",
      ]);
      await use({
        args: [appFolder, ...KEYCHAIN],
        env: { LO_GITHUB: new URL(github.urls.api).origin, LO_GIT: program },
      });
    },
  });

  test('says what Lo needs, and "Check again" finds git without restarting', async ({ page }) => {
    const notice = welcome(page).getByText(/Lo needs git 2\.41\.0 or newer/);
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const again = welcome(page).getByRole('button', { name: 'Check again' });

    // Nothing has changed: it says it looked.
    await again.click();
    await expect(welcome(page).getByRole('status')).toContainText(
      'Lo looked again and still can’t find a git it can use.',
    );
    await expect(notice).toBeVisible();

    // Once git is there, it is found, and the notice goes.
    writeFileSync(marker, '');
    await again.click();
    await expect(notice).toHaveCount(0);
    await expect(again).toHaveCount(0);
    expect(existsSync(marker)).toBe(true);
    const info = await page.evaluate(() => window.lo.invoke('app.info'));
    expect(info).toMatchObject({ ok: true, value: { git: { status: 'found' } } });
  });
});

test.describe('with no git', () => {
  test.use({
    launch: async ({ github }, use) => {
      await use({
        args: [appFolder, ...KEYCHAIN],
        env: { LO_GITHUB: new URL(github.urls.api).origin, LO_GIT: 'none' },
      });
    },
  });

  test('says how to install it', async ({ page }) => {
    await expect(welcome(page)).toContainText("Lo can't find git.", { timeout: 15_000 });
    await expect(welcome(page).getByRole('button', { name: 'Check again' })).toBeEnabled();
  });
});

test('installs the lo command from the screen', async ({ page }) => {
  await welcome(page).getByRole('button', { name: 'Install', exact: true }).click();
  await expect(welcome(page).getByRole('button', { name: 'Installed' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Installed' })).toBeVisible();
});

test('"Send PR links to Lo" opens the rules for Finicky, Velja and Choosy to copy', async ({
  page,
}) => {
  await welcome(page).getByRole('button', { name: 'Set up' }).click();
  const dialog = page.getByTestId('link-rules');
  await expect(dialog.getByRole('heading', { name: 'Send PR links to Lo' })).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
    'Finicky',
    'Velja',
    'Choosy',
  ]);
  await expect(dialog).toContainText('~/.finicky.js');
  await expect(dialog.getByRole('button', { name: /Done/ })).toBeFocused();

  // ⏎ is Done, and focus goes back to "Set up".
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(welcome(page).getByRole('button', { name: 'Set up' })).toBeFocused();
});

test('the rules link to the docs, which open in the browser', async ({ page }) => {
  await welcome(page).getByRole('button', { name: 'Set up' }).click();
  await page.getByTestId('link-rules').getByRole('button', { name: 'Read the docs' }).click();
  await expect.poll(browsed).toEqual([DOCS]);
});

test('copies a router’s rule to the clipboard', async ({ app, page }) => {
  // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
  test.skip(mac, "The Mac's clipboard is its user's.");
  await welcome(page).getByRole('button', { name: 'Set up' }).click();
  const dialog = page.getByTestId('link-rules');
  await dialog.getByRole('button', { name: 'Copy the rule for Finicky' }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('browser: "Lo"');
  await dialog.getByRole('button', { name: 'Copy the rule for Choosy' }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('/pull/');
});
