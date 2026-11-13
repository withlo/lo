// A pull request's timeline: shown from its diff with `, read from GitHub as it's first shown, its
// description, its push and its reviews drawn as rows, and moved through with j and k. Without git,
// so the tab has only what GitHub says.

import { writeFileSync } from 'node:fs';

import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';
import { serveBodies } from './bodies.ts';

/** The cassette, recorded from the app on rozed-dev/e2e#23: one push, and ten reviews. */
const CASSETTE = 'app_timeline';
const NUMBER = 23;

/** A stand-in token, never a real one: the cassette answers for it as rozed-bot. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{ github: ReplayServer; githubOrigin: string }>({
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay(CASSETTE);
    await use(server);
    await server.close();
  },
  githubOrigin: async ({ github }, use) => {
    const front = await serveBodies(CASSETTE, new URL(github.urls.api).origin);
    await use(front.origin);
    await front.close();
  },
  launch: async ({ githubOrigin }, use) => {
    const tokenFile = base.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: githubOrigin, LO_TEST_TOKEN_FILE: tokenFile, LO_GIT: 'none' },
    });
  },
});

// The diff, not the overview, is what the tab opens on.
test.use({ settings: DIFF_FIRST });

/** Waits for the account from the token file, then opens #23's tab. */
async function open(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (number) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
    NUMBER,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
}

/**
 * Waits for the middle view `id` to take focus, as each does once it's shown. A focus move drops
 * keys typed before it, so the next keys wait for it.
 */
async function focusedOn(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement
              ?.closest('[data-lo-middle-view]')
              ?.getAttribute('data-lo-middle-view') ?? null,
        ),
      { timeout: 20_000 },
    )
    .toBe(id);
}

test('` steps from the diff to the timeline, read as it’s first shown; j, k and Tab move through it, and a row’s menu acts on the row', async ({
  page,
}) => {
  await open(page);
  await focusedOn(page, 'diff.view');
  await page.keyboard.press('`');

  const timeline = page.getByRole('listbox', { name: 'Timeline' });
  await expect(timeline).toBeFocused({ timeout: 20_000 });
  const rows = timeline.getByRole('option');
  // The description, the push and each submitted review.
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText('opened this');
  await expect(rows.nth(0)).toContainText('Fixture E11 (review writes)');
  await expect(rows.nth(1)).toContainText('pushed 1 commit');
  await expect(rows.nth(1)).toContainText('5a48d22');
  await expect(rows.nth(1)).toContainText('test(e11): change lines in three places');
  await expect(rows.nth(2)).toContainText('left a review on r1');
  await expect(rows.nth(2)).toContainText(
    "Fixture E11: the pending review's summary, submitted as a comment.",
  );

  // The keyboard starts on the description, the first row.
  const on = async () => {
    const id = await timeline.getAttribute('aria-activedescendant');
    return id === null ? undefined : page.locator(`[id="${id}"]`).textContent();
  };
  await expect.poll(on).toContain('opened this');
  await page.keyboard.press('j');
  await expect.poll(on).toContain('pushed 1 commit');
  await page.keyboard.press('j');
  await expect.poll(on).toContain('left a review on r1');
  await page.keyboard.press('k');
  await expect.poll(on).toContain('pushed 1 commit');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  // k on the first row stays there, as in the app's other lists.
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await expect.poll(on).toContain('opened this');

  await test.step('Tab goes through the links and buttons of the row the keyboard is on, and Esc back to the list', async () => {
    // The fifth review left a comment in the diff.
    const review = rows.nth(6);
    await review.click();
    await expect(timeline).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(review.getByRole('button', { name: 'Show in the diff' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(timeline).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(review.getByRole('button', { name: 'Show in the diff' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(timeline).toBeFocused();
    await expect.poll(on).toContain('1 comment');
  });

  await test.step('` goes round from the timeline, the last middle view, to the overview, the first', async () => {
    await page.keyboard.press('`');
    await focusedOn(page, 'overview.view');
    await page.keyboard.press('~');
    await expect(timeline).toBeFocused();
  });

  await test.step('a row’s menu offers what its buttons do, and the keyboard’s row is the palette’s', async () => {
    const menu = page.getByRole('menu', { name: 'Row actions' });
    // A right-click on the push: the keyboard moves to it, and its menu has no review's actions.
    await rows.nth(1).click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: /Open on GitHub/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /comments in the diff/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect.poll(on).toContain('pushed 1 commit');
    // ⇧F10 on the review that left a comment: its menu shows it in the diff.
    for (let step = 0; step < 5; step += 1) await page.keyboard.press('j');
    await expect.poll(on).toContain('1 comment');
    await page.keyboard.press('Shift+F10');
    await menu.getByRole('menuitem', { name: /Show the review’s comments in the diff/ }).click();
    await focusedOn(page, 'diff.view');
  });
});
