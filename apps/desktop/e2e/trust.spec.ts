// Trust in the app, on rozed-dev/e2e#80, which nothing trusts: its tab says language servers are
// off, and a dismissal holds after Lo starts again; "Trust this repo" trusts it only once main's
// own dialog, answered here as the reader would, says "Trust", and Settings lists it until it's
// removed there; taken out of the file by hand, its checkouts go too. GitHub answers from
// `app_e2e`, and the repository's IDs, which Lo reads only once the reader asks to trust it, from
// `pull_request_repositories_e2e`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  drawnWindow,
  expect,
  KEYCHAIN,
  settingsPath,
  test as base,
} from './app.ts';

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';
/** rozed-dev/e2e's node ID, as GitHub gave it. */
const E2E = 'R_kgDOVleUfQ';

const test = base.extend<{ github: ReplayServer; env: Record<string, string> }>({
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
  env: async ({ github }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      LO_GITHUB: new URL(github.urls.api).origin,
      LO_TEST_TOKEN_FILE: tokenFile,
      LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
    });
  },
  launch: async ({ env }, use) => {
    await use({ args: [appFolder, ...KEYCHAIN], env });
  },
});

/** The banner saying language servers are off for rozed-dev/e2e. */
const banner = (page: Page) =>
  page
    .locator('[data-lo-banners]')
    .getByRole('status')
    .filter({ hasText: 'Language servers are off for rozed-dev/e2e.' });

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

test('says language servers are off on a repo nothing trusts, until dismissed, after a restart too', async ({
  app,
  page,
  env,
  github,
}) => {
  test.setTimeout(90_000);
  const id = await open(page);
  await expect(banner(page)).toContainText('Lo runs them only on repos you trust.');
  await expect(banner(page).getByRole('button', { name: 'Trust this repo' })).toBeVisible();
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect.poll(() => status(page, id)).toMatchObject({ dismissed: true });
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
    // The tab comes back, as untrusted as it was, offline, and the banner doesn't.
    await expect
      .poll(() => status(shown, id), { timeout: 20_000 })
      .toMatchObject({ trust: { kind: 'untrusted', why: 'unnamed' }, dismissed: true });
    await expect(shown.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(banner(shown)).toHaveCount(0);
  } finally {
    await again.close();
  }
});

test('trusts the repo only once main’s own dialog says Trust, and Settings lists it until it’s removed', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const id = await open(page);

  // Cancelled: nothing is trusted, and the banner stays.
  await answerDialogs(app, 'Cancel');
  await banner(page).getByRole('button', { name: 'Trust this repo' }).click();
  await expect.poll(async () => (await dialogsAsked(app)).length).toBe(1);
  expect(await dialogsAsked(app)).toEqual([
    {
      message: 'Trust rozed-dev/e2e?',
      detail:
        'Lo will check out its pull requests and run language servers on them. The servers read its code and settings. Lo limits what they run, but they aren’t sandboxed. The repo’s settings can still steer them. A file that exploits a bug in one could run code as you.',
      buttons: ['Trust', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      // The window that asked.
      window: await (await app.browserWindow(page)).evaluate((browser) => browser.id),
    },
  ]);
  await expect(banner(page)).toBeVisible();
  expect(trustedInFile()).toBeUndefined();
  // The window can't write it itself.
  expect(
    await page.evaluate(
      (entry) => window.lo.invoke('settings.set', { key: 'code.trusted', value: [entry] }),
      { repo: 'rozed-dev/e2e', id: E2E },
    ),
  ).toMatchObject({ ok: false, error: { code: 'unwritable' } });

  // Trusted: the entry, by the repository's ID, and the banner goes.
  await answerDialogs(app, 'Trust');
  await banner(page).getByRole('button', { name: 'Trust this repo' }).click();
  await expect
    .poll(() => status(page, id), { timeout: 20_000 })
    .toMatchObject({ trust: { kind: 'trusted', by: 'repo' } });
  await expect(banner(page)).toHaveCount(0);
  expect(trustedInFile()).toEqual([
    { repo: 'rozed-dev/e2e', id: E2E, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
  ]);

  await page.evaluate(() => window.lo.invoke('tab.open', { kind: 'settings' }));
  const list = page.getByRole('list', { name: 'Trusted repos and PRs' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('rozed-dev/e2e');
  await expect(list).toContainText('Repo · trusted today');
  await list.getByRole('button', { name: 'Remove rozed-dev/e2e' }).click();
  await expect(page.getByText('Nothing is trusted yet.')).toBeVisible();
  expect(trustedInFile()).toEqual([]);
  await expect
    .poll(() => status(page, id))
    .toMatchObject({ trust: { kind: 'untrusted', why: 'unnamed' } });

  // Trusted again, then taken out of the file by hand: Lo lets go of the repo's checkouts, here
  // one made as Lo's cache makes them.
  await answerDialogs(app, 'Trust');
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
