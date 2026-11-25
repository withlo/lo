// A branch's merge queue in a tab of its own: Lo, started on the replay server as rozed-bot, on
// generation 4 of `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as `app_queue`
// recorded from the app while two of them were tested together in `e4/queued`'s queue and a third
// waited to join it with auto-merge on. `gq` in a pull request's tab opens the queue of the branch
// it goes into, in one tab for the repository and account; `j` and `k` move, `⏎` or a double click
// opens the pull request, and `Tab` shows the next branch's queue. It's served as
// `app_queue_polled`, which adds GitHub's answer to each overview ref read again, as Lo does when
// its window comes to the front.

import type { Page } from '@playwright/test';

import { expect, onQueue as test, QUEUE } from './app.ts';

const { pulls } = QUEUE;

const cmd = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Waits until Lo has added the account from the token file. */
async function signedIn(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
}

/**
 * Opens pull request `number`'s tab, and waits for its header and its merge status, which it has
 * once it knows the account it acts as, and so the base branch's queue to open.
 */
async function open(page: Page, number: number, title: string, status: string): Promise<void> {
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  await expect(header(page)).toContainText(title);
  await expect(header(page).locator('button[aria-haspopup="dialog"]')).toContainText(status);
}

/** The header of the pull request's tab on screen. */
const header = (page: Page) => page.locator('header.pr-header:visible');

/** The merge queue's tab on screen. */
const queue = (page: Page) => page.locator('[data-lo-scope="queue"]');

/** The keys of the queue's rows, in order, once it has some. */
async function rowKeys(page: Page): Promise<(string | null)[]> {
  const rows = queue(page).locator('[role="row"][data-key]');
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((each) => each.map((row) => row.getAttribute('data-key')));
}

/** `gq`, typed. */
async function gq(page: Page): Promise<void> {
  await page.keyboard.press('g');
  await page.keyboard.press('q');
}

const slow1 = `queued-${pulls.queuedSlow1.number}`;
const passing = `queued-${pulls.queuedPass.number}`;
const slow2 = `waiting-${pulls.queuedSlow2.number}`;

test('`gq` opens the queue of the branch a pull request goes into, those tested together grouped and those waiting to join below', async ({
  page,
}) => {
  await signedIn(page);
  await open(page, pulls.queuedSlow1.number, 'Fixture M4: queued, slow (1)', 'Queued, 1st');
  await gq(page);
  const top = queue(page).locator('header');
  await expect(top.getByRole('heading', { name: 'Merge queue' })).toBeVisible();
  await expect(top).toContainText('rozed-dev/e2e into');
  await expect(top).toContainText('e4/queued');
  // The queue's own method: its entries squash, though GitHub says the auto-merge is a merge.
  await expect(top).toContainText('Squash · groups of up to 5');
  await expect(top).toContainText('as rozed-bot');
  await expect(page).toHaveTitle('rozed-dev/e2e · Merge queue for e4/queued');

  expect(await rowKeys(page)).toEqual([slow1, passing, slow2]);
  const group = queue(page).locator('[role="rowgroup"][aria-label^="Testing together"]');
  await expect(group).toHaveAttribute('aria-label', 'Testing together, 2 pull requests');
  await expect(
    group.locator(`[data-key="${slow1}"]`).getByText('you', { exact: true }),
  ).toBeVisible();
  const joining = queue(page).locator('[role="rowgroup"][aria-label="Waiting to join"]');
  await expect(joining).toContainText('Fixture M4: queued, slow (2)');
  await expect(joining).toContainText('Auto-merge is on');
  await expect(joining).toContainText('checks running');

  // The row the keyboard is on shows its actions, and the status bar a button for each key.
  await expect(
    group.locator(`[data-key="${slow1}"]`).getByRole('button', { name: /Remove…/ }),
  ).toBeVisible();
  const hints = queue(page).locator('footer');
  for (const hint of ['Open', 'Remove…', 'Open on GitHub']) {
    await expect(hints.getByRole('button', { name: hint, exact: true })).toBeVisible();
  }
});

test('`j` and `k` move, `⏎` opens the pull request the keyboard is on, and `Tab` shows the next branch’s queue', async ({
  page,
}) => {
  await signedIn(page);
  await open(page, pulls.squash.number, 'Fixture M4: squash and merge', 'Ready to merge');
  await gq(page);
  await expect(queue(page).getByText('merge/4/base has no merge queue')).toBeVisible();

  // The queue of another branch shows in the same tab, which offers both.
  await open(page, pulls.queuedSlow1.number, 'Fixture M4: queued, slow (1)', 'Queued, 1st');
  await gq(page);
  expect(await rowKeys(page)).toEqual([slow1, passing, slow2]);
  const branches = queue(page).getByRole('tablist', { name: 'Branch' }).getByRole('tab');
  await expect(branches).toHaveText(['e4/queued2', 'merge/4/base']);
  await expect(page.getByRole('tab', { name: /Merge queue/ })).toHaveCount(1);

  const grid = queue(page).getByRole('grid');
  await expect(grid).toHaveAttribute('aria-activedescendant', new RegExp(`-${slow1}$`));
  await page.keyboard.press('j');
  await expect(grid).toHaveAttribute('aria-activedescendant', new RegExp(`-${passing}$`));
  await page.keyboard.press('k');
  await expect(grid).toHaveAttribute('aria-activedescendant', new RegExp(`-${slow1}$`));
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(header(page)).toContainText('Fixture M4: queued, passing');
  await expect(header(page).locator('button[aria-haspopup="dialog"]')).toContainText('Queued, 2nd');

  // Back in the queue's tab, the second, `Tab` shows the next branch's, and round again.
  await page.keyboard.press(`${cmd}+Digit2`);
  await expect(grid).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(queue(page)).toContainText('merge/4/base has no merge queue');
  await expect(branches.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  expect(await rowKeys(page)).toContain(slow1);
  await expect(branches.nth(0)).toHaveAttribute('aria-selected', 'true');

  // A double click opens a row's pull request, as `⏎` does.
  await queue(page)
    .locator(`[data-key="${slow1}"]`)
    .getByText('Fixture M4: queued, slow (1)')
    .dblclick();
  await expect(header(page)).toContainText('Fixture M4: queued, slow (1)');
});
