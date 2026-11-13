import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { gitProgram } from '@lo/testing/git';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, settingsPath, test } from './app.ts';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const strip = (page: Page) => page.getByRole('tablist', { name: 'Pull requests' });
const tabs = (page: Page) => strip(page).getByRole('tab');
const shown = (page: Page) => strip(page).getByRole('tab', { selected: true });

/** withlo/lo#1's tab: its number, then its title once GitHub has given it. */
const PULL = /^lo #1/;

const theme = (page: Page, name: string) => page.getByRole('radio', { name });
const sizeLimit = (page: Page) => page.getByRole('textbox', { name: 'Size limit in GB' });
/** What is wrong with the settings file, which Settings says above its sections. */
const problems = (page: Page) => page.getByRole('alert').filter({ hasText: 'settings file' });

/** The settings file's text now. */
const file = () => readFileSync(settingsPath(dataFolder()), 'utf8');

/** The settings file as an object, or nothing while there is no file. */
function saved(): unknown {
  try {
    return JSON.parse(file());
  } catch {
    return undefined;
  }
}

/** Writes the settings file as a person editing it would. */
function edit(text: string): void {
  mkdirSync(dirname(settingsPath(dataFolder())), { recursive: true });
  writeFileSync(settingsPath(dataFolder()), text);
}

/** Opens a pull request's tab through main, as the open box and links from other apps will. */
async function openPull(page: Page, number: number): Promise<void> {
  await page.evaluate(async (pull) => {
    const result = await window.lo.invoke('tab.open', {
      kind: 'pull',
      owner: 'withlo',
      repo: 'lo',
      number: pull,
    });
    if (!result.ok) throw new Error(result.error.message);
  }, number);
}

/** Opens Settings by its key, from the middle of the window. */
async function openSettings(page: Page): Promise<void> {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press(`${cmd}+Comma`);
  await expect(shown(page)).toHaveText('Settings');
}

/** Starts Lo on the test's data folder, and waits for its window. */
async function launch() {
  const app = await electron.launch({
    args: [appFolder],
    env: appEnvironment(dataFolder()),
    chromiumSandbox: true,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  return { app, page };
}

/**
 * The theme the system is in, which Lo wears while it matches the system. Playwright pins the
 * page's own idea of it, so this asks main.
 */
const systemTheme = (app: ElectronApplication) =>
  app.evaluate(({ nativeTheme }) => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));

/** Expects Lo to wear `name`. */
const wears = (page: Page, name: string) =>
  expect(page.locator('html')).toHaveAttribute('data-theme', name);

test('⌘, opens Settings in one tab, and shows it again from anywhere; and Pull requests sets what a pull request opens on, and the diff’s layout', async ({
  page,
}) => {
  await test.step('⌘, opens Settings in one tab, and shows it again from anywhere', async () => {
    await openSettings(page);
    await expect(tabs(page)).toHaveText(['Settings']);
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
    for (const section of ['Accounts', 'Pull requests', 'Appearance', 'Cache', 'Keys']) {
      await expect(page.getByRole('heading', { name: section, level: 2 })).toBeVisible();
    }

    // With others open, it goes to the end once, and a second press shows it, not another.
    await openPull(page, 1);
    await expect(tabs(page)).toHaveText(['Settings', PULL]);
    await expect(shown(page)).toHaveText(PULL);
    await page.keyboard.press(`${cmd}+Comma`);
    await expect(shown(page)).toHaveText('Settings');
    await page.keyboard.press(`${cmd}+Comma`);
    await expect(tabs(page)).toHaveText(['Settings', PULL]);
    await expect(shown(page)).toHaveText('Settings');
    // The page is drawn once, however many times it was asked for.
    await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(1);

    // Closed, and asked for again, it comes back as one tab.
    await page.keyboard.press(`${cmd}+KeyW`);
    await expect(tabs(page)).toHaveText([PULL]);
    await page.keyboard.press(`${cmd}+Comma`);
    await expect(tabs(page)).toHaveText([PULL, 'Settings']);
  });

  await test.step('Pull requests sets what a pull request opens on, and the diff’s layout', async () => {
    await openSettings(page);
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: 'Pull requests' })
      .click();
    const openOn = page.getByRole('radiogroup', { name: 'Open on' });
    await expect(openOn.getByRole('radio', { name: 'Overview' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await openOn.getByRole('radio', { name: 'Diff' }).click();
    await expect.poll(saved).toEqual({ 'overview.open': 'diff' });
    await expect(openOn.getByRole('radio', { name: 'Diff' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const layout = page.getByRole('radiogroup', { name: 'Diff layout' });
    await expect(layout.getByRole('radio', { name: 'Side by side' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await layout.getByRole('radio', { name: 'Inline' }).click();
    await expect.poll(saved).toEqual({ 'overview.open': 'diff', 'diff.layout': 'inline' });
  });
});

test('a change in Settings is written to the file, applied at once, and kept across a restart', async () => {
  // Not the theme the system is in, so the change shows.
  let other = 'dark';
  // Whatever the file already holds that Lo doesn't know stays.
  edit('{ "from.a.newer.lo": [1, { "a": true }] }\n');
  const first = await launch();
  try {
    const { page } = first;
    other = (await systemTheme(first.app)) === 'dark' ? 'light' : 'dark';
    await openSettings(page);
    await expect(theme(page, 'Match the system')).toBeChecked();
    await theme(page, other === 'dark' ? 'Dark' : 'Light').click();
    await wears(page, other);
    await expect(theme(page, other === 'dark' ? 'Dark' : 'Light')).toBeChecked();
    expect(saved()).toEqual({ 'from.a.newer.lo': [1, { a: true }], theme: other });

    await expect(sizeLimit(page)).toHaveValue('10');
    await sizeLimit(page).fill('20');
    await page.keyboard.press('Enter');
    await expect.poll(saved).toEqual({
      'from.a.newer.lo': [1, { a: true }],
      theme: other,
      'cache.cap': 20,
    });
    await expect(problems(page)).toHaveCount(0);
    // Written whole, as JSON a person can read.
    expect(file()).toBe(
      `${JSON.stringify({ 'from.a.newer.lo': [1, { a: true }], theme: other, 'cache.cap': 20 }, null, 2)}\n`,
    );
  } finally {
    await first.app.close();
  }

  const second = await launch();
  try {
    const { page } = second;
    await wears(page, other);
    // Settings was the tab on screen, and shows what was kept.
    await expect(shown(page)).toHaveText('Settings');
    await expect(theme(page, other === 'dark' ? 'Dark' : 'Light')).toBeChecked();
    await expect(sizeLimit(page)).toHaveValue('20');
    await expect(problems(page)).toHaveCount(0);
  } finally {
    await second.app.close();
  }
});

test.describe('with a hand-edited bad value', () => {
  const BAD = '{ "theme": "purple", "cache.cap": 12, "mine": "kept" }\n';
  test.use({ settings: BAD });

  test('Settings shows the error, uses the default, and keeps the rest of the file; and changing the setting that is wrong writes a good value, and the rest stays as it was', async ({
    app,
    page,
  }) => {
    await test.step('Settings shows the error, uses the default, and keeps the rest of the file', async () => {
      await openSettings(page);
      const alert = problems(page);
      await expect(alert).toContainText('Lo found a problem in the settings file');
      await expect(alert).toContainText('settings.json');
      await expect(alert).toContainText(
        'theme is "purple", but it must be dark, light or system. Lo uses "system".',
      );
      // The bad value is ignored: the default stands, and the good ones apply.
      await expect(theme(page, 'Match the system')).toBeChecked();
      await expect(sizeLimit(page)).toHaveValue('12');
      await wears(page, await systemTheme(app));

      // Fixed by hand, it applies at once and the error goes.
      edit('{ "theme": "light", "mine": "kept" }\n');
      await expect(alert).toHaveCount(0);
      await expect(theme(page, 'Light')).toBeChecked();
      await wears(page, 'light');
      await expect(sizeLimit(page)).toHaveValue('10');

      // Bad again, in another way, and live.
      edit('{ "theme": "dark", "cache.cap": "big" }\n');
      await expect(alert).toContainText('cache.cap is "big", but it must be a whole number of GB');
      await expect(alert).not.toContainText('theme is');
      await wears(page, 'dark');
    });

    await test.step('changing the setting that is wrong writes a good value, and the rest stays as it was', async () => {
      // The file as it was, hand-edited again, which Lo reads live.
      edit(BAD);
      await openSettings(page);
      await expect(problems(page)).toContainText('theme is "purple"');
      await theme(page, 'Dark').click();
      await expect(problems(page)).toHaveCount(0);
      await expect.poll(saved).toEqual({ theme: 'dark', 'cache.cap': 12, mine: 'kept' });
    });
  });
});

test.describe('with a settings file that is not JSON', () => {
  const broken = '{ "theme": "light", \n';
  test.use({ settings: broken });

  test('Settings says what is wrong, and writes nothing over it until it is fixed', async ({
    page,
  }) => {
    await openSettings(page);
    await expect(problems(page)).toContainText("The settings file isn't valid JSON");
    await theme(page, 'Light').click();
    // Lo says why it didn't, and the file is as the person left it.
    await expect(
      page.getByRole('status').filter({ hasText: "Lo didn't change theme" }),
    ).toBeVisible();
    expect(file()).toBe(broken);
    await expect(theme(page, 'Light')).not.toBeChecked();

    // Fixed, a change goes through.
    edit('{ "theme": "dark", "keep": 1 }\n');
    await expect(problems(page)).toHaveCount(0);
    await theme(page, 'Light').click();
    await expect.poll(saved).toEqual({ theme: 'light', keep: 1 });
  });
});

test('main refuses a setting the window sends that no feature declared, or its schema refuses', async ({
  page,
}) => {
  // As the page itself could, whatever Settings would send.
  const replies = await page.evaluate(
    async (inputs) => {
      const sent = [];
      for (const input of inputs) sent.push(await window.lo.invoke('settings.set', input));
      return sent;
    },
    [
      { key: 'theme', value: 'purple' },
      { key: 'theme', value: 3 },
      { key: 'cache.cap', value: 99_999 },
      { key: 'cache.cap', value: 2.5 },
      { key: 'not.a.setting', value: true },
      { key: '__proto__', value: true },
      { key: 'theme', value: 'dark', path: '/etc/passwd' },
      { key: 'theme' },
      'theme',
    ],
  );
  expect(replies.map((reply) => reply.ok)).toEqual(replies.map(() => false));
  expect(replies.map((reply) => (reply.ok ? '' : reply.error.code))).toEqual([
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
    'invalid',
  ]);
  // Nothing was written, not even the file.
  expect(saved()).toBeUndefined();
});

test.describe('with git', () => {
  test.use({ launch: { env: { LO_GIT: gitProgram() } } });

  test('Settings says how much room the local copies take, and clears them', async ({ page }) => {
    await openSettings(page);
    const cache = page.locator('section[data-settings-section="settings.cache"]');
    await expect(cache.getByRole('meter')).toBeVisible({ timeout: 15_000 });
    await expect(cache.getByText(/of 10 GB/)).toBeVisible();
    await cache.getByRole('button', { name: 'Clear the cache' }).click();
    await expect(cache.getByRole('status')).toContainText('Cleared.');
    await expect(cache.getByRole('meter')).toBeVisible();
  });
});
