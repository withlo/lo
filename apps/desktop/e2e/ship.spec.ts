// Approve and ship: Lo, started on the replay server as rozed-bot, on generation 10 of
// `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as recorded from the app with
// writes. `⌘⇧⏎` on a pull request rozed-bot opened approves nothing and merges it from one
// confirmation, which then says it's done (`app_merge_ship`, served a stage at a time, so however
// long Lo takes to look up the merged pull requests, it reads the pull request as it was until it
// merges it); into `e4/queued`, while its `ci` runs, it turns on auto-merge
// (`app_merge_ship_queued`). From derived answers, as GitHub takes no approval from a pull
// request's author: on one someone else opened it approves the revision on screen, then turns on
// auto-merge (`app_merge_ship_queued_others`), or stops after approving, saying so, when GitHub then
// reads it as conflicting (`app_merge_ship_queued_conflict`); a push after the plan stops it before
// approving (`app_merge_ship_queued_moved`); and a push once auto-merge is on has the watch turn
// auto-merge off (`app_merge_ship_watched`).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MERGE_PULLS, writeMergeRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, tabBanners, test as base } from './app.ts';
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

// Their pull requests have no overview, and the cassette doesn’t answer for their timelines.
test.use({ settings: DIFF_FIRST });

/** The header's merge status. */
const status = (page: Page) =>
  page.locator('header.pr-header:visible').locator('button[aria-haspopup="dialog"]');

/** `⌘⇧⏎`, which is Ctrl+Shift+Enter on Linux. */
const SHIP = process.platform === 'darwin' ? 'Meta+Shift+Enter' : 'Control+Shift+Enter';

/** Approve and ship's dialog. */
const dialog = (page: Page) => page.getByTestId('ship-confirm');

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** What the dialog says it did, once it's done, beside "Done". */
const done = (page: Page, line: string) =>
  dialog(page).getByRole('status').filter({ hasText: line });

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
 * then the dialog says how far it has got, with "Checking…" at work, and asks again by itself as
 * they're looked up: that's progress, never a failure. Planned, its title is `title`.
 */
async function ship(
  page: Page,
  number: number,
  title = `Approve and ship #${number}?`,
): Promise<void> {
  await page.keyboard.press(SHIP);
  await expect(dialog(page)).toBeVisible();
  const busy = dialog(page).locator('button[aria-busy="true"]');
  // Planned, with its steps and nothing busy.
  await expect
    .poll(async () => (await steps(page).count()) > 0 && (await busy.count()) === 0, {
      timeout: LOOKUPS,
    })
    .toBe(true);
  await expect(dialog(page)).toContainText(title);
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);
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
    // The title and the button promise only the merge.
    await ship(page, number, `Merge #${number}?`);
    // Two steps: the approval, skipped, then the merge.
    await expect(steps(page)).toHaveCount(2);
    await expect(steps(page).nth(0)).toContainText('Authors can’t approve their own pull request.');
    await expect(steps(page).nth(1)).toContainText('into merge/10/base with a merge commit.');
    await expect(
      dialog(page).getByRole('button', { name: new RegExp(`^Merge #${number}`) }),
    ).toBeVisible();
    expect(merges(github, number)).toBe(0);

    await page.keyboard.press('Enter');
    // The dialog says it's done, and no toast does.
    await expect(done(page, `Merged #${number}`)).toBeVisible({ timeout: MERGING });
    await expect(said(page, `Merged #${number}`)).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeHidden();
    expect(merges(github, number)).toBe(1);
    expect(writes(github, 'AddPullRequestReview')).toBe(0);
  });
});

test.describe('into a branch with a merge queue, while its checks run', () => {
  test.use({ cassette: 'app_merge_ship_queued' });

  test('`⌘⇧⏎` turns on auto-merge', async ({ page, github }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number, 'Turn on auto-merge?');
    await expect(steps(page).nth(1)).toContainText('Turn on auto-merge.');
    await expect(steps(page).nth(1)).toContainText('It joins the merge queue for e4/queued once');
    await page.keyboard.press('Enter');
    await expect(done(page, `Turned on auto-merge for #${number}`)).toBeVisible({
      timeout: MERGING,
    });
    await expect(status(page)).toContainText('Auto-merge is on');
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(1);
    expect(writes(github, 'AddPullRequestReview')).toBe(0);
  });
});

test.describe('on a pull request someone else opened', () => {
  test.use({ cassette: 'app_merge_ship_queued_others' });

  test('`⌘⇧⏎` approves the revision on screen, then turns on auto-merge', async ({
    page,
    github,
  }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await expect(steps(page).nth(0)).toContainText(`Approve #${number} as rozed-bot.`);
    // Your approval outlives a push: the confirmation says so, and that Lo watches for one.
    await expect(dialog(page)).toContainText(
      'auto-merge turns off if a commit is pushed after your approval',
    );
    await expect(dialog(page).getByRole('button', { name: /^Approve and ship/ })).toBeVisible();
    expect(writes(github, 'AddPullRequestReview')).toBe(0);

    await page.keyboard.press('Enter');
    await expect(done(page, `Approved #${number} and turned on auto-merge`)).toBeVisible({
      timeout: MERGING,
    });
    expect(writes(github, 'AddPullRequestReview')).toBe(1);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(1);
    await expect(status(page)).toContainText('Auto-merge is on');
  });
});

test.describe('when someone pushes once auto-merge is on', () => {
  test.use({ cassette: 'app_merge_ship_watched' });

  test('Lo turns auto-merge off, so the push doesn’t merge with your approval', async ({
    page,
    github,
  }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await page.keyboard.press('Enter');
    // The tab's banner says it in one line, and offers the push.
    await expect(tabBanners(page).getByText(/after your approval · Auto-merge is off/)).toBeVisible(
      {
        timeout: MERGING,
      },
    );
    expect(writes(github, 'AddPullRequestReview')).toBe(1);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(1);
    expect(writes(github, 'DisablePullRequestAutoMerge')).toBe(1);
  });
});

test.describe('when GitHub reads it as conflicting once approved', () => {
  test.use({ cassette: 'app_merge_ship_queued_conflict' });

  test('it stops after approving, and says it approved', async ({ page, github }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await page.keyboard.press('Enter');
    const alert = dialog(page).getByRole('alert');
    await expect(alert).toContainText(`Couldn’t merge #${number}`, { timeout: MERGING });
    await expect(alert).toContainText('Can’t merge');
    // The approval step keeps the words it was asked with, marked done.
    await expect(steps(page).nth(0)).toContainText(`Approve #${number} as rozed-bot.`);
    // The title stays, and so does each step as it was asked.
    await expect(dialog(page)).toContainText(`Approve and ship #${number}?`);
    await expect(dialog(page).getByRole('button', { name: /^Merge panel/ })).toBeVisible();
    expect(writes(github, 'AddPullRequestReview')).toBe(1);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(0);

    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe('when someone pushed after the plan', () => {
  test.use({ cassette: 'app_merge_ship_queued_moved' });

  test('it stops before approving, says so, and offers the newer revision', async ({
    page,
    github,
  }) => {
    const { number } = pulls.queuedSlow1;
    await open(page, number, 'Can’t merge yet');
    await ship(page, number);
    await expect(steps(page).nth(0)).toContainText(`Approve #${number} as rozed-bot.`);
    await page.keyboard.press('Enter');
    const alert = dialog(page).getByRole('alert');
    await expect(alert).toContainText(`Couldn’t approve #${number}`, { timeout: MERGING });
    await expect(alert).toContainText('This revision is out of date.');
    await expect(dialog(page).getByRole('button', { name: /^Show/ })).toBeVisible();
    expect(writes(github, 'AddPullRequestReview')).toBe(0);
    expect(writes(github, 'EnablePullRequestAutoMerge')).toBe(0);
  });
});
