import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  currentPlatform,
  downloadFor,
  fingerprint,
  readOsRelease,
  swiftDistroFor,
  swiftToolchainId,
  TOOLCHAINS,
  versionFor,
} from '@lo/lsp';
import { gitProgram } from '@lo/testing/git';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  cachePath,
  dataFolder,
  drawnWindow,
  expect,
  settingsPath,
  test,
} from './app.ts';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const strip = (page: Page) => page.getByRole('tablist', { name: 'Tabs' });
const tabs = (page: Page) => strip(page).getByRole('tab');
const shown = (page: Page) => strip(page).getByRole('tab', { selected: true });

/** withlo/lo#1's tab: its number, then its title once GitHub has given it. */
const PULL = /^lo #1/;

const theme = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name, exact: true });
const sizeLimit = (page: Page) => page.getByRole('textbox', { name: 'Size limit in GB' });
/** What is wrong with the settings file, which Settings says above its groups. */
const problems = (page: Page) => page.getByRole('alert').filter({ hasText: /^Can’t (use|read)/ });
/** A row of Settings, by the id of its view. */
const row = (page: Page, id: string) => page.locator(`[data-settings-row="${id}"]`);

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
  const page = await drawnWindow(app);
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
    for (const group of [
      'Accounts',
      'Appearance',
      'Keyboard',
      'Pull requests',
      'Code intelligence',
      'Storage',
      'Integrations',
      'About',
    ]) {
      await expect(page.getByRole('heading', { name: group, level: 2 })).toBeAttached();
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
    const openOn = page.getByRole('radiogroup', { name: 'Open pull requests on' });
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
  // Whatever the file already holds stays as it is: its comments, and what Lo doesn't know.
  const kept = `// Kept by hand.
// Lo reads comments,
// and a comma after the last key.
{
  "from.a.newer.lo": [1, { "a": true }], // A newer Lo's.
`;
  edit(`${kept}}\n`);
  const first = await launch();
  try {
    const { page } = first;
    other = (await systemTheme(first.app)) === 'dark' ? 'light' : 'dark';
    await openSettings(page);
    await expect(theme(page, 'System')).toBeChecked();
    await theme(page, other === 'dark' ? 'Dark' : 'Light').click();
    await wears(page, other);
    await expect(theme(page, other === 'dark' ? 'Dark' : 'Light')).toBeChecked();
    // Each setting is added after the last key, as a person would add it.
    expect(file()).toBe(`${kept}  "theme": "${other}",\n}\n`);

    await expect(sizeLimit(page)).toHaveValue('10');
    await sizeLimit(page).fill('20');
    await page.keyboard.press('Enter');
    await expect.poll(file).toBe(`${kept}  "theme": "${other}",\n  "cache.cap": 20,\n}\n`);
    await expect(problems(page)).toHaveCount(0);
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
      await expect(alert).toContainText('Can’t use 1 setting');
      await expect(alert).toContainText('theme is "purple". It must be dark, light or system.');
      // The bad value is ignored: the default stands, and the good ones apply.
      await expect(theme(page, 'System')).toBeChecked();
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
      await expect(alert).toContainText('cache.cap is "big". It must be a whole number of GB');
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

test.describe('with app.gpu off', () => {
  test.use({ settings: '{ "app.gpu": false }\n' });

  test('Lo starts and draws without hardware acceleration, the window can’t change it, and Settings reports a value it can’t use', async ({
    app,
    page,
  }) => {
    expect(await app.evaluate(({ app: lo }) => lo.isHardwareAccelerationEnabled())).toBe(false);
    // As the page itself could: only the person editing the file changes it.
    const reply = await page.evaluate(() =>
      window.lo.invoke('settings.set', { key: 'app.gpu', value: true }),
    );
    expect(reply.ok ? '' : reply.error.code).toBe('unwritable');
    expect(file()).toBe('{ "app.gpu": false }\n');
    edit('{ "app.gpu": "off" }\n');
    await openSettings(page);
    await expect(problems(page)).toContainText('app.gpu is "off". It must be true or false.');
  });
});

test.describe('with a settings file that is not JSON', () => {
  const broken = '{ "theme": "light", \n';
  test.use({ settings: broken });

  test('Settings says what is wrong, and writes nothing over it until it is fixed', async ({
    page,
  }) => {
    await openSettings(page);
    await expect(problems(page)).toContainText('Line 2, column 1 isn’t valid JSON.');
    await theme(page, 'Light').click();
    // The row says why it didn't, and the file is as the person left it.
    await expect(row(page, 'settings.theme').getByRole('alert')).toHaveText(
      'Couldn’t change the theme settings.json isn’t valid JSON.',
    );
    expect(file()).toBe(broken);
    await expect(theme(page, 'Light')).not.toBeChecked();

    // Fixed, a change goes through.
    edit('{ "theme": "dark", "keep": 1 }\n');
    await expect(problems(page)).toHaveCount(0);
    await theme(page, 'Light').click();
    await expect.poll(saved).toEqual({ theme: 'light', keep: 1 });
  });
});

test('Try again saves a change that couldn’t be, and focus stays in Settings as the button goes', async ({
  page,
}) => {
  // Lo can't write in the settings file's folder, so a change isn't saved.
  const folder = dirname(settingsPath(dataFolder()));
  mkdirSync(folder, { recursive: true });
  const again = row(page, 'settings.theme').getByRole('button', { name: 'Try again' });
  chmodSync(folder, 0o500);
  try {
    await openSettings(page);
    await theme(page, 'Light').click();
    await expect(row(page, 'settings.theme').getByRole('alert')).toContainText(
      'Couldn’t change the theme',
    );
    await expect(again).toBeVisible();
  } finally {
    chmodSync(folder, 0o700);
  }

  // Pressed from the keyboard, it goes with focus on it, and the change is saved.
  await again.focus();
  await page.keyboard.press('Enter');
  await expect(again).toHaveCount(0);
  await expect.poll(saved).toEqual({ theme: 'light' });
  // Focus goes to Settings, not the page, so its keys work at once.
  await expect(page.locator('[data-lo-scope="settings"]')).toBeFocused();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search settings' })).toBeFocused();
});

/**
 * Puts Go in the test's cache as Lo would have installed it, as a program of `bytes` bytes, and
 * says where its version's folder is.
 */
function installGo(bytes: number): string {
  const pinned = TOOLCHAINS.go;
  const platform = currentPlatform();
  const download = pinned && platform && downloadFor(pinned, platform);
  if (!pinned || !download) throw new Error('Lo pins no Go for this system');
  const folder = join(cachePath(dataFolder()), 'toolchains', 'go', pinned.version);
  mkdirSync(join(folder, 'files', 'go', 'bin'), { recursive: true });
  writeFileSync(join(folder, 'files', 'go', 'bin', 'go'), Buffer.alloc(bytes));
  const marker = {
    id: 'go',
    version: pinned.version,
    fingerprint: fingerprint('go', pinned, download),
    files: [['go/bin/go', bytes]],
    folders: ['go', 'go/bin'],
    links: [],
  };
  writeFileSync(join(folder, 'installed.json'), JSON.stringify(marker));
  return folder;
}

/** The version of the toolchain `id` that Lo pins for this system, as a pattern matches it. */
function pinnedVersion(id: string): string {
  const pinned = TOOLCHAINS[id];
  const platform = currentPlatform();
  if (!pinned || !platform) throw new Error(`Lo pins no ${id} for this system`);
  return versionFor(pinned, platform).replace(/[.+]/g, '\\$&');
}

test('Settings lists the toolchains, and deletes one that’s downloaded', async () => {
  const go = installGo(2048);
  const app = await electron.launch({
    args: [appFolder],
    env: { ...appEnvironment(dataFolder()), LO_GIT: gitProgram() },
    chromiumSandbox: true,
  });
  try {
    const page = await drawnWindow(app);
    await openSettings(page);
    const section = row(page, 'code.toolchains');
    const rows = section.getByRole('listitem');
    // On macOS, Swift's too: the system's, from Xcode or Apple's Command Line Tools, with nothing to
    // remove. On a Linux that takes one of swift.org's builds, Lo's download of that.
    const swift =
      process.platform === 'darwin'
        ? [/^Swift(From Xcode|From Apple’s Command Line Tools|Needs .+) · For Swift$/]
        : [];
    const distro = process.platform === 'linux' ? swiftDistroFor(readOsRelease()) : undefined;
    const version = distro && pinnedVersion(swiftToolchainId(distro));
    const downloaded = version
      ? [new RegExp(`^Swift ${version}Not downloaded · [\\d.]+ GB · For Swift$`)]
      : [];
    const goVersion = pinnedVersion('go');
    await expect(rows).toHaveText(
      [
        // C#'s server runs on the .NET SDK, Go's on Go, Rust's on Rust and Java's on the JDK.
        new RegExp(`^\\.NET SDK ${pinnedVersion('dotnet')}Not downloaded · [\\d.]+ MB · For C#$`),
        new RegExp(`^Go ${goVersion}2 KB · For GoDeleteDeleting…$`),
        new RegExp(`^Rust ${pinnedVersion('rust')}Not downloaded · [\\d.]+ MB`),
        ...downloaded,
        new RegExp(`^Temurin JDK ${pinnedVersion('temurin')}Not downloaded · [\\d.]+ MB`),
        ...swift,
      ],
      { timeout: 15_000 },
    );
    await section.getByRole('button', { name: 'Delete Go' }).click();
    await expect(rows.nth(1)).toHaveText(new RegExp(`^Go ${goVersion}Not downloaded · [\\d.]+ MB`));
    expect(existsSync(go)).toBe(false);
    // Focus doesn't fall to the page with the button: nothing else is downloaded, so the list has it.
    await expect(section.getByRole('list', { name: 'Toolchains' })).toBeFocused();
  } finally {
    await app.close();
  }
});

test.describe('with git', () => {
  test.use({ launch: { env: { LO_GIT: gitProgram() } } });

  test('Settings says how much room the local copies take, and clears them', async ({ page }) => {
    await openSettings(page);
    const cache = row(page, 'settings.cache');
    await expect(cache.getByRole('meter')).toBeVisible({ timeout: 15_000 });
    await expect(cache.getByText(/of 10 GB/)).toBeVisible();
    await cache.getByRole('button', { name: 'Clear cache' }).click();
    await expect(cache.getByRole('button', { name: 'Clear cache' })).not.toHaveAttribute(
      'aria-busy',
    );
    await expect(cache.getByRole('meter')).toBeVisible();
    await expect(cache.getByRole('alert')).toHaveCount(0);
  });
});
