// Changing a merge queue from its tab: Lo, started on the replay server as rozed-bot, on generation
// 9 of `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as recorded from the app with
// writes while two of them were in `e4/queued`'s queue (`app_queue_act`), served with GitHub's
// answer to the overview ref read again added, as Lo reads it again when its window comes to the
// front (`app_queue_act_polled`). `J` on the second moves it to the front and `x` on the first
// removes it, each once its dialog says what it does and `⏎` confirms it; the first, at the front,
// has nowhere to move.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MERGE_PULLS, writeMergeRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';

const { pulls } = MERGE_PULLS[9];

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `cassette`, fetching
 * from generation 9's repository, built on this machine.
 */
const test = base.extend<{ cassette: string; github: ReplayServer; remote: string }>({
  cassette: ['app_queue_act_polled', { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    // `merge.sh` builds nothing inside a work tree, so not in the test's output folder.
    const folder = mkdtempSync(join(tmpdir(), 'lo-queueact-'));
    await use(writeMergeRemote(join(folder, 'remote'), 9));
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

/** The merge queue's tab on screen. */
const queue = (page: Page) => page.locator('[data-lo-scope="queue"]');

/** The queue's dialog. */
const dialog = (page: Page) => page.getByTestId('queue-confirm');

/** What Lo said in a toast, by some of its words. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

const first = `queued-${pulls.queuedSlow1.number}`;
const second = `queued-${pulls.queuedSlow2.number}`;

/** The keys of the queue's rows, in order. */
function rowKeys(page: Page): Promise<(string | null)[]> {
  return queue(page)
    .locator('[role="row"][data-key]')
    .evaluateAll((each) => each.map((row) => row.getAttribute('data-key')));
}

/**
 * Opens #259's tab once rozed-bot's account is added, then, once it has read all it reads as it
 * opens, as when it was recorded, its base branch's queue, with `gq`.
 */
async function openQueue(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    pulls.queuedSlow1.number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  const id = reply.value;
  await expect(
    page.locator('header.pr-header:visible').locator('button[aria-haspopup="dialog"]'),
  ).toContainText('Queued, 1st');
  await expect
    .poll(
      async () => {
        const revisions = await page.evaluate(
          (tab) => window.lo.invoke('revisions.list', { id: tab }),
          id,
        );
        return revisions.ok ? revisions.value : revisions;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ status: 'ready' });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('g');
  await page.keyboard.press('q');
  await expect(queue(page).locator(`[data-key="${second}"]`)).toBeVisible();
  expect(await rowKeys(page)).toEqual([first, second]);
}

/** Moves the keyboard to the row `key`, with `j` or `k`. */
async function focus(page: Page, key: string): Promise<void> {
  const grid = queue(page).getByRole('grid');
  const keys = await rowKeys(page);
  const now = (await grid.getAttribute('aria-activedescendant')) ?? '';
  const from = keys.findIndex((each) => now.endsWith(`-${each}`));
  const to = keys.indexOf(key);
  for (let step = from; step !== to; step += from < to ? 1 : -1) {
    await page.keyboard.press(from < to ? 'j' : 'k');
  }
  await expect(grid).toHaveAttribute('aria-activedescendant', new RegExp(`-${key}$`));
}

// Lo read the queue every 20 s as it was recorded, and GitHub listed the move two reads after the
// one Lo makes after a write; here it reads every 5 s. A read sooner than recorded before the move
// gets an answer that still holds the queue as it was, as GitHub's first two after it do.
test.use({ readEvery: 5_000 });

test('`J` moves a pull request to the front of the queue, and `x` takes one out, each once confirmed', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openQueue(page);
  // The front entry has nowhere to move.
  const front = queue(page).locator(`[data-key="${first}"]`);
  await expect(front.getByRole('button', { name: /Remove…/ })).toBeVisible();
  await expect(front.getByRole('button', { name: /Move to front…/ })).toHaveCount(0);
  await expect(
    front.getByRole('button', { name: `More actions for #${pulls.queuedSlow1.number}` }),
  ).toBeVisible();
  await focus(page, second);
  const row = queue(page).locator(`[data-key="${second}"]`);
  await expect(row.getByRole('button', { name: /Move to front…/ })).toBeVisible();
  await expect(row.getByRole('button', { name: /Remove…/ })).toBeVisible();

  await page.keyboard.press('Shift+J');
  await expect(dialog(page)).toContainText(`Move #${pulls.queuedSlow2.number} to front?`);
  const move = dialog(page).getByRole('button', { name: /Move to front/ });
  await expect(move).not.toHaveAttribute('aria-disabled', 'true');
  await expect(dialog(page)).toContainText('rozed-bot');
  await expect(dialog(page)).toContainText('2nd');
  await expect(dialog(page)).toContainText(
    'Checks start again for it and the pull requests tested with it.',
  );
  await page.keyboard.press('Enter');
  await expect(said(page, `Moved #${pulls.queuedSlow2.number} to 2nd`)).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => rowKeys(page), { timeout: 30_000 }).toEqual([second, first]);

  await focus(page, first);
  await page.keyboard.press('x');
  await expect(dialog(page)).toContainText(`Remove #${pulls.queuedSlow1.number} from merge queue?`);
  const remove = dialog(page).getByRole('button', { name: /Remove from merge queue/ });
  await expect(remove).not.toHaveAttribute('aria-disabled', 'true');
  await expect(dialog(page)).toContainText('2nd');
  await page.keyboard.press('Enter');
  await expect(said(page, `Removed #${pulls.queuedSlow1.number} from merge queue`)).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect(queue(page).locator(`[data-key="${first}"]`)).toBeHidden();
  await expect(queue(page).locator(`[data-key="${second}"]`)).toBeVisible();
});
