// Trust in the app, on rozed-dev/e2e#80, which nothing trusts: its status bar says language servers
// are off, with no banner, and the item's details offer to trust it by themselves once, at the
// first `g d`, leaving focus where it was, and not again after Lo starts again; "Trust repo…"
// trusts it only once main's own dialog, answered here as the reader would, says "Trust repo", and
// Settings lists it until it's removed there; taken out of the file by hand, its checkouts go too.
// With a settings file Lo can't read, the details say why Lo couldn't trust it, offer to open the
// file, and once the file's fixed, offer to trust it again, and do. GitHub answers from `app_e2e`,
// and the repository's IDs, which Lo reads only once the reader asks to trust it, from
// `pull_request_repositories_e2e`.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { cassette, Replay } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import { _electron as electron, type Page } from '@playwright/test';

import {
  answerDialogs,
  appEnvironment,
  appFolder,
  cachePath,
  dataFolder,
  dialogsAsked,
  DIFF_FIRST_VIM,
  drawnWindow,
  expect,
  KEYCHAIN,
  opened,
  settingsPath,
  tabBanners,
  test as base,
  testServers,
  type TestServers,
} from './app.ts';

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';
/** rozed-dev/e2e's node ID, as GitHub gave it. */
const E2E = 'R_kgDOVleUfQ';

const test = base.extend<{
  github: ReplayServer;
  servers: TestServers;
  env: Record<string, string>;
}>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const interactions = ['app_e2e', 'pull_request_repositories_e2e'].flatMap((name) =>
      cassette(name).interactions.map(({ interaction }) => interaction),
    );
    const server = await serveReplay(new Replay('app_e2e with its repositories', interactions));
    // Closed once, by the test that takes GitHub away or after it.
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= server.close());
    await use({ ...server, close });
    await close();
  },
  // The fake server, named TypeScript, as what Lo would run once the repo is trusted: without a
  // language server for what a view shows, there's no item to say they're off.
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  servers: async ({}, use) => {
    const servers = testServers(test.info().outputPath('servers'), { answers: {} });
    await use(servers);
    // After Lo has closed, which stops them itself.
    servers.kill();
  },
  env: async ({ github, servers }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      LO_GITHUB: new URL(github.urls.api).origin,
      LO_TEST_TOKEN_FILE: tokenFile,
      LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
      ...servers.env,
    });
  },
  launch: async ({ env }, use) => {
    await use({ args: [appFolder, ...KEYCHAIN], env });
  },
});

/** The status bar's Language servers item, while they're off. */
const item = (page: Page) =>
  page
    .locator('footer[aria-label="Status bar"]')
    .getByRole('button', { name: 'Language servers off', exact: true });

/** The item's details, open over it. */
const details = (page: Page) => page.getByRole('dialog', { name: 'Language servers off' });

/** Opens the item's details, unless they're open, and gives them. */
async function offer(page: Page) {
  if ((await details(page).count()) === 0) await item(page).click();
  await expect(details(page)).toContainText('Language servers are off for rozed-dev/e2e');
  return details(page);
}

/** Where main says view `view` stands. */
async function status(page: Page, view: string): Promise<unknown> {
  const reply = await page.evaluate((id) => window.lo.invoke('code.state', { view: id }), view);
  return reply.ok ? reply.value : reply;
}

/** Opens #80 once rozed-bot is signed in, and returns its tab's id once main has decided. */
async function open(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(() =>
    window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 }),
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  const id = reply.value;
  await expect
    .poll(() => status(page, id), { timeout: 20_000 })
    .toMatchObject({ repo: 'rozed-dev/e2e', pull: APP_PULL.number, trust: { kind: 'untrusted' } });
  return id;
}

/** What the settings file trusts, as it says now. */
function trustedInFile(): unknown {
  try {
    const settings: unknown = JSON.parse(readFileSync(settingsPath(dataFolder()), 'utf8'));
    return typeof settings === 'object' && settings !== null
      ? Reflect.get(settings, 'code.trusted')
      : undefined;
  } catch {
    return undefined;
  }
}

test.describe('with Vim keys', () => {
  test.use({ settings: DIFF_FIRST_VIM });

  test('says language servers are off in the status bar, and offers trust once, at the first g d, after a restart too', async ({
    app,
    page,
    env,
    github,
  }) => {
    test.setTimeout(120_000);
    const id = await open(page);
    // Off is the status bar's to say: no banner says it over the pull request.
    await expect(item(page)).toBeVisible({ timeout: 20_000 });
    await expect(tabBanners(page)).toHaveCount(0);
    await expect(details(page)).toHaveCount(0);

    // The first `g d`, on `Line` in src/format.ts's first line, asks for what a language server
    // would answer: the item's details open, and the peek keeps focus.
    await expect
      .poll(
        async () => {
          const state = await page.evaluate((view) => window.lo.invoke('code.index', { view }), id);
          return state.ok ? state.value : state;
        },
        { timeout: 60_000 },
      )
      .toMatchObject({ kind: 'ready', partial: null });
    await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });
    await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
    for (const key of ['g', 'g', ']', 'f', ']', 'f', ']', 'f', 'j', 'f', 'Shift+L', 'g', 'd']) {
      await page.keyboard.press(key);
    }
    const peek = page.locator('.lo-diffpeek');
    await expect(peek).toBeFocused();
    await expect(details(page)).toContainText('Language servers are off for rozed-dev/e2e');
    await expect(details(page).getByRole('button', { name: 'Trust repo…' })).toBeVisible();
    await expect.poll(() => status(page, id)).toMatchObject({ dismissed: true });
    await item(page).click();
    await expect(details(page)).toHaveCount(0);
    await app.close();
    // GitHub goes away, so Lo starts again on what it saved, asking GitHub for nothing it hasn't
    // recorded.
    await github.close();

    const again = await electron.launch({
      args: [appFolder, ...KEYCHAIN],
      env: { ...appEnvironment(dataFolder()), ...env },
      chromiumSandbox: true,
    });
    try {
      const shown = await drawnWindow(again);
      // The tab comes back, as untrusted as it was, offline, with the item, its offer made.
      await expect
        .poll(() => status(shown, id), { timeout: 20_000 })
        .toMatchObject({ trust: { kind: 'untrusted', why: 'unnamed' }, dismissed: true });
      await expect(shown.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(item(shown)).toBeVisible();
      await expect(details(shown)).toHaveCount(0);
    } finally {
      await again.close();
    }
  });
});

test('trusts the repo only once main’s own dialog says Trust repo, and Settings lists it until it’s removed', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const id = await open(page);

  // Cancelled: nothing is trusted, and the offer stays.
  await answerDialogs(app, 'Cancel');
  await (await offer(page)).getByRole('button', { name: 'Trust repo…' }).click();
  await expect.poll(async () => (await dialogsAsked(app)).length).toBe(1);
  expect(await dialogsAsked(app)).toEqual([
    {
      message: 'Trust rozed-dev/e2e?',
      detail:
        'Language servers read this repo’s code and settings. They aren’t sandboxed. Trust only repos whose code you’d run.',
      buttons: ['Trust repo', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      // The window that asked.
      window: await (await app.browserWindow(page)).evaluate((browser) => browser.id),
    },
  ]);
  await expect(details(page)).toContainText('Language servers are off for rozed-dev/e2e');
  expect(trustedInFile()).toBeUndefined();
  // The window can't write it itself.
  expect(
    await page.evaluate(
      (entry) => window.lo.invoke('settings.set', { key: 'code.trusted', value: [entry] }),
      { repo: 'rozed-dev/e2e', id: E2E },
    ),
  ).toMatchObject({ ok: false, error: { code: 'unwritable' } });

  // Trusted: the entry, by the repository's ID, and the item gives way to the servers.
  await answerDialogs(app, 'Trust repo');
  await (await offer(page)).getByRole('button', { name: 'Trust repo…' }).click();
  await expect
    .poll(() => status(page, id), { timeout: 20_000 })
    .toMatchObject({ trust: { kind: 'trusted', by: 'repo' } });
  await expect(item(page)).toHaveCount(0, { timeout: 20_000 });
  expect(trustedInFile()).toEqual([
    { repo: 'rozed-dev/e2e', id: E2E, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
  ]);

  await page.evaluate(() => window.lo.invoke('tab.open', { kind: 'settings' }));
  const list = page.getByRole('list', { name: 'Trusted repos and pull requests' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('rozed-dev/e2e');
  await expect(list).toContainText(/Repo · trusted (just now|\d+ min ago)/);
  await list.getByRole('button', { name: 'Stop trusting rozed-dev/e2e' }).click();
  await expect(page.getByText('No trusted repos or pull requests')).toBeVisible();
  expect(trustedInFile()).toEqual([]);
  await expect
    .poll(() => status(page, id))
    .toMatchObject({ trust: { kind: 'untrusted', why: 'unnamed' } });

  // Trusted again, then taken out of the file by hand: Lo lets go of the repo's checkouts, here
  // one made as Lo's cache makes them.
  await answerDialogs(app, 'Trust repo');
  expect(
    await page.evaluate(
      (view) => window.lo.invoke('code.trust', { view, repo: 'rozed-dev/e2e', pull: null }),
      id,
    ),
  ).toEqual({ ok: true, value: 'trusted' });
  const checkout = join(cachePath(dataFolder()), 'checkouts', 'github.com', 'rozed-dev', 'e2e');
  mkdirSync(join(checkout, 'pull-80'), { recursive: true });
  writeFileSync(settingsPath(dataFolder()), '{ "code.trusted": [] }\n');
  await expect.poll(() => existsSync(join(checkout, 'pull-80')), { timeout: 20_000 }).toBe(false);
  await expect
    .poll(() => status(page, id))
    .toMatchObject({ trust: { kind: 'untrusted', why: 'unnamed' } });
});

test('says in the item’s details why it couldn’t trust the repo, offers the settings file, and trusts once that’s fixed', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const id = await open(page);
  // Left mid-edit, so Lo can't read it, and won't write it.
  const path = settingsPath(dataFolder());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{ "code.trusted": [\n');

  await answerDialogs(app, 'Trust repo');
  const shown = await offer(page);
  await shown.getByRole('button', { name: 'Trust repo…' }).click();
  const failed = shown.getByRole('alert').filter({ hasText: 'Couldn’t trust rozed-dev/e2e' });
  // Why in the window's words; the settings file's own error is behind Details.
  await expect(failed).toContainText('settings.json has an error.');
  expect(await dialogsAsked(app)).toHaveLength(1);
  // Said there, and not again in a note in the corner.
  await expect(page.getByText('Lo didn’t change code.trusted')).toHaveCount(0);
  expect(readFileSync(path, 'utf8')).toBe('{ "code.trusted": [\n');
  await expect(status(page, id)).resolves.toMatchObject({ trust: { kind: 'untrusted' } });

  await shown.getByRole('button', { name: 'Open settings.json' }).click();
  await expect.poll(opened).toEqual([realpathSync(path)]);

  // Fixed: what kept Lo from trusting it is past, and the details offer it again. Asked again, it's
  // trusted, and the item gives way to the servers.
  writeFileSync(path, '{}\n');
  await expect(failed).toHaveCount(0);
  const again = (await offer(page)).getByRole('button', { name: 'Trust repo…' });
  await expect(again).not.toHaveAttribute('aria-disabled', 'true');
  await again.click();
  await expect
    .poll(() => status(page, id), { timeout: 20_000 })
    .toMatchObject({ trust: { kind: 'trusted', by: 'repo' } });
  await expect(item(page)).toHaveCount(0, { timeout: 20_000 });
  expect(trustedInFile()).toEqual([
    { repo: 'rozed-dev/e2e', id: E2E, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
  ]);
});
