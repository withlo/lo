// Merging a pull request: Lo, started on the replay server as rozed-bot, on generation 5 of
// `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as `app_merge_write` recorded from
// the app with writes. `⏎` in the merge panel opens the confirmation in its place, saying who
// merges, how, into what and which revision; a held `⏎` confirms nothing, and a fresh one merges
// with the method shown, the squash commit's title as typed, and a toast once GitHub merged it.
// A head that moved just before the press is merged by nobody: GitHub fails it, and the dialog says
// so. With GitHub's answer lost (`app_merge_write_lost`), Lo reads the pull request to tell, and
// never sends the merge again. Into `e4/queued`, `⏎` adds it to the merge queue
// (`app_merge_enqueue`).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MERGE_PULLS, writeMergeRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** The generation `app_merge_write` was recorded on. */
const { pulls } = MERGE_PULLS[5];

/** How long GitHub's recorded answers keep a merge pending, as Lo asks after 1 s, 2 s and 4 s. */
const MERGING = 20_000;

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `cassette`,
 * `app_merge_write` unless a test says, and fetching from the generation's repository, built on
 * this machine, with `moved`'s newer push.
 */
const test = base.extend<{ cassette: string; github: ReplayServer; remote: string }>({
  cassette: ['app_merge_write', { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    // `merge.sh` builds nothing inside a work tree, so not in the test's output folder.
    const folder = mkdtempSync(join(tmpdir(), 'lo-merging-'));
    await use(writeMergeRemote(join(folder, 'remote'), 5, { pushed: true }));
    rmSync(folder, { recursive: true, force: true });
  },
  launch: async ({ github, remote }, use) => {
    const tokenFile = base.info().outputPath('token');
    writeFileSync(tokenFile, 'gho_FAKE_E2E_ACCOUNT\n');
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
      },
    });
  },
});

/** Opens pull request `number`'s tab once rozed-bot's account is added, and its merge panel. */
async function panelOf(page: Page, number: number, ready = 'Ready to merge'): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  await expect(status(page)).toContainText(ready);
  await page.keyboard.press('m');
  await expect(panel(page)).toBeVisible();
}

/** The header's merge status, while it opens the panel. */
const status = (page: Page) =>
  page.locator('header.pr-header:visible').locator('button[aria-haspopup="dialog"]');

/** The merge panel, once open. */
const panel = (page: Page) => page.locator('[data-lo-scope="merge"]');

/** The merge's dialog. */
const dialog = (page: Page) => page.getByTestId('merge-confirm');

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Steps the panel's method round to `method`, whichever it opened on. */
async function roundTo(page: Page, method: string): Promise<void> {
  const chosen = panel(page).locator('[role="radio"][aria-checked="true"]');
  await expect(chosen).toBeVisible();
  for (let step = 0; step < 3 && (await chosen.textContent()) !== method; step++) {
    await page.keyboard.press('Tab');
  }
  await expect(chosen).toHaveText(method);
}

/** The dialog's facts, as label and value. */
async function facts(page: Page): Promise<Record<string, string>> {
  return dialog(page).evaluate((box) =>
    Object.fromEntries(
      [...box.querySelectorAll('dt')].map((label) => [
        label.textContent ?? '',
        label.nextElementSibling?.textContent ?? '',
      ]),
    ),
  );
}

test('`⏎` confirms a squash with the title typed, never on a held key, and a toast says it merged', async ({
  page,
}) => {
  const { number } = pulls.squash;
  await panelOf(page, number);
  await roundTo(page, 'Squash');
  await page.keyboard.press('e');
  await page.keyboard.type('Squash two commits, from Lo');
  await page.keyboard.press('Escape');

  // Held down, `⏎` opens the confirmation, and its repeats confirm nothing.
  await page.keyboard.down('Enter');
  await expect(dialog(page)).toContainText(`Merge #${number} into merge/5/base?`);
  await expect(panel(page)).toBeHidden();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  expect(await facts(page)).toMatchObject({
    As: expect.stringContaining('rozed-bot'),
    Method: 'Squash',
    Into: 'merge/5/base',
    Commit: 'Squash two commits, from Lo',
  });
  await expect(dialog(page)).toContainText('Lo deletes no branches');
  await expect(dialog(page).getByRole('button', { name: /Squash and merge/ })).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(said(page, `Merged #${number} into merge/5/base`)).toBeVisible({ timeout: MERGING });
  await expect(dialog(page)).toBeHidden();
});

// Each was recorded from a copy of Lo of its own, so each has one.
for (const [{ number }, method, button] of [
  [pulls.merge, 'Merge commit', /^Merge\b/],
  [pulls.rebase, 'Rebase', /^Rebase and merge/],
] as const) {
  test(`a ${method.toLowerCase()} goes with the method the panel shows`, async ({ page }) => {
    await panelOf(page, number);
    await roundTo(page, method);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText(`Merge #${number} into merge/5/base?`);
    expect(await facts(page)).toMatchObject({ Method: method, Into: 'merge/5/base' });
    await expect(dialog(page).getByRole('button', { name: button })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(said(page, `Merged #${number} into merge/5/base`)).toBeVisible({
      timeout: MERGING,
    });
  });
}

test('a merge whose head moved just before the press fails, and the dialog says so', async ({
  page,
}) => {
  const { number } = pulls.moved;
  await panelOf(page, number);
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toContainText(`Merge #${number} into merge/5/base?`);
  await page.keyboard.press('Enter');
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toContainText(`Couldn’t merge #${number}.`);
  await expect(alert).toContainText('Pull Request is not mergeable');

  // Seen in the dialog, it leaves no banner.
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText(`Couldn’t merge #${number}.`)).toHaveCount(0);
});

test.describe('with GitHub’s answer to the merge lost', () => {
  test.use({ cassette: 'app_merge_write_lost' });

  test('Lo reads the pull request to tell, and never sends the merge again', async ({
    page,
    github,
  }) => {
    const { number } = pulls.moved;
    await panelOf(page, number);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText(`Merge #${number} into merge/5/base?`);
    await page.keyboard.press('Enter');
    const alert = dialog(page).getByRole('alert');
    await expect(alert).toContainText(`Lo can’t tell whether #${number} merged.`);
    await expect(alert).toContainText('GitHub shows it open.');

    // Asking again is a read.
    await dialog(page)
      .getByRole('button', { name: /Ask GitHub again/ })
      .click();
    await expect(alert).toContainText('GitHub shows it open.');
    const merges = github.replay.seen.filter(
      ({ method, url }) => method === 'PUT' && url.endsWith(`/pulls/${number}/merge-async`),
    );
    expect(merges).toHaveLength(1);
  });
});

test.describe('into a branch with a merge queue', () => {
  test.use({ cassette: 'app_merge_enqueue' });

  test('`⏎` then `⏎` adds it to the queue, whose settings choose the method', async ({ page }) => {
    const { number } = pulls.queuedSlow1;
    await panelOf(page, number, 'Ready for the queue');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText(`Add #${number} to the merge queue for e4/queued?`);
    await expect(dialog(page)).toContainText('The queue’s settings choose the method');
    expect(await facts(page)).toMatchObject({ Into: 'e4/queued' });
    await page.keyboard.press('Enter');
    await expect(said(page, `Added #${number} to the merge queue for e4/queued`)).toBeVisible({
      timeout: MERGING,
    });
  });
});
