// The welcome in the app: it covers the Recent tab on a first launch and is walked by key and by
// mouse through its six steps, signing in, choosing how Lo looks and its keys, what an overview is,
// setting up and opening a pull request. Once finished it opens again from the command palette.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

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

const DOCS = 'https://github.com/withlo/lo/blob/main/docs/link-routers.md';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const test = base.extend<{
  github: ReplayServer;
  cassette: string;
  /** How long a sign-in waits between polls, in milliseconds, in place of GitHub's interval. */
  pollEvery: number | undefined;
}>({
  cassette: ['app_e2e', { option: true }],
  pollEvery: [undefined, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  launch: async ({ github, pollEvery }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
        LO_COMMAND_FOLDER: test.info().outputPath('bin'),
        ...(pollEvery === undefined ? {} : { LO_DEVICE_POLL_MS: String(pollEvery) }),
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
const linkField = (page: Page) => welcome(page).getByRole('textbox', { name: 'Pull request link' });
const practice = (page: Page) => welcome(page).getByRole('listbox', { name: 'Practice diff' });
const chosen = (page: Page) => practice(page).locator('[role="option"][aria-selected="true"]');

/** What the settings file holds now, or nothing before Lo has written it. */
function settingsText(): string {
  const path = settingsPath(dataFolder());
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
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

test('a first launch shows the welcome over Recent, and its six steps are walked by key and by mouse', async ({
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

  await test.step('the look step chooses the theme and the diff’s layout, by key and by mouse', async () => {
    await go(page).click();
    await expect(heading(page)).toHaveText('Choose how Lo looks');
    const theme = step(page).getByRole('radiogroup', { name: 'Theme' });
    const layout = step(page).getByRole('radiogroup', { name: 'Diff layout' });
    // Focus starts on the theme on file, so the arrows choose at once; the window follows.
    await expect(theme.getByRole('radio', { name: 'System' })).toBeFocused();
    await page.keyboard.press('h');
    await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Down goes to the next group's chosen card, and chooses nothing.
    await page.keyboard.press('j');
    await expect(layout.getByRole('radio', { name: 'Side by side' })).toBeFocused();
    await expect(layout.getByRole('radio', { name: 'Side by side' })).toBeChecked();
    await layout.getByRole('radio', { name: 'Inline' }).click();
    await expect(layout.getByRole('radio', { name: 'Inline' })).toBeChecked();
    // Each is written to the settings file as it's pressed.
    await expect.poll(settingsText).toMatch(/"theme":\s*"light"/);
    await expect.poll(settingsText).toMatch(/"diff\.layout":\s*"inline"/);
    // ⏎ on a card is Continue, and ⇧⏎ is Back.
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('Choose your keys');
    await page.keyboard.press('Shift+Enter');
    await expect(heading(page)).toHaveText('Choose how Lo looks');
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
    await expect.poll(settingsText).toMatch(/"editor\.vim":\s*true/);
  });

  await test.step('the overviews step shows one, and turns overviews off and on again', async () => {
    // ⏎ is Continue wherever focus is in the step, off a button.
    await practice(page).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('An overview explains a pull request');
    // Focus is on Continue, not the switch, so ⏎ goes on.
    await expect(go(page)).toBeFocused();
    await expect(step(page).getByRole('img', { name: /^An overview: a heading/ })).toBeVisible();
    const on = step(page).getByRole('switch', { name: 'Show overviews' });
    const first = step(page).getByRole('radiogroup', { name: 'Open pull requests on' });
    await expect(on).toBeChecked();
    await expect(first.getByRole('radio')).toHaveText(['Overview', 'Timeline', 'Diff']);
    // Off, the first view has no Overview, and set-up has no skill to install.
    await on.click();
    await expect(on).not.toBeChecked();
    await expect(first.getByRole('radio')).toHaveText(['Timeline', 'Diff']);
    await expect.poll(settingsText).toMatch(/"overview\.on":\s*false/);
    await go(page).click();
    await expect(heading(page)).toHaveText('Use Lo with your other tools');
    await expect(step(page).getByRole('listitem')).toHaveCount(2);
    await welcome(page).getByRole('button', { name: 'Back' }).click();
    await on.click();
    await expect(on).toBeChecked();
    await expect(first.getByRole('radio')).toHaveText(['Overview', 'Timeline', 'Diff']);
  });

  await test.step('the set-up step installs the lo command', async () => {
    await go(page).click();
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
    await expect(heading(page)).toHaveText('An overview explains a pull request');
    await go(page).click();
    await expect(command).toContainText('Installed');
  });

  await test.step('the last step ends on Recent, which says what to do next', async () => {
    await go(page).click();
    await expect(heading(page)).toHaveText('Open a pull request');
    await expect(linkField(page)).toBeFocused();
    await expect(step(page)).toContainText('withlo/lo#182 · has an overview');
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
  // GitHub answers two polls "pending", then the token. Polled every second, the first sign-in is
  // stopped long before it could have polled three times.
  test.use({ cassette: 'device_flow_success', pollEvery: 1_000 });

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

    // The button does the same.
    await signIn(page).click();
    await expect(dialog).toContainText('Signed in as rozed-bot', { timeout: 10_000 });
    await dialog.getByRole('button', { name: /Done/ }).click();
    await expect(dialog).toBeHidden();
    // The step says who signed in where the button was, and Continue is its main button now.
    await expect(step(page)).toContainText('Signed in as rozed-bot');
    await expect(signIn(page)).toHaveCount(0);
    await expect(go(page)).toBeFocused();
    await expect(go(page)).toContainText(mac ? '⏎' : 'Enter');
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText('Choose how Lo looks');
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
  for (let each = 0; each < 4; each++) await go(page).click();

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
