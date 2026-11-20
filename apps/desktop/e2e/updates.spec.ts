// Updates in the app, from source, against a feed of releases on this machine: a newer Lo is
// offered in a toast that waits and never takes focus, whose Download opens the release's page and
// whose Later hides it until a check asked for brings it back; a check asked for with nothing newer
// says so; with `updates.check` off, Lo makes no check by itself; and Settings checks on "Check
// now" and turns checking by itself off and on.

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import type { Page } from '@playwright/test';

import { browsed, dataFolder, expect, settingsPath, test as base } from './app.ts';

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

test('offers a newer Lo in a toast that waits and never takes focus; Download opens its page, and Later hides it until a check asked for brings it back', async ({
  page,
  feed,
}) => {
  const toast = said(page, 'Lo 0.9.0 is out');
  await test.step('the toast comes after start, with the first line of the notes', async () => {
    await expect(toast).toContainText('Faster diffs', { timeout: 20_000 });
    // Run from source, Lo can't install itself: it offers the release's page.
    await expect(toast.getByRole('button')).toHaveText(['Download', 'Later']);
    await expect(toast.locator(':focus')).toHaveCount(0);
  });

  await test.step('Download opens the release’s page, and the toast stays until Later', async () => {
    await toast.getByRole('button', { name: 'Download' }).click();
    await expect.poll(browsed).toEqual(['https://github.com/withlo/lo/releases/tag/v0.9.0']);
    await expect(toast).toBeVisible();
  });

  await test.step('Later hides it, and a check asked for offers it again', async () => {
    await toast.getByRole('button', { name: 'Later' }).click();
    await expect(toast).toHaveCount(0);
    await ask(page, 'Check for updates');
    await expect(toast).toContainText('Faster diffs');
    await expect(toast.locator(':focus')).toHaveCount(0);
  });

  await test.step('a check asked for with nothing newer says so, and the offer goes', async () => {
    // The newest release is the one this Lo is, which a build run from source calls 0.0.0.
    feed.offer('0.0.0');
    await ask(page, 'Check for updates');
    await expect(said(page, 'is the newest version')).toHaveText('Lo 0.0.0 is the newest version.');
    await expect(toast).toHaveCount(0);
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
    await expect(said(page, 'Lo 0.9.0 is out')).toBeVisible();
    expect(feed.asked.length).toBeGreaterThan(0);
  });
});

test('Settings checks on "Check now", and turns checking by itself off and on', async ({
  page,
  feed,
}) => {
  // Settings, opened through main as other tests open it.
  await page.evaluate(() => window.lo.invoke('tab.open', { kind: 'settings' }));
  const updates = page.getByRole('region', { name: 'Updates' });
  await expect(updates).toContainText('Lo 0.0.0');
  // Lo's own first check has come and gone by the time the toast shows; ask again from Settings.
  await expect(said(page, 'Lo 0.9.0 is out')).toBeVisible({ timeout: 20_000 });
  const before = feed.asked.length;
  feed.offer('0.0.0');
  await updates.getByRole('button', { name: 'Check now' }).click();
  await expect(said(page, 'is the newest version')).toHaveText('Lo 0.0.0 is the newest version.');
  expect(feed.asked.length).toBeGreaterThan(before);

  const timed = updates.getByRole('switch', { name: 'Check for updates by itself' });
  await expect(timed).toHaveAttribute('aria-checked', 'true');
  await timed.click();
  await expect.poll(file).toEqual({ 'updates.check': false });
  await expect(timed).toHaveAttribute('aria-checked', 'false');
  await timed.click();
  await expect.poll(file).toEqual({ 'updates.check': true });
});
