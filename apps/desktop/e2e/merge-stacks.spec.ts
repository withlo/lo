// Merging a GitHub stack as one, and a chain a layer at a time: Lo, started on the replay server as
// rozed-bot, on generation 8 of `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as
// `app_merge_stack` and `app_merge_chain` recorded from the app with writes. A GitHub stack's top
// layer merges with the layer below it as one, and the dialog shows how GitHub gets on
// (`app_merge_stack_polled`: the recording, with the answers Lo here may ask for that it didn't).
// A chain's bottom layer, with two layers on it, so no GitHub stack, merges alone, and Lo then moves
// both onto its base. The panel says where a chain's layer sits once Lo has looked up the merged
// pull requests chains link through, which in e2e, with its many fixtures, takes two lists.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MERGE_PULLS, writeMergeRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';

/** The generation both were recorded on. */
const { pulls } = MERGE_PULLS[8];

/** How long the panel can take to say where a pull request sits: two lists of e2e's pull requests. */
const PLACED = 60_000;

/** How long GitHub's recorded answers keep a merge pending, as Lo asks after 1 s, 2 s and 4 s. */
const MERGING = 20_000;

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `cassette`. It fetches
 * from the generation's repository, built on this machine.
 */
const test = base.extend<{ cassette: string; github: ReplayServer; remote: string }>({
  cassette: ['app_merge_stack_polled', { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    // `merge.sh` builds nothing inside a work tree, so not in the test's output folder.
    const folder = mkdtempSync(join(tmpdir(), 'lo-merge-stacks-'));
    await use(writeMergeRemote(join(folder, 'remote'), 8));
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
async function panelOf(page: Page, number: number): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  await expect(status(page)).toContainText('Ready to merge');
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

/**
 * Waits for the merge's dialog to ask under `title`: the title is there while Lo still checks, so
 * this waits for its main button to stop being busy too.
 */
async function asks(page: Page, title: string, options: { timeout?: number } = {}): Promise<void> {
  await expect(dialog(page).getByRole('heading', { name: title, exact: true })).toBeVisible(
    options,
  );
  await expect(dialog(page).locator('button[aria-busy="true"]')).toHaveCount(0);
}

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** The rows of the dialog's list, as each reads. */
const rows = (page: Page) => dialog(page).locator('li');

test('a GitHub stack’s top layer merges with the layer below it as one, showing how GitHub gets on', async ({
  page,
  github,
}) => {
  test.setTimeout(PLACED + 30_000);
  const { stack1, stack2 } = pulls;
  await panelOf(page, stack2.number);
  await expect(panel(page)).toContainText(
    `#${stack1.number} merges too, below it in the GitHub stack.`,
    { timeout: PLACED },
  );
  await expect(panel(page).getByRole('button', { name: /Merge 2 layers…/ })).toBeVisible();

  await page.keyboard.press('Enter');
  await asks(page, 'Merge 2 layers');
  await expect(rows(page)).toHaveText([
    new RegExp(`#${stack1.number} Fixture M8: stack, first layer`),
    new RegExp(`#${stack2.number} Fixture M8: stack, second layer`),
  ]);

  await page.keyboard.press('Enter');
  // The dialog stays, its main button busy, until it says it's done; no toast says it meanwhile.
  await expect(dialog(page).getByRole('status').filter({ hasText: 'Merged 2 layers' })).toBeVisible(
    { timeout: MERGING },
  );
  await expect(said(page, 'Merged 2 layers')).toHaveCount(1);
  await dialog(page).getByRole('button', { name: /^Done/ }).click();
  await expect(dialog(page)).toBeHidden();

  // One merge, of the top layer's head, which GitHub merges the layer below with, sent once Lo
  // had read the stack again and found the layer below at the head it showed.
  const seen = github.replay.seen;
  const merge = seen.findIndex(
    ({ method, url }) => method === 'PUT' && url.endsWith(`/pulls/${stack2.number}/merge-async`),
  );
  expect(seen.filter((_, index) => index !== merge).map(({ method }) => method)).not.toContain(
    'PUT',
  );
  expect(JSON.parse(new TextDecoder().decode(seen[merge]!.body))).toMatchObject({
    sha: stack2.head,
  });
  expect(
    seen.slice(0, merge).some(({ url }) => url.endsWith(`/stacks?pull_request=${stack2.number}`)),
  ).toBe(true);
});

test.describe('a chain that can’t be a GitHub stack', () => {
  test.use({ cassette: 'app_merge_chain' });

  test('its bottom layer merges alone, then Lo moves the layers on it onto its base', async ({
    page,
    github,
  }) => {
    test.setTimeout(PLACED + 30_000);
    const { chain1, chain2, draft } = pulls;
    await panelOf(page, chain1.number);
    await expect(panel(page)).toContainText(
      `#${chain1.number} merges alone. #${draft.number} and #${chain2.number} then move onto merge/8/base, while Lo is open.`,
      { timeout: PLACED },
    );

    await page.keyboard.press('Enter');
    await asks(page, `Merge #${chain1.number}`);
    // With a merge commit, GitHub's default here, the layers moved need no rebase.
    await expect(dialog(page)).toContainText('Merge commit');
    await expect(rows(page)).toHaveText([
      new RegExp(`Merge #${chain1.number} into merge/8/base\\.`),
      new RegExp(`Move #${draft.number} onto merge/8/base\\.`),
      new RegExp(`Move #${chain2.number} onto merge/8/base\\.`),
    ]);
    await expect(dialog(page)).not.toContainText('rebase');
    await expect(dialog(page)).toContainText(
      'The layers above move once it has merged, while Lo is open.',
    );

    await page.keyboard.press('Enter');
    // The dialog says it's done once the layers above have moved, and no toast does.
    await expect(
      dialog(page)
        .getByRole('status')
        .filter({ hasText: `Merged #${chain1.number}` }),
    ).toBeVisible({ timeout: MERGING });
    await expect(said(page, `Merged #${chain1.number}`)).toHaveCount(1);
    await expect(said(page, 'rebase')).toHaveCount(0);

    // Each moved once, after the merge.
    const sent = github.replay.seen.flatMap(({ method, url }) =>
      method === 'PUT' || method === 'PATCH' ? [`${method} ${new URL(url).pathname}`] : [],
    );
    expect(sent).toEqual([
      `PUT /repos/rozed-dev/e2e/pulls/${chain1.number}/merge-async`,
      `PATCH /repos/rozed-dev/e2e/pulls/${draft.number}`,
      `PATCH /repos/rozed-dev/e2e/pulls/${chain2.number}`,
    ]);
  });
});
