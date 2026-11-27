// Whether a pull request can merge: Lo, started on the replay server as rozed-bot, on a generation
// of `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as `app_merge` recorded from the
// app. The header says, in a line, whether one can merge, and gives up its branches and that line's
// detail whole as the window narrows. `m` opens the merge panel under it, with a row for
// each reason; `j` and `k` move between them, `o` opens a check's run, and `Esc` closes it. The
// status's right-click menu opens the panel too, and a reason's opens its page. On one
// that's ready, `Tab` steps through the methods, and a squash shows the commit GitHub would write.
// A tab acting as nobody reads nothing, and says why.

import type { Page } from '@playwright/test';

import { browsed, expect, MERGE, onMerge as test, sizeWindow } from './app.ts';

const { pulls } = MERGE;

/** Opens pull request `number`'s tab, once the account from the token file is added if `account`. */
async function open(page: Page, number: number, account = true): Promise<string> {
  if (account) {
    await expect
      .poll(async () =>
        JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))),
      )
      .toContain('rozed-bot');
  }
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** The header of the tab on screen. */
const header = (page: Page) => page.locator('header.pr-header:visible');

/** The header's merge status, while it opens the panel. */
const status = (page: Page) => header(page).locator('button[aria-haspopup="dialog"]');

/** The merge panel, once open. */
const panel = (page: Page) => page.locator('[data-lo-scope="merge"]');

/** The panel's reasons, by their keys. */
const reasons = (page: Page) => panel(page).locator('[role="option"]');

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('the header gives up its branches and the merge status its detail whole as the window narrows, and has them back as it widens; `m` opens the panel on its reasons, `j` and `k` move, `o` opens a check’s run, `Esc` closes it, and right-click menus do the same', async ({
  app,
  page,
}) => {
  await open(page, pulls.gatedFailing.number);
  await expect(status(page)).toContainText('Can’t merge');

  await test.step('the header gives up its branches and the detail whole as the window narrows, and has them back as it widens', async () => {
    const detail = status(page).locator('[data-gives="detail"]');
    await expect(detail).toHaveText('1 check failed · 1 unresolved · review required');
    // Given up, the detail is out of sight, still there to be heard: nothing else says it.
    const drawnWidth = () => detail.evaluate((each) => each.getBoundingClientRect().width);
    // The branches, each a chip, and the words and the arrow between them.
    const branches = header(page).locator('[data-gives="branches"]');
    await expect(branches.first()).toBeVisible();
    const shown = () =>
      branches.evaluateAll((each) => each.filter((one) => one.getClientRects().length > 0).length);
    const all = await branches.count();
    expect(await shown()).toBe(all);

    // Narrow, each goes whole, never cut to a letter.
    await sizeWindow(app, 760, 800);
    await expect.poll(drawnWidth).toBeLessThanOrEqual(1);
    // Still part of what the status says: gone from the page, it wouldn't be.
    await expect(status(page)).toHaveAccessibleName(
      /1 check failed · 1 unresolved · review required/,
    );
    await expect.poll(shown).toBe(0);
    // Wide again, both come back, though nothing in their rows was drawn again.
    await sizeWindow(app, 1440, 900);
    await expect.poll(drawnWidth).toBeGreaterThan(1);
    await expect.poll(shown).toBe(all);
  });

  await page.keyboard.press('m');
  await expect(panel(page)).toBeVisible();
  await expect(status(page)).toHaveAttribute('aria-expanded', 'true');
  const keys = await reasons(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-key')),
  );
  expect(keys[0]).toBe('checks-failed');
  expect(keys).toContain('conversations');
  expect(keys).toContain('approvals');
  const focused = panel(page).locator('[role="option"][data-focused]');
  await expect(focused).toHaveAttribute('data-key', 'checks-failed');

  await page.keyboard.press('j');
  await expect(focused).toHaveAttribute('data-key', keys[1] ?? '');
  await page.keyboard.press('k');
  await expect(focused).toHaveAttribute('data-key', 'checks-failed');

  // `o` on the failed check opens its run on GitHub, in the system's browser.
  await page.keyboard.press('o');
  await expect
    .poll(browsed)
    .toEqual([expect.stringMatching(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//)]);

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(status(page)).toHaveAttribute('aria-expanded', 'false');

  // The status's right-click menu opens the panel, and a reason's opens its page.
  await status(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Merge panel/ }).click();
  await expect(panel(page)).toBeVisible();
  await reasons(page).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Open in browser/ }).click();
  await expect.poll(() => browsed().length).toBe(2);
  // Choosing from a menu over the panel leaves it open.
  await expect(panel(page)).toBeVisible();
});

test('`Tab` steps through the methods, and a squash shows the commit GitHub would write', async ({
  page,
}) => {
  await open(page, pulls.squash.number);
  await expect(status(page)).toContainText('Ready to merge');
  await page.keyboard.press('m');
  await expect(panel(page)).toBeVisible();
  const methods = panel(page).getByRole('radio');
  await expect(methods).toHaveText(['Merge commit', 'Squash', 'Rebase']);
  const chosen = panel(page).locator('[role="radio"][aria-checked="true"]');

  // Round to the squash, whichever the panel opened on.
  for (let step = 0; step < 3 && (await chosen.textContent()) !== 'Squash'; step++) {
    await page.keyboard.press('Tab');
  }
  await expect(chosen).toHaveText('Squash');
  const title = panel(page).getByRole('textbox').first();
  await expect(title).toHaveAttribute(
    'placeholder',
    `Fixture M6: squash and merge (#${pulls.squash.number})`,
  );
  // The main button names the pull request, not the method.
  await expect(
    panel(page).getByRole('button', { name: new RegExp(`Merge #${pulls.squash.number}…`) }),
  ).toBeVisible();

  // `Shift+Tab` steps back.
  await page.keyboard.press('Shift+Tab');
  await expect(chosen).not.toHaveText('Squash');

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

test.describe('acting as nobody', () => {
  test.use({ account: false });

  test('a tab shows nothing of whether it can merge, and `m` says why', async ({ page }) => {
    await open(page, pulls.squash.number, false);
    await expect(header(page)).toContainText('Fixture M6: squash and merge');
    await expect(status(page)).toHaveCount(0);
    await page.keyboard.press('m');
    await expect(said(page, 'Sign in to merge')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});
