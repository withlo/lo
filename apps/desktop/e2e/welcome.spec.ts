// The welcome in the app: it covers the Recent tab on a first launch and is walked by key and by
// mouse through its four steps, signing in, choosing keys, setting up and opening a pull request.
// Once finished it opens again from the Help menu and the command palette.

import {
  chmodSync,
  existsSync,
  readFileSync,
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
import type { ElectronApplication, Page } from '@playwright/test';

import {
  appFolder,
  browsed,
  dataFolder,
  expect,
  KEYCHAIN,
  middleOf,
  settingsPath,
  test as base,
} from './app.ts';

const TITLE = "App: the pull request Lo's end-to-end tests open";
const E2E = 'https://github.com/rozed-dev/e2e/pull/80';
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
/** The step on screen: the others keep their room, out of reach. */
const step = (page: Page) => welcome(page).locator('[data-welcome-step]:not([inert])');
const signIn = (page: Page) => welcome(page).getByRole('button', { name: /^Sign in with GitHub/ });
const go = (page: Page) => welcome(page).getByRole('button', { name: /^Continue/ });
const done = (page: Page) => welcome(page).getByRole('button', { name: /^Done/ });
/** The step's heading: what's under the welcome has headings of its own, out of reach. */
const heading = (page: Page) => step(page).getByRole('heading', { level: 1 });
/** A pull request's title. */
const title = (page: Page) => page.getByRole('heading', { level: 1 });
const linkField = (page: Page) => welcome(page).getByRole('textbox', { name: 'Pull request link' });
const practice = (page: Page) => welcome(page).getByRole('listbox', { name: 'Practice diff' });
const chosen = (page: Page) => practice(page).locator('[role="option"][aria-selected="true"]');

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

/** Runs "Welcome to Lo" from the command palette. */
async function showFromPalette(page: Page): Promise<void> {
  await page.keyboard.press(`${cmd}+Shift+P`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Welcome to Lo');
  await expect(palette.getByRole('option').first()).toContainText('Welcome to Lo');
  await page.keyboard.press('Enter');
}

/** Runs "Welcome to Lo" from the Help menu, which the app menu has on macOS. */
async function showFromMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const event = {
      triggeredByAccelerator: false,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    };
    Menu.getApplicationMenu()
      ?.getMenuItemById('welcome.show')
      ?.click(event, window, window?.webContents);
  });
}

test('a first launch shows the welcome over Recent, and its four steps are walked by key and by mouse', async ({
  page,
}) => {
  await test.step('the first step is over Recent, with sign-in ready', async () => {
    await expect(heading(page)).toHaveText('Review pull requests from the keyboard');
    await expect(step(page)).toContainText('Every action has a key.');
    // The step's main button has focus and shows its key.
    await expect(signIn(page)).toBeFocused();
    await expect(signIn(page)).toContainText(mac ? '⏎' : 'Enter');
    // With no GitHub CLI and a Git found, there is nothing to import and nothing to warn of.
    await expect(welcome(page).getByRole('button', { name: /GitHub CLI/ })).toHaveCount(0);
    await expect(welcome(page).getByRole('button', { name: 'Check again' })).toHaveCount(0);
    // The strip is still there, and Recent is under the welcome, out of reach of keys and readers.
    await expect(page.getByRole('tab', { name: 'Recent pull requests' })).toBeVisible();
    expect(
      await welcome(page).evaluate((screen) =>
        [...(screen.parentElement?.children ?? [])].every(
          (each) => each === screen || each.hasAttribute('inert'),
        ),
      ),
    ).toBe(true);
    await expect(welcome(page).getByRole('button', { name: 'Back' })).toBeHidden();
  });

  await test.step('the keys step has a diff to practise on, and chooses Vim keys', async () => {
    await go(page).click();
    await expect(heading(page)).toHaveText('Choose your keys');
    await expect(step(page).getByRole('radio', { name: /^Standard/ })).toBeChecked();
    await expect(practice(page)).toBeFocused();
    const first = await chosen(page).textContent();
    await page.keyboard.press('j');
    await expect(chosen(page)).not.toHaveText(first ?? '');
    await page.keyboard.press('k');
    await expect(chosen(page)).toHaveText(first ?? '');
    // Each of the practice's keys is a button too, which the mouse presses.
    const hint = (name: string) => step(page).getByRole('button', { name, exact: true });
    await hint('Next line').click();
    await expect(chosen(page)).not.toHaveText(first ?? '');
    await hint('Previous line').click();
    await expect(chosen(page)).toHaveText(first ?? '');
    await hint('Comment').click();
    const box = step(page).getByRole('textbox', { name: 'Comment' });
    await expect(box).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await expect(practice(page)).toBeFocused();
    // `c` opens the comment box every comment is written in, which sends nothing; ⏎ in it isn't
    // Continue, and Esc closes it.
    await page.keyboard.press('c');
    await expect(box).toBeFocused();
    await page.keyboard.type('Looks right');
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('Choose your keys');
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
    await expect(practice(page)).toBeFocused();
    // Vim keys is the `editor.vim` setting, written to the settings file.
    await step(page)
      .getByRole('radio', { name: /^Vim keys/ })
      .click();
    await expect(step(page).getByRole('radio', { name: /^Vim keys/ })).toBeChecked();
    await expect
      .poll(() => {
        const path = settingsPath(dataFolder());
        return existsSync(path) ? readFileSync(path, 'utf8') : '';
      })
      .toMatch(/"editor\.vim":\s*true/);
  });

  await test.step('the set-up step installs the lo command', async () => {
    // ⏎ is Continue wherever focus is in the step, off a button.
    await practice(page).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('Use Lo with your other tools');
    const rows = step(page).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    const command = rows.filter({ hasText: 'Opens a pull request from a terminal' });
    await command.getByRole('button', { name: 'Install' }).click();
    await expect(command).toContainText('Installed');
    await expect(command.getByRole('button')).toHaveCount(0);
    expect(existsSync(join(test.info().outputPath('bin'), 'lo'))).toBe(true);
    // Back is a button, and the step is as it was left.
    await welcome(page).getByRole('button', { name: 'Back' }).click();
    await expect(heading(page)).toHaveText('Choose your keys');
    await go(page).click();
    await expect(command).toContainText('Installed');
  });

  await test.step('the last step ends on Recent, which says what to do next', async () => {
    await go(page).click();
    await expect(heading(page)).toHaveText('Open a pull request');
    await expect(linkField(page)).toBeFocused();
    await expect(welcome(page).getByRole('button', { name: 'Skip' })).toBeHidden();
    // With nothing in the field, ⏎ is Done.
    await expect(done(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(welcome(page)).toHaveCount(0);
    const recent = middleOf(page);
    await expect(recent.getByRole('heading', { name: 'No pull requests yet' })).toBeVisible();
    await expect(recent.getByRole('button', { name: /^Paste link/ })).toBeVisible();
    await expect(recent.getByRole('button', { name: /^Open pull request…/ }).first()).toBeVisible();
    expect(await page.evaluate(() => window.lo.invoke('welcome.state'))).toEqual({
      ok: true,
      value: { finished: true },
    });
  });

  await test.step('“Welcome to Lo” in the command palette opens it again, and Skip leaves it', async () => {
    await showFromPalette(page);
    await expect(heading(page)).toHaveText('Review pull requests from the keyboard');
    await expect(signIn(page)).toBeFocused();
    await welcome(page).getByRole('button', { name: 'Skip' }).click();
    await expect(welcome(page)).toHaveCount(0);
  });
});

test.describe('signing in', () => {
  test.use({ cassette: 'device_flow_success' });

  test('⏎ starts the device flow, Esc stops it, and the welcome stays once an account is in', async ({
    page,
  }) => {
    await expect(signIn(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('sign-in');
    await expect(dialog.getByRole('img', { name: 'Code F A K E - 1 2 3 4' })).toBeVisible();
    // Focus moves into the dialog a moment after it shows; Esc is the dialog's once it has.
    await expect(dialog.getByRole('button', { name: /Copy and open GitHub/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(signIn(page)).toBeFocused();

    // The button does the same. GitHub's first poll is 6 s in.
    await signIn(page).click();
    await expect(dialog).toContainText('Signed in as rozed-bot', { timeout: 20_000 });
    await dialog.getByRole('button', { name: /Done/ }).click();
    await expect(dialog).toBeHidden();
    // The step says who signed in where the button was, and Continue is its main button now.
    await expect(step(page)).toContainText('Signed in as rozed-bot');
    await expect(signIn(page)).toHaveCount(0);
    await expect(go(page)).toBeFocused();
    await expect(go(page)).toContainText(mac ? '⏎' : 'Enter');
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('Choose your keys');
  });
});

test('opens a public pull request without signing in, and opens again over it when asked', async ({
  app,
  page,
}) => {
  // A reader with no account goes straight to the last step.
  await welcome(page).getByRole('button', { name: 'Open public pull request…' }).click();
  await expect(heading(page)).toHaveText('Open a pull request');
  await expect(step(page).getByRole('list', { name: 'Sample pull request' })).toContainText(
    'withlo/lo#182',
  );
  await expect(
    step(page).getByRole('button', { name: 'Open', exact: true }).first(),
  ).toBeDisabled();
  // A link Lo doesn't open is refused by the field, and the welcome stays.
  await linkField(page).fill('owner/repo#1');
  await page.keyboard.press('Enter');
  await expect(step(page).getByRole('alert')).toContainText('Couldn’t open the link');
  await expect(step(page).getByRole('alert')).toContainText('A pull request link looks like');
  await expect(page.getByTestId('sign-in')).toHaveCount(0);

  // ⏎ in the field opens its link, and the pull request is what shows.
  await linkField(page).fill(E2E);
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveText(TITLE);
  const header = page.locator('header').first();
  await expect(header).toContainText('Not signed in');
  await expect(header).toContainText('Read only');
  await expect(welcome(page)).toHaveCount(0);

  // "Welcome to Lo" opens it over the pull request, from the Help menu where the system has one,
  // and Skip gives the pull request back.
  if (mac) await showFromMenu(app);
  else await showFromPalette(page);
  await expect(heading(page)).toHaveText('Review pull requests from the keyboard');
  await welcome(page).getByRole('button', { name: 'Skip' }).click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(title(page)).toHaveText(TITLE);

  // Opening one finished the welcome: closing the tab lands on Recent.
  await page.keyboard.press(`${cmd}+W`);
  await expect(middleOf(page).getByRole('heading', { name: 'No pull requests yet' })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

test.describe('with GitHub CLI', () => {
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

  test('imports its accounts, and says who is signed in once one is', async ({ page }) => {
    const importing = welcome(page).getByRole('button', { name: 'Import from GitHub CLI' });
    await expect(importing).toBeVisible();

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

    await expect(step(page)).toContainText('Signed in as rozed-bot');
    await expect(importing).toHaveCount(0);
    await expect(go(page)).toBeFocused();
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
    const notice = welcome(page)
      .getByText(/Lo needs git 2\.41\.0 or newer/)
      .first();
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const again = welcome(page).getByRole('button', { name: 'Check again' });

    // Nothing has changed: the notice stays.
    await again.click();
    await expect(again).not.toHaveAttribute('aria-busy', 'true');
    await expect(notice).toBeVisible();

    // Once git is there, it is found, and the notice goes.
    writeFileSync(marker, '');
    await again.click();
    await expect(notice).toHaveCount(0);
    await expect(again).toHaveCount(0);
    const info = await page.evaluate(() => window.lo.invoke('app.info'));
    expect(info).toMatchObject({ ok: true, value: { git: { status: 'found' } } });
  });
});

test('“Show rules” opens the rules for Finicky, Velja and Choosy, which copy through main and link to the documentation', async ({
  app,
  page,
}) => {
  // Main's clipboard is the system's, which the tests running beside this one use too: it records
  // what it is given instead of writing it.
  await app.evaluate(({ clipboard }) => {
    const written: string[] = [];
    Reflect.set(globalThis, 'written', written);
    clipboard.writeText = async (text: string) => {
      written.push(text);
    };
  });
  const copied = () =>
    app.evaluate((): string[] => {
      const written: unknown = Reflect.get(globalThis, 'written');
      return Array.isArray(written) ? written.map(String) : [];
    });
  const dialog = page.getByTestId('link-rules');
  const show = welcome(page).getByRole('button', { name: 'Show rules' });
  await go(page).click();
  await go(page).click();

  await test.step('“Show rules” opens the rules, and ⏎ is Done', async () => {
    await show.click();
    await expect(
      dialog.getByRole('heading', { name: 'Send pull request links to Lo' }),
    ).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
      'Finicky 4',
      'Velja',
      'Choosy',
    ]);
    await expect(dialog).toContainText('~/.finicky.js');
    await expect(dialog.getByRole('button', { name: /Done/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(show).toBeFocused();
    // The welcome is still on its set-up step: ⏎ went to the dialog alone.
    await expect(heading(page)).toHaveText('Use Lo with your other tools');
  });

  await test.step('copies a rule through main, which writes the clipboard', async () => {
    await show.click();
    const choosy = dialog.getByRole('region', { name: 'Choosy' });
    await choosy.getByRole('button', { name: 'Copy' }).click();
    await expect.poll(copied).toHaveLength(1);
    expect((await copied())[0]).toContain('^https://github\\.com/');
    await expect(choosy.getByRole('button')).toContainText('Copied');
  });

  await test.step('the rules link to the documentation, which opens in the browser', async () => {
    await dialog.getByRole('button', { name: 'Open documentation' }).click();
    await expect.poll(browsed).toEqual([DOCS]);
  });
});
