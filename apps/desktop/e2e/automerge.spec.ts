// Auto-merge and a merge past the rules: Lo, started on the replay server as rozed-bot, on
// generation 7 of `testing/fixtures/merge.sh`'s pull requests in rozed-dev/e2e, as recorded from the
// app with writes. `a` in the merge panel opens a confirmation that says what GitHub waits for, and
// turns auto-merge on once it's confirmed (`app_merge_auto`); with it on, `a` turns it off at once,
// asking nothing (`app_merge_auto_off`). `⌥⏎` merges past the base branch's rules, which its
// confirmation lists, only once the pull request's number is typed (`app_merge_override`). GitHub's
// refusals are said in the dialog, from derived answers: a repository that doesn't allow auto-merge
// (`app_merge_auto_not_allowed`), and a pull request its code owner approved since, which nothing
// blocks then, whose merge the dialog offers in auto-merge's place (`app_merge_auto_now`). An
// account below admin isn't offered `⌥⏎` (`app_merge_override_writer`), nor a merge GitHub blocks
// for a rule it can't bypass, which the panel names (`app_merge_write_writer`, on generation 5).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MERGE_PULLS, writeMergeRemote, type MergeGenerationNumber } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';

const { pulls } = MERGE_PULLS[7];

/** How long GitHub's recorded answers keep a merge pending, as Lo asks after 1 s, 2 s and 4 s. */
const MERGING = 20_000;

/**
 * `test`, with Lo signed in as rozed-bot on a replay server that answers from `cassette`, fetching
 * from `generation`'s repository, built on this machine.
 */
const test = base.extend<{
  cassette: string;
  generation: MergeGenerationNumber;
  github: ReplayServer;
  remote: string;
}>({
  cassette: ['app_merge_auto', { option: true }],
  generation: [7, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  remote: async ({ generation }, use) => {
    // `merge.sh` builds nothing inside a work tree, so not in the test's output folder.
    const folder = mkdtempSync(join(tmpdir(), 'lo-automerge-'));
    await use(writeMergeRemote(join(folder, 'remote'), generation));
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
async function panelOf(page: Page, number: number, shown: string): Promise<void> {
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
 * this waits for its main button to stop being busy too, and for focus to be in the dialog, where
 * `⏎` confirms.
 */
async function asks(page: Page, title: string, options: { timeout?: number } = {}): Promise<void> {
  await expect(dialog(page).getByRole('heading', { name: title, exact: true })).toBeVisible(
    options,
  );
  await expect(dialog(page).locator('button[aria-busy="true"]')).toHaveCount(0);
  await expect(dialog(page).locator(':focus')).toHaveCount(1);
}

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Lo's writes of auto-merge so far, by operation. */
function autoWrites(github: ReplayServer, operation: string): number {
  return github.replay.seen.filter(({ body }) =>
    new TextDecoder().decode(body).includes(`mutation ${operation}`),
  ).length;
}

/** Turns on auto-merge for #221 with `a`, then `⏎` in its confirmation. */
async function turnOn(page: Page): Promise<void> {
  const { number } = pulls.gatedPassing;
  await panelOf(page, number, 'Can’t merge yet');
  await page.keyboard.press('a');
  await asks(page, 'Turn on auto-merge');
  await page.keyboard.press('Enter');
}

test('`a` turns on auto-merge once confirmed, saying what GitHub waits for', async ({
  page,
  github,
}) => {
  const { number } = pulls.gatedPassing;
  await panelOf(page, number, 'Can’t merge yet');
  await page.keyboard.press('a');
  await asks(page, 'Turn on auto-merge');
  await expect(dialog(page)).toContainText(`GitHub merges #${number} into e4/gated once`);
  await expect(dialog(page).getByRole('button', { name: /Merge when ready/ })).toBeVisible();
  expect(autoWrites(github, 'EnablePullRequestAutoMerge')).toBe(0);

  await page.keyboard.press('Enter');
  await expect(said(page, `Turned on auto-merge for #${number}`)).toBeVisible({
    timeout: MERGING,
  });
  await expect(status(page)).toContainText('Merges when ready');
  expect(autoWrites(github, 'EnablePullRequestAutoMerge')).toBe(1);
});

test.describe('with auto-merge on', () => {
  test.use({ cassette: 'app_merge_auto_off' });

  test('`a` turns it off at once, asking nothing', async ({ page, github }) => {
    const { number } = pulls.queuedSlow1;
    await panelOf(page, number, 'Merges when ready');
    await page.keyboard.press('a');
    await expect(said(page, `Turned off auto-merge for #${number}`)).toBeVisible({
      timeout: MERGING,
    });
    await expect(dialog(page)).toBeHidden();
    await expect(status(page)).toContainText('Can’t merge yet');
    expect(autoWrites(github, 'DisablePullRequestAutoMerge')).toBe(1);
  });
});

test.describe('past the rules', () => {
  test.use({ cassette: 'app_merge_override' });

  test('`⌥⏎` lists what it skips, and merges only once the number is typed', async ({
    page,
    github,
  }) => {
    const { number } = pulls.overridden;
    await panelOf(page, number, 'Can’t merge yet');
    await expect(
      panel(page).getByRole('button', { name: /Merge without the rules/ }),
    ).toBeVisible();
    await page.keyboard.press('Alt+Enter');
    await asks(page, `Merge #${number} without the rules`);
    await expect(dialog(page)).toContainText('This skips:');
    await expect(dialog(page)).toContainText(`Type ${number} to confirm`);
    const button = dialog(page).getByRole('button', { name: /Merge anyway/ });
    await expect(button).toHaveAttribute('aria-disabled', 'true');

    // Neither nothing typed nor a part of the number merges it.
    await expect(dialog(page).getByRole('textbox')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type(String(number).slice(0, 2));
    await page.keyboard.press('Enter');
    const merges = () =>
      github.replay.seen.filter(
        ({ method, url }) => method === 'PUT' && url.endsWith(`/pulls/${number}/merge-async`),
      ).length;
    expect(merges()).toBe(0);

    await page.keyboard.type(String(number).slice(2));
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    await expect(said(page, `Merged #${number} into merge/7/override`)).toBeVisible({
      timeout: MERGING,
    });
    expect(merges()).toBe(1);
  });
});

test.describe('where the repository doesn’t allow auto-merge', () => {
  test.use({ cassette: 'app_merge_auto_not_allowed' });

  test('the dialog says so in Lo’s words, and auto-merge stays off', async ({ page }) => {
    await turnOn(page);
    const alert = dialog(page).getByRole('alert');
    await expect(alert).toContainText(
      `Couldn’t turn on auto-merge for #${pulls.gatedPassing.number}.`,
    );
    await expect(alert).toContainText(
      'This repository doesn’t allow auto-merge. A maintainer turns it on in its settings.',
    );
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(status(page)).toContainText('Can’t merge yet');
    await expect(status(page)).not.toContainText('Merges when ready');
    await page.keyboard.press('m');
    await expect(panel(page).getByRole('switch', { name: 'Merge when ready' })).not.toBeChecked();
  });
});

test.describe('when GitHub finds nothing blocks it', () => {
  test.use({ cassette: 'app_merge_auto_now' });

  test('Lo reads it again, and offers the merge in its place to confirm', async ({ page }) => {
    const { number } = pulls.gatedPassing;
    await turnOn(page);
    // The merge, to confirm as any merge; nothing merged it, so no answer to it was recorded.
    await asks(page, `Merge #${number}`, { timeout: MERGING });
    await expect(dialog(page)).toContainText(
      `Nothing blocks #${number} now, so GitHub didn’t turn on auto-merge. It can merge as it is.`,
    );
    await expect(dialog(page).getByRole('button', { name: /^Merge\b/ })).toBeVisible();
    await expect(status(page)).toContainText('Ready to merge');
    await expect(status(page)).not.toContainText('Merges when ready');
  });
});

test.describe('as an account below admin', () => {
  test.use({ cassette: 'app_merge_override_writer' });

  test('`⌥⏎` isn’t offered', async ({ page }) => {
    await panelOf(page, pulls.overridden.number, 'Can’t merge yet');
    await expect(panel(page).getByRole('button', { name: /Merge without the rules/ })).toHaveCount(
      0,
    );
    await page.keyboard.press('Alt+Enter');
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe('as an account GitHub won’t let merge', () => {
  test.use({ cassette: 'app_merge_write_writer', generation: 5 });

  test('no merge is offered, and the panel says why', async ({ page, github }) => {
    const { number } = MERGE_PULLS[5].pulls.squash;
    await panelOf(page, number, 'Can’t merge');
    await expect(status(page)).toContainText('GitHub says no');
    // GitHub doesn't say why; Lo names the rule on the branch it doesn't check.
    await expect(panel(page)).toContainText('GitHub says no, and not why');
    await expect(panel(page)).toContainText('The branch is locked');
    await expect(panel(page).getByRole('button', { name: 'Merge', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeHidden();
    expect(github.replay.seen.filter(({ method }) => method === 'PUT')).toEqual([]);
  });
});
