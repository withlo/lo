// A pull request in a merge queue: Lo, started on the replay server as rozed-bot, on generation 6
// of `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e. `app_queued` was recorded from
// the app while one was first in `e4/queued`'s queue and another behind it: the header says the
// place, the merge panel says it again with the queue a key away, and the panel of one ready for
// the queue says what's ahead of it. `app_queued_left` was recorded as the queue failed the one
// behind and GitHub took it out: the header says it's leaving, then a banner says it left, and
// opens the panel, whose first row says why. Each is served with GitHub's answer to
// each overview ref read again added (`app_queued_polled`, `app_queued_left_polled`), as Lo reads
// one again when its window comes to the front.

import type { Page } from '@playwright/test';

import { expect, onQueued as test, QUEUED, tabBanners } from './app.ts';

const { pulls } = QUEUED;

/** Opens pull request `number`'s tab, once the account from the token file is added. */
async function open(page: Page, number: number): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
}

/** The header of the tab on screen. */
const header = (page: Page) => page.locator('header.pr-header:visible');

/** The header's merge status, while it opens the panel. */
const status = (page: Page) => header(page).locator('button[aria-haspopup="dialog"]');

/** The merge panel, once open. */
const panel = (page: Page) => page.locator('[data-lo-scope="merge"]');

/** The merge queue's tab on screen. */
const queue = (page: Page) => page.locator('[data-lo-scope="queue"]');

test('a queued pull request says its place, and its panel the queue it’s in, a key away', async ({
  page,
}) => {
  await open(page, pulls.queuedSlow1.number);
  // Its place and when GitHub expects it to merge, from the queue Lo reads while it's on screen.
  await expect(status(page)).toContainText('Queued, 1st');
  await expect(status(page)).toContainText('about 11 min');
  await page.keyboard.press('m');
  await expect(panel(page)).toContainText('In the merge queue for e4/queued · 1st');
  await expect(panel(page)).toContainText('Squash, set by the merge queue');
  const see = panel(page).getByRole('button', { name: /^Merge queue/ });
  await expect(see).toContainText('gq');
  await see.click();
  await expect(panel(page)).toBeHidden();
  await expect(
    queue(page).locator(`[data-key="queued-${pulls.queuedSlow1.number}"]`),
  ).toBeVisible();
});

test('the panel of one ready for the queue says what’s ahead of it', async ({ page }) => {
  await open(page, pulls.queuedPass.number);
  await expect(status(page)).toContainText('Ready for merge queue');
  await page.keyboard.press('m');
  await expect(panel(page)).toContainText(
    'e4/queued has a merge queue · 2 ahead · merges in about 11 min',
  );
});

test.describe('once the queue fails one', () => {
  test.use({ cassette: 'app_queued_left_polled' });

  test('it’s leaving, then a banner says it left, and opens the panel, which says why', async ({
    page,
  }) => {
    // Lo reads its pull request every 20 s, and GitHub took it out about a minute later.
    test.setTimeout(120_000);
    await open(page, pulls.queuedFail.number);
    await expect(status(page)).toContainText('Leaving merge queue');
    await expect(status(page)).toContainText('ci failed');
    await page.keyboard.press('m');
    const first = panel(page).locator('[role="option"]').first();
    await expect(first).toHaveAttribute('data-key', 'queue-removal');
    await expect(first).toContainText('1 check failed in the merge queue');
    await page.keyboard.press('Escape');

    // The banner's one line; the panel's first row says why.
    const banner = tabBanners(page).getByText(`#${pulls.queuedFail.number} left the merge queue`);
    await expect(banner).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: /^Merge panel/ }).click();
    await expect(first).toHaveAttribute('data-key', 'left');
    await expect(first).toContainText('1 check failed in the merge queue.');
    await expect(first.getByRole('button', { name: /^Open in browser/ })).toBeVisible();
  });
});
