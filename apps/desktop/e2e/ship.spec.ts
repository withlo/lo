// Approve and ship: Lo, started on the replay server as rozed-bot, on generation 10 of
// `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as recorded from the app with
// writes. `⌘⇧⏎` on a pull request rozed-bot opened approves nothing and merges it from one
// confirmation (`app_merge_ship`, served a stage at a time, so however long Lo takes to look up the
// merged pull requests, it reads the pull request as it was until it merges it); into `e4/queued`,
// while its `ci` runs, it turns on "Merge when ready" (`app_merge_ship_queued`). From derived
// answers, as GitHub takes no approval from a pull request's author: on one someone else opened it
// approves the revision on screen, then turns on "Merge when ready"
// (`app_merge_ship_queued_others`), or stops after approving, saying so, when GitHub then reads it
// as conflicting (`app_merge_ship_queued_conflict`); a push after the plan stops it before
// approving (`app_merge_ship_queued_moved`); and a push once "Merge when ready" is on has the watch
// turn auto-merge off (`app_merge_ship_watched`).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MERGE_PULLS, writeMergeRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';
import { type Asked, Staged } from './staged.ts';

const { pulls } = MERGE_PULLS[10];

/** How long GitHub's recorded answers keep a merge pending, as Lo asks after 1 s, 2 s and 4 s. */
const MERGING = 20_000;

/** How long Lo waits to look up the merged pull requests one listing left out: 2 minutes at most. */
const LOOKUPS = 150_000;

/** Whether a request merges a pull request. */
function merging({ method, url }: Asked): boolean {
  return method === 'PUT' && new URL(url).pathname.endsWith('/merge-async');
}

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `cassette`, a stage
 * at a time when `staged` says, each ending with a merge (`./staged.ts`), and a read Lo makes
 * sooner than recorded getting its first answer, fetching from generation 10's repository, built
 * on this machine.
 */
const test = base.extend<{
  cassette: string;
  staged: boolean;
  github: ReplayServer;
  remote: string;
}>({
  cassette: ['app_merge_ship', { option: true }],
  staged: [false, { option: true }],
  github: async ({ cassette, staged }, use) => {
    const server = await serveReplay(
      staged ? new Staged(cassette, merging, { sooner: true }) : cassette,
    );
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    // `merge.sh` builds nothing inside a work tree, so not in the test's output folder.
    const folder = mkdtempSync(join(tmpdir(), 'lo-ship-'));
    await use(writeMergeRemote(join(folder, 'remote'), 10));
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

/** The header's merge status. */
const status = (page: Page) =>
  page.locator('header.pr-header:visible').locator('button[aria-haspopup="dialog"]');

/** `⌘⇧⏎`, which is Ctrl+Shift+Enter on Linux. */
const SHIP = process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter';

/** Approve and ship's dialog. */
const dialog = (page: Page) => page.getByTestId('ship-confirm');

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Its steps, a line each. */
const steps = (page: Page) => dialog(page).getByRole('listitem');

/** Opens pull request `number`'s tab once rozed-bot's account is added. */
async function open(page: Page, number: number, shown: string): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  await expect(status(page)).toContainText(shown);
}

/**
 * `⌘⇧⏎`, until Lo plans it. Lo places a pull request on a branch other than a trunk only once it
 * has looked up every merged pull request its stacks may link through, and rozed-dev/e2e has more
 * branches than one listing looks up: the rest are looked up a while later, as recorded. Until
 * then each press is refused, saying so, which can close the dialog before it's seen, and it
 * presses again once that note goes, so the next note is the next press's own. Anything else
 * fails.
 */
async function ship(page: Page, number: number): Promise<void> {
  const planned = `Approve and ship #${number}?`;
  const refused = said(page, 'looked up yet');
  const deadline = Date.now() + LOOKUPS;
  for (;;) {
    await page.keyboard.press(SHIP);
    await expect
      .poll(async () => (await dialog(page).isVisible()) || (await refused.isVisible()))
      .toBe(true);
    if (await dialog(page).isVisible()) {
      // Planned, or refused, which closes the dialog and says why. Its text is read in one call
      // that doesn't wait: a dialog that closed after a check that it's open would leave
      // `textContent` waiting for one to come back, past the poll's own time.
      await expect
        .poll(async () => (await dialog(page).allTextContents())[0] ?? 'closed', {
          timeout: 30_000,
        })
        .toMatch(new RegExp(`${planned.replace('?', '\\?')}|^closed$`));
      if (await dialog(page).isVisible()) break;
    }
    await expect(refused).toBeVisible();
    if (Date.now() > deadline) break;
    await expect(refused).toBeHidden({ timeout: 10_000 });
  }
  await expect(dialog(page)).toContainText(planned);
}

/** Lo's GraphQL writes so far, by operation. */
function writes(github: ReplayServer, operation: string): number {
  return github.replay.seen.filter(({ body }) =>
    new TextDecoder().decode(body).includes(`mutation ${operation}`),
  ).length;
}

/** Lo's merges of pull request `number` so far. */
function merges(github: ReplayServer, number: number): number {
  return github.replay.seen.filter(
    ({ method, url }) => method === 'PUT' && url.endsWith(`/pulls/${number}/merge-async`),
  ).length;
}

test.describe('on your own pull request', () => {
  test.use({ staged: true });

  test('`⌘⇧⏎` approves nothing and merges it, from one confirmation', async ({ page, github }) => {
    test.setTimeout(LOOKUPS + 60_000);
    const { number } = pulls.squash;
    await open(page, number, 'Ready to merge');
    await ship(page, number);
    await expect(steps(page).nth(0)).toContainText('Check that r1 is still the newest push');
    await expect(steps(page).nth(1)).toContainText(
      'It’s your pull request, so GitHub takes no approval from you.',
    );
    await expect(steps(page).nth(2)).toContainText('into merge/10/base');
    await expect(dialog(page).getByRole('button', { name: /^Ship/ })).toBeVisible();
    expect(merges(github, number)).toBe(0);

    await page.keyboard.press('Enter');
    await expect(said(page, `Merged #${number} into merge/10/base`)).toBeVisible({
      timeout: MERGING,
    });
    await expect(dialog(page)).toBeHidden();
    expect(merges(github, number)).toBe(1);
    expect(writes(github, 'AddPullRequestReview')).toBe(0);
  });
});

test.describe('into a branch with a merge queue, while its checks run', () => {
  test.use({ cassette: 'app_merge_ship_queued' });

  test('`⌘⇧⏎` turns on “Merge when ready”', async ({ page, github }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await expect(steps(page).nth(2)).toContainText(
      'Merge when ready, through the merge queue for e4/queued',
    );
    await page.keyboard.press('Enter');
    await expect(
      said(page, `#${number} joins the merge queue for e4/queued once it’s ready`),
    ).toBeVisible({ timeout: MERGING });
    await expect(status(page)).toContainText('Merges when ready');
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(1);
    expect(writes(github, 'AddPullRequestReview')).toBe(0);
  });
});

test.describe('on a pull request someone else opened', () => {
  test.use({ cassette: 'app_merge_ship_queued_others' });

  test('`⌘⇧⏎` approves the revision on screen, then turns on “Merge when ready”', async ({
    page,
    github,
  }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await expect(steps(page).nth(1)).toContainText('Approve as rozed-bot');
    // Your approval outlives a push: the confirmation says so, and that Lo watches for one.
    await expect(dialog(page)).toContainText('turns auto-merge off if someone pushes');
    await expect(dialog(page).getByRole('button', { name: /Approve and ship/ })).toBeVisible();
    expect(writes(github, 'AddPullRequestReview')).toBe(0);

    await page.keyboard.press('Enter');
    await expect(said(page, `Approved #${number}.`)).toBeVisible({ timeout: MERGING });
    expect(writes(github, 'AddPullRequestReview')).toBe(1);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(1);
    await expect(status(page)).toContainText('Merges when ready');
  });
});

test.describe('when someone pushes once “Merge when ready” is on', () => {
  test.use({ cassette: 'app_merge_ship_watched' });

  test('Lo turns auto-merge off, so the push doesn’t merge with your approval', async ({
    page,
    github,
  }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^Lo turned off auto-merge: /)).toBeVisible({ timeout: MERGING });
    expect(writes(github, 'AddPullRequestReview')).toBe(1);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(1);
    expect(writes(github, 'DisablePullRequestAutoMerge')).toBe(1);
  });
});

test.describe('when GitHub reads it as conflicting once approved', () => {
  test.use({ cassette: 'app_merge_ship_queued_conflict' });

  test('it stops after approving, and says the approval stays', async ({ page, github }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText('Approved, but not merged', { timeout: MERGING });
    await expect(dialog(page)).toContainText('your approval stays');
    await expect(steps(page).nth(1)).toContainText('Approved as rozed-bot');
    await expect(steps(page).nth(2)).toContainText('Can’t merge');
    await expect(dialog(page).getByRole('button', { name: /Merge panel/ })).toBeVisible();
    expect(writes(github, 'AddPullRequestReview')).toBe(1);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(0);

    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe('when someone pushed after the plan', () => {
  test.use({ cassette: 'app_merge_ship_queued_moved' });

  test('it stops before approving, says so, and offers the newer push', async ({
    page,
    github,
  }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await expect(steps(page).nth(1)).toContainText('Approve as rozed-bot');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText('A newer push arrived', { timeout: MERGING });
    await expect(dialog(page)).toContainText('nothing was approved');
    await expect(steps(page).nth(0)).toContainText('You reviewed r1.');
    await expect(dialog(page).getByRole('button', { name: /^See/ })).toBeVisible();
    expect(writes(github, 'AddPullRequestReview')).toBe(0);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(0);
  });
});
