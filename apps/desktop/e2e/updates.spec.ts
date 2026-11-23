// Updates in the app, from source, against a feed of releases on this machine: a newer Lo is
// offered in a toast that waits and never takes focus, whose Download update opens the release's page and
// whose Hide hides it until a check asked for brings it back; a check asked for with nothing newer
// says so; with `updates.check` off, Lo makes no check by itself; and Settings › About checks on
// "Check now" and turns checking by itself off and on.

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import type { ElectronApplication, Page } from '@playwright/test';

import { browsed, dataFolder, expect, settingsPath, sizeWindow, test as base } from './app.ts';

const mac = process.platform === 'darwin';
const cmd = mac ? 'Meta' : 'Control';

/** A feed of releases on this machine, in GitHub's own paths, with one release at a time. */
interface Feed {
  /** The feed's address, `http://127.0.0.1:<port>/`. */
  readonly url: string;
  /** The version of the newest release, and the first line of its notes. */
  offer(version: string, notes?: string): void;
  /** The paths Lo has asked for, in order. */
  readonly asked: string[];
}

/** The feed's atom page of releases, as GitHub's lists them. */
function atom(port: number, version: string, notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v${version}</id>
    <updated>2026-11-19T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="http://127.0.0.1:${port}/withlo/lo/releases/tag/v${version}"/>
    <title>v${version}</title>
    <content type="html">&lt;h2&gt;${notes}&lt;/h2&gt;</content>
  </entry>
</feed>`;
}

/** A release's `latest-*.yml`, as electron-builder writes it. */
function latest(version: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: Lo-${version}-arm64-mac.zip`,
    '    sha512: aGVsbG8=',
    '    size: 5',
    `path: Lo-${version}-arm64-mac.zip`,
    'sha512: aGVsbG8=',
    "releaseDate: '2026-11-19T00:00:00.000Z'",
    '',
  ].join('\n');
}

const test = base.extend<{ feed: Feed }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  feed: async ({}, use) => {
    let version = '0.9.0';
    let notes = 'Faster diffs';
    const asked: string[] = [];
    let port = 0;
    const server: Server = createServer((incoming, response) => {
      const path = incoming.url ?? '';
      asked.push(path);
      if (path === '/withlo/lo/releases.atom') {
        response.end(atom(port, version, notes));
      } else if (path === '/api/v3/repos/withlo/lo/releases/latest') {
        // Where electron-updater asks for the newest release's tag, off github.com.
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ tag_name: `v${version}` }));
      } else if (/^\/withlo\/lo\/releases\/download\/v[^/]+\/latest[^/]*\.yml$/.test(path)) {
        response.end(latest(version));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('The feed has no port.');
    port = address.port;
    await use({
      url: `http://127.0.0.1:${port}/`,
      offer(next, text = 'Faster diffs') {
        version = next;
        notes = text;
      },
      asked,
    });
    await new Promise((resolve) => server.close(resolve));
  },
  launch: async ({ feed }, use) => {
    await use({ env: { LO_UPDATES_FEED: feed.url } });
  },
});

/** The toast of an update, and the note a check says what it found in, by what they say. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** The settings file as an object, or nothing while there is no file. */
function file(): unknown {
  try {
    return JSON.parse(readFileSync(settingsPath(dataFolder()), 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Runs a command from the command palette with ⏎ held down for `held` ms after the command has run,
 * so the key repeats as it does under a finger, and then let go of.
 */
async function askHolding(page: Page, command: string, held: number): Promise<void> {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press(`${cmd}+Shift+KeyP`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type(command);
  // Playwright marks a key pressed again while it's down as a repeat.
  await page.keyboard.down('Enter');
  await expect(palette).toBeHidden();
  const end = Date.now() + held;
  while (Date.now() < end) {
    await page.keyboard.down('Enter');
    await page.waitForTimeout(50);
  }
  await page.keyboard.up('Enter');
}

/** Runs a command from the command palette, by its name. */
async function ask(page: Page, command: string): Promise<void> {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press(`${cmd}+Shift+KeyP`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
}

test('offers a newer Lo in a toast that floats and waits and never takes focus; the keyboard reaches its buttons; Hide hides it until a check asked for brings it back', async ({
  app,
  page,
  feed,
}) => {
  const toast = said(page, 'Lo 0.9.0 is available');
  const download = toast.getByRole('button', { name: 'Download update' });
  const later = toast.getByRole('button', { name: 'Hide' });
  const middle = page.locator('main[data-lo-middle]');

  await test.step('the toast comes after start, with the first line of the notes', async () => {
    await sizeWindow(app, 1280, 800);
    await expect(toast).toContainText('Faster diffs', { timeout: 20_000 });
    // Run from source, Lo can't install itself: it offers the release's page.
    await expect(toast.getByRole('button')).toHaveText(['Download update', 'Hide']);
    await expect(toast.locator(':focus')).toHaveCount(0);
  });

  await test.step('it floats above the status bar, and the middle of the window keeps its whole height', async () => {
    // As a note does, where the page doesn't shift for it: the middle goes to the foot of the window.
    const height = await page.evaluate(() => window.innerHeight);
    const room = await page.evaluate(
      () =>
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--lo-statusbar-h'),
        ) || 0,
    );
    const card = await toast.locator('.toast').boundingBox();
    const whole = await middle.boundingBox();
    if (!card || !whole) throw new Error('The toast or the middle has no box.');
    expect(whole.y + whole.height).toBeGreaterThanOrEqual(height - 1);
    expect(height - (card.y + card.height)).toBeGreaterThanOrEqual(room + 12 - 1);
  });

  await test.step('“Go to update” focuses its first button, Tab and ⇧Tab move between them, and Esc leaves', async () => {
    await ask(page, 'Go to update');
    await expect(download).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(later).toBeFocused();
    // From the last button it goes round to the first, and back, as in a toolbar, and stays in.
    await page.keyboard.press('Tab');
    await expect(download).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(later).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(download).toBeFocused();
    await page.keyboard.press('Escape');
    // Focus is back in the middle of the window, which is Recent's, or the welcome screen's.
    await expect(toast.locator(':focus')).toHaveCount(0);
    await expect(middle.locator(':focus')).toHaveCount(1);
  });

  await test.step('⏎ held through “Go to update” presses nothing, and a press of its own on Download update opens the release’s page', async () => {
    // The first ⏎ chooses the command, which puts focus on Download update, and the rest of it repeats for
    // longer than the moment after focus comes, in which a press is ignored anyway.
    await askHolding(page, 'Go to update', 1_500);
    await expect(download).toBeFocused();
    expect(browsed()).toEqual([]);
    await expect(toast).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(browsed).toEqual(['https://github.com/withlo/lo/releases/tag/v0.9.0']);
    await expect(toast).toBeVisible();
    // And so does the command, which is what the button is.
    await ask(page, 'What’s new');
    await expect.poll(browsed).toHaveLength(2);
    await ask(page, 'Download update');
    await expect.poll(browsed).toHaveLength(3);
  });

  await test.step('Hide hides it, and a check asked for offers it again', async () => {
    await later.click();
    await expect(toast).toHaveCount(0);
    await ask(page, 'Check for updates');
    await expect(toast).toContainText('Faster diffs');
    await expect(toast.locator(':focus')).toHaveCount(0);
  });

  await test.step('a check asked for with nothing newer says so, and the offer goes', async () => {
    // The newest release is the one this Lo is, which a build run from source calls 0.0.0.
    feed.offer('0.0.0');
    await ask(page, 'Check for updates');
    await expect(said(page, 'No update available')).toHaveText('No update available');
    await expect(toast).toHaveCount(0);
    // The room it took is the middle's again.
    await expect
      .poll(async () => {
        const whole = await middle.boundingBox();
        const height = await page.evaluate(() => window.innerHeight);
        return whole !== null && whole.y + whole.height >= height - 1;
      })
      .toBe(true);
  });
});

/**
 * The items of the app menu's menu `name` by label, each with whether it's enabled. `Lo` is the
 * first, the menu named after the app.
 */
const menuItems = (app: ElectronApplication, name: string) =>
  app.evaluate(({ Menu }, label) => {
    const menus = Menu.getApplicationMenu()?.items ?? [];
    const menu = label === 'Lo' ? menus[0] : menus.find((item) => item.label === label);
    return Object.fromEntries(
      (menu?.submenu?.items ?? [])
        .filter((item) => item.label !== '')
        .map((item) => [item.label, item.enabled]),
    );
  }, name);

test.describe('the app menu', () => {
  test.skip(!mac, 'The test reads the menu bar, which is macOS’s.');

  test('holds Check for updates, and What’s new in Help, and leaves the rest to the update’s toast', async ({
    app,
    page,
    feed,
  }) => {
    await expect
      .poll(async () => (await menuItems(app, 'Lo'))['Check for updates'], { timeout: 20_000 })
      .toBe(true);
    const lo = Object.keys(await menuItems(app, 'Lo'));
    for (const label of [
      'Update Lo',
      'Restart to update',
      'Update',
      'Move Lo to Applications',
      'Hide update',
      'Download update',
      'Copy Homebrew command',
      'Go to update',
    ]) {
      expect(lo, label).not.toContain(label);
    }
    // What's new applies with nothing on offer too: it opens Lo's releases.
    expect((await menuItems(app, 'Help'))['What’s new']).toBe(true);

    // An offer a source build can only download leaves the menu as it was: Restart to update takes
    // Check for updates' place only once an update is ready.
    await expect(said(page, 'Lo 0.9.0 is available')).toBeVisible({ timeout: 20_000 });
    expect(await menuItems(app, 'Lo')).toMatchObject({ 'Check for updates': true });
    expect(Object.keys(await menuItems(app, 'Lo'))).not.toContain('Restart to update');
    void feed;
  });
});

test.describe('with checking by itself off', () => {
  test.use({ settings: '{ "updates.check": false }\n' });

  test('Lo asks the feed nothing until it’s asked to', async ({ page, feed }) => {
    // Well past the first check a Lo run from source makes by itself, a second after its window.
    await page.waitForTimeout(4_000);
    expect(feed.asked).toEqual([]);
    await expect(page.getByRole('status').filter({ hasText: /\w/ })).toHaveCount(0);
    await ask(page, 'Check for updates');
    await expect(said(page, 'Lo 0.9.0 is available')).toBeVisible();
    expect(feed.asked.length).toBeGreaterThan(0);
  });
});

test('Settings checks on "Check now", and turns checking by itself off and on', async ({
  page,
  feed,
}) => {
  // Settings, opened through main as other tests open it.
  await page.evaluate(() => window.lo.invoke('tab.open', { kind: 'settings' }));
  const updates = page.getByRole('region', { name: 'About' });
  await expect(updates).toContainText('Lo 0.0.0');
  // The e2e build is run from source, so it has no commit to show.
  await expect(updates).toContainText('Built from source');
  // Lo's own first check has come and gone by the time the offer shows; ask again from Settings.
  // The offer is said on the row, in view, so the toast that would say the same steps aside.
  await updates.scrollIntoViewIfNeeded();
  await expect(updates).toContainText('Lo 0.9.0 is available', { timeout: 20_000 });
  await expect(said(page, 'Lo 0.9.0 is available')).toHaveCount(0);
  const before = feed.asked.length;
  feed.offer('0.0.0');
  await updates.getByRole('button', { name: 'Check now' }).click();
  // Said on the row, not in a note.
  await expect(updates).toContainText('Checked just now');
  expect(feed.asked.length).toBeGreaterThan(before);

  const timed = updates.getByRole('switch', { name: 'Check for updates automatically' });
  await expect(timed).toHaveAttribute('aria-checked', 'true');
  await timed.click();
  await expect.poll(file).toEqual({ 'updates.check': false });
  await expect(timed).toHaveAttribute('aria-checked', 'false');
  await timed.click();
  await expect.poll(file).toEqual({ 'updates.check': true });
});
