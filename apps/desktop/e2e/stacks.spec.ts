// The stacks in the app: Lo, started on the replay server as rozed-bot, finds the stack each pull
// request's tab is in, among rozed-dev/e2e's open pull requests and the merged ones they link
// through, reads the state of the layers of the stack on screen, and draws the stack's tree above
// the files. `]s` and `[s` walk it, `-` from the file tree goes up to it, and a link to any layer
// shows that layer in the stack's tab. A run of layers chosen in the tree, or the stack up to a
// layer, shows as one diff, and `Esc` comes back. A layer's diff leaves out the layers below it,
// from GitHub's comparison until the local copy is ready, and a stack found only once the diff is
// drawn offers that in a banner.

import { STACK_PULLS, writeStackRemote } from '@lo/testing/git';
import { _electron as electron, type Page } from '@playwright/test';

import type { DiffState } from '../src/features/diff/contract.ts';
import type { StackState } from '../src/features/stacks/contract.ts';
import {
  appEnvironment,
  appFolder,
  browsed,
  dataFolder,
  DIFF_FIRST,
  expect,
  KEYCHAIN,
  onStacks as test,
  STACK,
} from './app.ts';

/** Waits for the account from the token file, then opens pull request `number`'s tab. */
async function open(page: Page, number: number): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** The stack tab `id` shows, as main has it, briefly: how it was found, and each row's marks. */
async function stackOf(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('stacks.state', { id: tab }), id);
  if (!reply.ok) return reply;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const stack = (reply.value as StackState | undefined)?.stack;
  if (stack?.kind !== 'stack') return stack;
  return {
    found: stack.found,
    root: stack.root,
    rows: stack.rows.map((row) => [
      row.number,
      row.current ? 'current' : '',
      row.on === null ? '' : `on #${row.on}`,
      // The layers' state, once read, counts the other layers' viewed files.
      row.viewed?.source ?? 'unread',
    ]),
  };
}

/** The stack's tree on screen. */
const treeOf = (page: Page) => page.getByRole('tree', { name: 'Layers' });

/** The stack's tree's row for layer `number`. */
const rowOf = (page: Page, number: number) =>
  treeOf(page).locator(`[role="treeitem"][data-key="${number}"]`);

/** The layer on screen, as the stack's tree marks it. */
const current = (page: Page) => treeOf(page).locator('[aria-current="true"]');

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** Presses keys one after another, as typed. */
async function type(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The scope focus is in: `stack`, `tree`, `diff`, or none. */
function scopeOf(page: Page): Promise<string | null | undefined> {
  return page.evaluate(() =>
    document.activeElement?.closest('[data-lo-scope]')?.getAttribute('data-lo-scope'),
  );
}

/** How many pull requests' tabs the strip has. */
async function pullTabs(page: Page): Promise<number> {
  const reply = await page.evaluate(() => window.lo.invoke('tab.list'));
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const { tabs } = reply.value as { tabs: { kind: string }[] };
  return tabs.filter((tab) => tab.kind === 'pull').length;
}

/**
 * Waits for the middle view of the layer on screen, its diff or its overview, to take focus, as it
 * does once it's drawn. A focus move drops keys typed before it, so the next keys wait for it.
 */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => document.activeElement?.closest('[data-lo-middle-view]') !== null),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Where main's diff of view `id` is and starts, where its files came from, and their paths. */
async function diffOf(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('diff.versions', { id: tab }), id);
  if (!reply.ok) return reply;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const state = reply.value as DiffState | undefined;
  return (
    state && {
      at: state.at,
      compareFrom: state.compareFrom,
      from: state.from,
      files: state.files?.map((file) => file.path.text) ?? null,
    }
  );
}

/** A file's header in the diff on screen. */
function header(page: Page, path: string) {
  return page.locator('.lo-diffview .lo-filehead', { hasText: path }).first();
}

/** Waits for the diff on screen to show its files, then puts focus in it, at the top. */
async function inDiff(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.loDiff?.files.length ?? 0), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.locator('.lo-diffview .cm-editor:visible').last().locator('.cm-content').focus();
  await type(page, 'g', 'g');
}

test('finds the stack each tab is in, and reads the state of its layers on screen', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const c = await open(page, STACK.c);
  await expect
    .poll(() => stackOf(page, c), { timeout: 20_000 })
    .toEqual({
      found: ['baseBranch', 'sharedCommits'],
      root: 'stack/root',
      rows: [
        [STACK.a, '', '', 'layers'],
        [STACK.b, '', '', 'layers'],
        [STACK.c, 'current', '', 'tab'],
        [STACK.d, '', `on #${STACK.a}`, 'layers'],
      ],
    });

  // #E sits alone on #M, which was squash-merged: a stack of one, which says why.
  const e = await open(page, STACK.e);
  await expect
    .poll(() => stackOf(page, e), { timeout: 20_000 })
    .toEqual({ found: null, root: 'stack/mroot', rows: [[STACK.e, 'current', '', 'tab']] });

  const g2 = await open(page, STACK.g2);
  await expect
    .poll(() => stackOf(page, g2), { timeout: 20_000 })
    .toEqual({
      found: ['github'],
      root: 'stack/root',
      rows: [
        [STACK.g1, '', '', 'layers'],
        [STACK.g2, 'current', '', 'tab'],
      ],
    });
});

test('draws the stack above the files, with each layer’s marks, the offer and the notes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page, STACK.c);
  const stack = page.getByRole('region', { name: 'Stack' });
  await expect(stack).toContainText('4 layers · by base branch and shared commits', {
    timeout: 20_000,
  });
  await expect(treeOf(page).getByRole('treeitem')).toHaveText([
    /^Stack A: load per-plan limits/,
    /^Stack B: rate limit GraphQL queries by cost/,
    /^Stack C: count a query's nodes/,
    new RegExp(`^Stack D: log when a plan's limit is reached.*on #${STACK.a}$`),
  ]);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c));
  // #B has an overview, from the repository's refs; the layer on screen shows the overview's own
  // mark; and the other layers count their viewed files from the layers' state.
  await expect(rowOf(page, STACK.b).getByRole('img', { name: 'Overview' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(rowOf(page, STACK.a).getByRole('img', { name: 'No overview yet' })).toBeVisible();
  await expect(rowOf(page, STACK.c).getByRole('img', { name: 'No overview yet' })).toBeVisible();
  await expect(rowOf(page, STACK.a)).toContainText(/Viewed \d+\/\d+/);
  // #C's diff starts at #B's head, so it shows one file, and the layer's row and the files' head
  // count that one, not the three its pull request changes against `stack/root`.
  await expect(rowOf(page, STACK.c)).toContainText('Viewed 0/1', { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Files' })).toContainText('0 / 1 viewed');
  // #A, #B and #C could be a GitHub stack, which is offered, worded for how they were found.
  await expect(stack).toContainText(
    "These PRs sit on each other's branches and share commits but aren't a GitHub stack.",
  );
  await expect(stack.getByRole('button', { name: /Make this a GitHub stack/ })).toBeVisible();
  // The files are still there, under the stack.
  await expect(page.getByRole('region', { name: 'Files' })).toBeVisible();

  await open(page, STACK.e);
  await expect(stack).toContainText('1 layer', { timeout: 20_000 });
  await expect(rowOf(page, STACK.e)).toContainText('Needs rebase');
  await expect(stack.getByRole('note')).toHaveText(
    `#${STACK.e} needs a rebase. #${STACK.m} was squash-merged, so its changes are hidden here, and #${STACK.e} is compared with #${STACK.m}'s last commit.`,
  );

  // A GitHub stack is offered nothing.
  await open(page, STACK.g2);
  await expect(stack).toContainText('GitHub stack · 2 layers', { timeout: 20_000 });
  await expect(stack.getByRole('button', { name: /Make this a GitHub stack/ })).toHaveCount(0);
});

test(']s and [s walk the layers in the tree’s order, in one tab, and stop at the ends', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const a = await open(page, STACK.a);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.a), { timeout: 20_000 });
  await settled(page);
  // Each layer shown starts at the layer below it, set before it's first drawn: #C, into
  // `stack/root`, at #B's head, and the others at their base branches, the heads below them.
  const below = [null, STACK_PULLS.b.head, null];
  for (const [at, layer] of [STACK.b, STACK.c, STACK.d].entries()) {
    await type(page, ']', 's');
    await expect(current(page)).toHaveAttribute('data-key', String(layer), { timeout: 20_000 });
    await expect
      .poll(() => diffOf(page, `${a}:${layer}`), { timeout: 20_000 })
      .toMatchObject({ compareFrom: below[at] });
    await settled(page);
  }
  await expect(page.locator('[data-lo-banners]')).toHaveCount(0);
  await type(page, ']', 's');
  await expect(said(page, `#${STACK.d} is the last layer.`)).toHaveCount(1);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d));

  // Showing a layer isn't a jump: `⌃o` doesn't go back to the one before.
  await type(page, 'Control+o');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d));

  for (const layer of [STACK.c, STACK.b, STACK.a]) {
    await type(page, '[', 's');
    await expect(current(page)).toHaveAttribute('data-key', String(layer), { timeout: 20_000 });
    await settled(page);
  }
  await type(page, '[', 's');
  await expect(said(page, `#${STACK.a} is the first layer.`)).toHaveCount(1);
  expect(await pullTabs(page)).toBe(1);
});

test('a link to any layer shows it in the tab its stack is in', async ({ page }) => {
  test.setTimeout(60_000);
  const c = await open(page, STACK.c);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  expect(await open(page, STACK.d)).toBe(`${c}:${STACK.d}`);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d), { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Stack D: log when a plan's limit is reached",
  );
  expect(await pullTabs(page)).toBe(1);
});

test('- twice goes up to the stack, where keys, a click and a menu show a layer', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, STACK.c);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  await inDiff(page);
  await type(page, '-');
  await expect.poll(() => scopeOf(page)).toBe('tree');
  await type(page, '-');
  await expect.poll(() => scopeOf(page)).toBe('stack');
  await expect(rowOf(page, STACK.c)).toHaveAttribute('data-focused', '');

  // `j` and `k` move, and `⏎` shows a layer, with the keyboard still in the stack.
  await type(page, 'j');
  await expect(rowOf(page, STACK.d)).toHaveAttribute('data-focused', '');
  await type(page, 'Enter');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d), { timeout: 20_000 });
  await expect.poll(() => scopeOf(page)).toBe('stack');
  await type(page, 'k', 'k', 'Enter');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.b), { timeout: 20_000 });
  await type(page, 'Escape');
  await expect.poll(() => scopeOf(page)).not.toBe('stack');

  await rowOf(page, STACK.a).click();
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.a), { timeout: 20_000 });

  // A layer's menu shows it, opens it on GitHub, or makes its chain a GitHub stack.
  await rowOf(page, STACK.d).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Layer actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^Show this layer/,
    /^Choose a run from here/,
    /^View the stack up to here as one diff/,
    /^Open on GitHub/,
    /^Make this a GitHub stack/,
  ]);
  await menu.getByRole('menuitem', { name: /^Open on GitHub/ }).click();
  await expect.poll(() => browsed()).toEqual([`https://github.com/rozed-dev/e2e/pull/${STACK.d}`]);
  await rowOf(page, STACK.c).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /^Show this layer/ }).click();
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  expect(await pullTabs(page)).toBe(1);
});

/** The bar over a run of layers on screen. */
const bar = (page: Page) => page.getByRole('region', { name: 'Run of layers' });

test.describe('a run of layers', () => {
  test('v, j and ⏎ show #B and #C as one diff, with no marks, and Esc comes back to #C’s place', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const c = await open(page, STACK.c);
    await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
    await inDiff(page);
    /** Where the diff's cursor is, as its probe says. */
    const cursor = () => page.evaluate(() => JSON.stringify(window.loDiff?.probe.cursor()?.at));
    await type(page, 'j', 'j');
    const before = await cursor();

    await type(page, '-', '-');
    await expect.poll(() => scopeOf(page)).toBe('stack');
    await type(page, 'k', 'v');
    const stack = page.getByRole('region', { name: 'Stack' });
    await expect(stack).toContainText('V-LINE');
    // #D sits on #A, on another branch: `j` from #B goes to #C, and no further.
    await type(page, 'j', 'j');
    // `⏎` is Enter on Linux.
    await expect(stack.getByRole('note').first()).toHaveText(
      new RegExp(
        `^#${STACK.b} and #${STACK.c}, compared with the top of #${STACK.a}\\. (⏎|Enter) shows them as one diff; Esc goes back to one layer\\.$`,
      ),
    );
    await expect(rowOf(page, STACK.d)).toHaveAttribute('data-dim', '');
    await type(page, 'Enter');

    await expect(bar(page)).toContainText(
      `2 layers as one diff · #${STACK.b} Stack B: rate limit GraphQL queries by cost and #${STACK.c} Stack C: count a query's nodes`,
      { timeout: 20_000 },
    );
    // The window's default width has no room for the branches beside the layers' names, so the bar
    // leaves them out and keeps the count of files whole.
    await expect(bar(page).getByText('2 files')).toBeVisible({ timeout: 20_000 });
    await expect(bar(page).getByText('stack/a → stack/c')).toBeHidden();
    await expect(bar(page).getByRole('button')).toHaveText(new RegExp(`^Back to #${STACK.c}`));
    const run = `${c}:${STACK.b}-${STACK.c}`;
    await expect
      .poll(() => diffOf(page, run), { timeout: 20_000 })
      .toMatchObject({
        at: STACK_PULLS.c.head,
        compareFrom: STACK_PULLS.a.head,
        files: ['src/cost.ts', 'src/nodes.ts'],
      });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Stack C: count a query's nodes",
    );
    // The diff's note names the run's ends, and the tab's name agrees with the heading on its top
    // layer, #C.
    await expect(page.getByRole('note', { name: 'What the diff compares' })).toHaveText(
      `Every change, #${STACK.b} → #${STACK.c}`,
    );
    await expect(page.locator('[data-tab]').first()).toContainText(`#${STACK.c}`);
    await expect(page.locator('[data-tab]').first()).not.toContainText(`#${STACK.b}`);
    // It opens on its diff, which marks no file viewed, and `e` says why; it compares no
    // revisions.
    await settled(page);
    await expect(header(page, 'src/cost.ts')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.lo-diffview .lo-diffhead__ball')).toHaveCount(0);
    await expect(page.locator('button[title="Compare revisions"]')).toHaveCount(0);
    await inDiff(page);
    await type(page, 'e');
    await expect(
      said(page, 'A run of layers has no viewed marks. Mark files viewed in a layer.'),
    ).toHaveCount(1);

    await type(page, 'Escape');
    await expect(bar(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(current(page)).toHaveAttribute('data-key', String(STACK.c));
    await expect.poll(cursor, { timeout: 20_000 }).toBe(before);
    expect(await pullTabs(page)).toBe(1);
  });

  test('shows the stack up to a layer from its menu, and its bar goes back', async ({ page }) => {
    test.setTimeout(60_000);
    const c = await open(page, STACK.c);
    await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
    await rowOf(page, STACK.c).click({ button: 'right' });
    await page
      .getByRole('menu', { name: 'Layer actions' })
      .getByRole('menuitem', { name: /^View the stack up to here as one diff/ })
      .click();
    await expect(bar(page)).toContainText(
      `3 layers as one diff · #${STACK.a} Stack A: load per-plan limits, #${STACK.b}`,
      { timeout: 20_000 },
    );
    await expect
      .poll(() => diffOf(page, `${c}:${STACK.a}-${STACK.c}`), { timeout: 20_000 })
      .toMatchObject({
        compareFrom: STACK_PULLS.root,
        files: ['src/cost.ts', 'src/nodes.ts', 'src/plans.ts'],
      });
    await bar(page)
      .getByRole('button', { name: /^Back to #/ })
      .click();
    await expect(bar(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(current(page)).toHaveAttribute('data-key', String(STACK.c));
  });
});

test('each layer keeps its place as ]s and [s leave it and come back', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, STACK.c);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  await inDiff(page);
  /** Where the diff's cursor is, as its probe says. */
  const cursor = () => page.evaluate(() => JSON.stringify(window.loDiff?.probe.cursor()?.at));
  const start = await cursor();
  await type(page, 'j', 'j', 'j');
  await expect.poll(cursor).not.toBe(start);
  const before = await cursor();

  await type(page, ']', 's');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d), { timeout: 20_000 });
  await settled(page);
  await type(page, '[', 's');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  await expect.poll(cursor, { timeout: 20_000 }).toBe(before);
});

test('comes back at the layer it showed after a restart', async ({
  app,
  page,
  githubOrigin,
  remote,
}) => {
  test.setTimeout(90_000);
  await open(page, STACK.a);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.a), { timeout: 20_000 });
  // Focus moving into the middle as it's drawn would drop a sequence typed before it.
  await settled(page);
  await type(page, ']', 's');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.b), { timeout: 20_000 });
  await app.close();

  const again = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: githubOrigin,
      LO_TEST_TOKEN_FILE: test.info().outputPath('token'),
      LO_GIT_REMOTE: remote,
    },
    chromiumSandbox: true,
  });
  try {
    const shown = await again.firstWindow();
    await shown.waitForLoadState('load');
    await expect(shown.getByRole('heading', { level: 1 })).toHaveText(
      'Stack B: rate limit GraphQL queries by cost',
      { timeout: 20_000 },
    );
    await expect(current(shown)).toHaveAttribute('data-key', String(STACK.b), {
      timeout: 20_000,
    });
  } finally {
    await again.close();
  }
});

test.describe('a layer’s diff', () => {
  test.use({ settings: DIFF_FIRST });

  test.describe('before the local copy is ready', () => {
    test.use({ lateRemote: true });

    test('leaves out the layers below it, from GitHub’s comparison and then the local copy', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const a = await open(page, STACK.a);
      await expect
        .poll(() => stackOf(page, a), { timeout: 20_000 })
        .toMatchObject({ root: 'stack/root' });
      // #C, opened once its stack is known, starts at #B's head: only its own changes show.
      const c = await open(page, STACK.c);
      const onB = {
        at: STACK_PULLS.c.head,
        compareFrom: STACK_PULLS.b.head,
        files: ['src/nodes.ts'],
      };
      await expect
        .poll(() => diffOf(page, c), { timeout: 20_000 })
        .toEqual({ ...onB, from: 'github' });
      // #E needs a rebase on #M, which was squash-merged, but its base branch still sits at #M's
      // head, where GitHub's diff already starts: #M's changes stay out, with nothing to change.
      const e = await open(page, STACK.e);
      const onM = { at: STACK_PULLS.e.head, compareFrom: null, files: ['src/cache.ts'] };
      await expect
        .poll(() => diffOf(page, e), { timeout: 20_000 })
        .toEqual({ ...onM, from: 'github' });

      writeStackRemote(test.info().outputPath('remote'));
      await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), e);
      await expect
        .poll(() => diffOf(page, e), { timeout: 30_000 })
        .toEqual({ ...onM, from: 'local' });
      await expect(page.locator('[data-lo-banners]')).toHaveCount(0);
      expect(await open(page, STACK.c)).toBe(c);
      await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), c);
      await expect
        .poll(() => diffOf(page, c), { timeout: 30_000 })
        .toEqual({ ...onB, from: 'local' });
    });
  });

  test.describe('when its stack is found after it’s drawn', () => {
    test.use({ holdStacks: true });

    test('stays as drawn, and a banner offers to leave the layer below out', async ({
      page,
      held,
    }) => {
      test.setTimeout(60_000);
      const c = await open(page, STACK.c);
      // GitHub's diff, with #A's and #B's changes too.
      await expect(header(page, 'src/plans.ts')).toBeVisible({ timeout: 20_000 });
      held.release();
      const banner = page
        .getByRole('status')
        .filter({ hasText: "#84's diff includes #83's changes." });
      await expect(banner).toBeVisible({ timeout: 20_000 });
      expect(await diffOf(page, c)).toMatchObject({ compareFrom: null });
      await expect(header(page, 'src/plans.ts')).toBeVisible();

      await banner.getByRole('button', { name: "Show only #84's" }).click();
      await expect(banner).toHaveCount(0);
      await expect
        .poll(() => diffOf(page, c), { timeout: 20_000 })
        .toMatchObject({ compareFrom: STACK_PULLS.b.head, files: ['src/nodes.ts'] });
      await expect(header(page, 'src/nodes.ts')).toBeVisible({ timeout: 20_000 });
      await expect(header(page, 'src/plans.ts')).toHaveCount(0);
    });

    test.describe('without git', () => {
      test.use({ noGit: true });

      test('offers it too, and shows GitHub’s comparison with the layer below', async ({
        page,
        held,
      }) => {
        test.setTimeout(60_000);
        const c = await open(page, STACK.c);
        await expect(header(page, 'src/plans.ts')).toBeVisible({ timeout: 20_000 });
        held.release();
        await page.getByRole('button', { name: "Show only #84's" }).click({ timeout: 20_000 });
        await expect
          .poll(() => diffOf(page, c), { timeout: 20_000 })
          .toEqual({
            at: STACK_PULLS.c.head,
            compareFrom: STACK_PULLS.b.head,
            from: 'github',
            files: ['src/nodes.ts'],
          });
        await expect(header(page, 'src/plans.ts')).toHaveCount(0);
      });
    });
  });
});
