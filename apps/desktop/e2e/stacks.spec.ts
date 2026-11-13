// The stacks in the app: Lo, started on the replay server as rozed-bot, finds the stack each pull
// request's tab is in, among rozed-dev/e2e's open pull requests and the merged ones they link
// through, reads the state of the layers of the stack on screen, and draws the stack's tree above
// the files. `]s` and `[s` walk it, `-` from the file tree goes up to it, and a link to any layer
// shows that layer in the stack's tab.

import { _electron as electron, type Page } from '@playwright/test';

import type { StackState } from '../src/features/stacks/contract.ts';
import {
  appEnvironment,
  appFolder,
  browsed,
  dataFolder,
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
      found: 'both',
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
      found: 'github',
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
  await open(page, STACK.a);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.a), { timeout: 20_000 });
  for (const layer of [STACK.b, STACK.c, STACK.d]) {
    await type(page, ']', 's');
    await expect(current(page)).toHaveAttribute('data-key', String(layer), { timeout: 20_000 });
  }
  await type(page, ']', 's');
  await expect(said(page, `#${STACK.d} is the last layer.`)).toHaveCount(1);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d));

  // Showing a layer isn't a jump: `⌃o` doesn't go back to the one before.
  await type(page, 'Control+o');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.d));

  for (const layer of [STACK.c, STACK.b, STACK.a]) {
    await type(page, '[', 's');
    await expect(current(page)).toHaveAttribute('data-key', String(layer), { timeout: 20_000 });
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
  // Focus left with #C's diff, and comes to #D's once it's drawn, which drops keys typed before.
  await expect(page.locator('.lo-diffview .cm-editor:visible .cm-content:focus')).toHaveCount(1, {
    timeout: 20_000,
  });
  await type(page, '[', 's');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  await expect.poll(cursor, { timeout: 20_000 }).toBe(before);
});

test('comes back at the layer it showed after a restart', async ({ app, page, github, remote }) => {
  test.setTimeout(90_000);
  await open(page, STACK.a);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.a), { timeout: 20_000 });
  await type(page, ']', 's');
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.b), { timeout: 20_000 });
  await app.close();

  const again = await electron.launch({
    args: [appFolder, ...KEYCHAIN],
    env: {
      ...appEnvironment(dataFolder()),
      LO_GITHUB: new URL(github.urls.api).origin,
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
