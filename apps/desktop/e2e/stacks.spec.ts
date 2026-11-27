// The stacks in the app: Lo, started on the replay server as rozed-bot, finds the stack each pull
// request's tab is in, among rozed-dev/e2e's open pull requests and the merged ones they link
// through, reads the state of the layers of the stack on screen, and draws the stack's tree above
// the files, with its offer of a GitHub stack, which the merge panel makes too, and a dismissal in
// either place takes from both. `]s` and `[s` walk it, `-` from the file tree goes up to it, and a
// link to any layer shows that layer in the stack's tab. A run of layers chosen in the tree, or the
// stack up to a layer, shows as one diff, and `Esc` comes back. A layer's diff leaves out the layers
// below it, from GitHub's comparison until the local copy is ready, and a stack found only once the
// diff is drawn offers that in a banner.

import { STACK_PULLS, writeStackRemote } from '@lo/testing/git';
import type { ElectronApplication, Page } from '@playwright/test';

import type { DiffState } from '../src/features/diff/contract.ts';
import type { Placement } from '../src/features/merge/contract.ts';
import type { StackState } from '../src/features/stacks/contract.ts';
import { browsed, DIFF_FIRST, expect, onStacks as test, STACK, tabBanners } from './app.ts';

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

/** The stack tab `id` shows, as main has it, briefly: its root, and each row's marks. */
async function stackOf(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('stacks.state', { id: tab }), id);
  if (!reply.ok) return reply;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const stack = (reply.value as StackState | undefined)?.stack;
  if (stack?.kind !== 'stack') return stack;
  return {
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
const said = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

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

/** What the offer of a GitHub stack over #C's tree, and in its merge panel, says. */
const ONE_AT_A_TIME = 'This branch stack merges one layer at a time.';

/**
 * Has main say #C could merge once its chain is a GitHub stack, as it would from the reads that
 * say where a layer sits in its merge panel, which the cassette doesn't have.
 */
async function convertible(app: ElectronApplication): Promise<void> {
  const place = { kind: 'convert', offer: ONE_AT_A_TIME } satisfies Placement;
  await app.evaluate(({ ipcMain }, value) => {
    ipcMain.removeHandler('merge.place');
    ipcMain.handle('merge.place', () => ({ ok: true, value }));
  }, place);
}

/** The header's merge status, which opens the merge panel. */
const mergeStatus = (page: Page) =>
  page.locator('header.pr-header:visible button[aria-haspopup="dialog"]');

/** The merge panel, once open. */
const mergePanel = (page: Page) => page.locator('[data-lo-scope="merge"]');

/** The offer of a GitHub stack's button, over the tree or in the merge panel. */
const convertIn = (place: ReturnType<Page['locator']>) =>
  place.getByRole('button', { name: /^Convert to GitHub stack/ });

/** The open Dismiss menu's rows. */
const dismissChoices = (page: Page) =>
  page.getByRole('menu', { name: 'Dismiss' }).getByRole('menuitem');

test('draws the stack above the files, with each layer’s marks, the offer and the notes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page, STACK.c);
  const stack = page.getByRole('region', { name: 'Stack' });
  await expect(stack).toContainText(/Branch.*\b4 layers/, { timeout: 20_000 });
  await expect(treeOf(page).getByRole('treeitem')).toHaveText([
    /^Stack A: load per-plan limits/,
    /^Stack B: rate limit GraphQL queries by cost/,
    /^Stack C: count a query's nodes/,
    new RegExp(`^Stack D: log when a plan's limit is reached.*Based on #${STACK.a}$`),
  ]);
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c));
  // #B has an overview, from the repository's refs; the layer on screen shows the overview's own
  // mark; and the other layers count their viewed files from the layers' state.
  await expect(rowOf(page, STACK.b).getByRole('img', { name: 'Overview' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(rowOf(page, STACK.a).getByRole('img', { name: 'No overview yet' })).toBeVisible();
  await expect(rowOf(page, STACK.c).getByRole('img', { name: 'No overview yet' })).toBeVisible();
  await expect(
    rowOf(page, STACK.a).getByRole('img', { name: /^\d+ \/ \d+ files viewed$/ }),
  ).toBeVisible();
  // #C's diff starts at #B's head, so it shows one file, and the layer's row and the files' head
  // count that one, not the three its pull request changes against `stack/root`.
  await expect(rowOf(page, STACK.c).getByRole('img', { name: '0 / 1 files viewed' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('region', { name: 'Files' })).toContainText('0 / 1 viewed');
  // #A, #B and #C could be a GitHub stack, which is offered in a line.
  await expect(stack).toContainText(/\bone layer at a time\b/);
  await expect(stack.getByRole('button', { name: /^Convert to GitHub stack/ })).toBeVisible();
  // Its Dismiss asks where: for this stack, which main keeps, or for all stacks, which turns its
  // setting off. Esc gives Dismiss focus back, where ⇧F10 opens the same menu, ready for ⏎. For
  // this stack, it goes, and the tree has the keys.
  const dismiss = stack.getByRole('button', { name: 'Dismiss' });
  await dismiss.click();
  const choices = page.getByRole('menu', { name: 'Dismiss' }).getByRole('menuitem');
  await expect(choices).toHaveText([/^Dismiss for this stack/, /^Dismiss for all stacks/]);
  await page.keyboard.press('Escape');
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(choices).toHaveText([/^Dismiss for this stack/, /^Dismiss for all stacks/]);
  // From the keyboard, the first row is highlighted a frame after the menu draws.
  await expect(choices.and(page.locator('[data-highlighted]'))).toHaveText(
    /^Dismiss for this stack/,
  );
  await page.keyboard.press('Enter');
  await expect(stack.getByRole('button', { name: /^Convert to GitHub stack/ })).toHaveCount(0);
  await expect(treeOf(page)).toBeFocused();
  // The files are still there, under the stack.
  await expect(page.getByRole('region', { name: 'Files' })).toBeVisible();

  await open(page, STACK.e);
  await expect(stack).toContainText(/Branch.*\b1 layer/, { timeout: 20_000 });
  // Its row says it needs a rebase; no note says it again.
  await expect(rowOf(page, STACK.e)).toContainText(/\brebase/);
  await expect(stack.getByRole('note')).toHaveCount(0);

  // A GitHub stack is offered nothing.
  await open(page, STACK.g2);
  await expect(stack).toContainText(/GitHub.*\b2 layers/, { timeout: 20_000 });
  await expect(stack.getByRole('button', { name: /^Convert to GitHub stack/ })).toHaveCount(0);
});

test('the merge panel offers the GitHub stack the tree offers, and a dismissal in either place takes both', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  await convertible(app);
  await open(page, STACK.c);
  const tree = page.getByRole('region', { name: 'Stack' });
  const status = mergeStatus(page);
  const panel = mergePanel(page);
  await expect(convertIn(tree)).toBeVisible({ timeout: 20_000 });
  await expect(status).toContainText('Ready to merge', { timeout: 20_000 });
  await status.click();
  await expect(panel.getByText(ONE_AT_A_TIME)).toBeVisible();
  await expect(convertIn(panel)).toBeVisible();
  // Each change to the page, noted as whether each offer is there and not leaving: none has one
  // without the other.
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(window, 'offersSeen', seen);
    new MutationObserver(() => {
      const made = ['section[aria-label="Stack"]', '[data-lo-scope="merge"]'].map((place) =>
        [...document.querySelectorAll(`${place} [data-lo-scope="notice"]`)].some(
          (offer) => offer.closest('[inert]') === null,
        ),
      );
      seen.push(made.join(' '));
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const offersSeen = () =>
    page.evaluate(() => {
      const seen: unknown = Reflect.get(window, 'offersSeen');
      return Array.isArray(seen) ? seen.map(String) : [];
    });

  // The panel's Dismiss asks where, as the tree's does. For all stacks, both go, and the panel
  // stays, with its keys, the method switch under its head.
  await panel.getByRole('button', { name: 'Dismiss' }).click();
  const choices = dismissChoices(page);
  await expect(choices).toHaveText([/^Dismiss for this stack/, /^Dismiss for all stacks/]);
  await choices.filter({ hasText: /^Dismiss for all stacks/ }).click();
  await expect(convertIn(tree)).toHaveCount(0);
  await expect(convertIn(panel)).toHaveCount(0);
  await expect(panel.getByRole('radiogroup')).toBeVisible();
  await expect.poll(() => scopeOf(page)).toBe('merge');
  expect(await offersSeen()).toContain('true true');
  expect((await offersSeen()).at(-1)).toBe('false false');
  expect(await offersSeen()).not.toContain('true false');
  expect(await offersSeen()).not.toContain('false true');

  // Settings turns it on again: both come back together.
  await page.evaluate(() =>
    window.lo.invoke('settings.set', { key: 'stacks.offerConvert', value: true }),
  );
  await expect(convertIn(panel)).toBeVisible({ timeout: 10_000 });
  await expect(convertIn(tree)).toBeVisible();
  expect((await offersSeen()).at(-1)).toBe('true true');
  expect(await offersSeen()).not.toContain('true false');
  expect(await offersSeen()).not.toContain('false true');

  // Dismissed over the tree for this stack, it's gone from the panel too, which still merges
  // nothing until the chain is a GitHub stack.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await tree.getByRole('button', { name: 'Dismiss' }).click();
  await choices.filter({ hasText: /^Dismiss for this stack/ }).click();
  await expect(convertIn(tree)).toHaveCount(0);
  await status.click();
  await expect(panel.getByRole('radiogroup')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Merge #/ })).toHaveAttribute(
    'aria-description',
    /\bConvert\b/,
  );
  await expect(convertIn(panel)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
});

test.describe('with moves on', () => {
  test.use({ motion: 'on' });

  test('the tree and the merge panel keep the keys once their offer of a GitHub stack, dismissed there, has gone', async ({
    app,
    page,
  }) => {
    test.setTimeout(90_000);
    await convertible(app);
    await open(page, STACK.c);
    const tree = page.getByRole('region', { name: 'Stack' });
    const panel = mergePanel(page);
    await expect(convertIn(tree)).toBeVisible({ timeout: 20_000 });
    // Over the tree, for all stacks: once the offer and the menu have gone, the tree has focus.
    await tree.getByRole('button', { name: 'Dismiss' }).click();
    await dismissChoices(page)
      .filter({ hasText: /^Dismiss for all stacks/ })
      .click();
    await expect(tree.locator('[data-lo-scope="notice"]')).toHaveCount(0);
    await expect(page.getByRole('menu', { name: 'Dismiss' })).toHaveCount(0);
    await expect(tree.getByRole('tree', { name: 'Layers' })).toBeFocused();
    await page.evaluate(() =>
      window.lo.invoke('settings.set', { key: 'stacks.offerConvert', value: true }),
    );
    await expect(convertIn(tree)).toBeVisible({ timeout: 10_000 });

    await expect(mergeStatus(page)).toContainText('Ready to merge', { timeout: 20_000 });
    await mergeStatus(page).click();
    await expect(convertIn(panel)).toBeVisible({ timeout: 20_000 });
    // The menu gives focus back to Dismiss, which leaves with the offer, in its move, while the
    // menu fades: once both have gone, the panel has the keys.
    await panel.getByRole('button', { name: 'Dismiss' }).click();
    await dismissChoices(page)
      .filter({ hasText: /^Dismiss for this stack/ })
      .click();
    await expect(panel.locator('[data-lo-scope="notice"]')).toHaveCount(0);
    await expect(page.getByRole('menu', { name: 'Dismiss' })).toHaveCount(0);
    await expect.poll(() => scopeOf(page)).toBe('merge');
    // `⇧⇥` goes to the previous merge method, as it does anywhere in the panel: round to a rebase,
    // whose commit text isn't read.
    const chosen = panel.locator('[role="radio"][aria-checked="true"]');
    await expect(chosen).toHaveText('Merge commit');
    await page.keyboard.press('Shift+Tab');
    await expect(chosen).toHaveText('Rebase');
  });
});

test(']s and [s walk the layers in the tree’s order, in one tab, and stop at the ends; and a link to any layer shows it in the tab its stack is in', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const a = await open(page, STACK.a);

  await test.step(']s and [s walk the layers in the tree’s order, in one tab, and stop at the ends', async () => {
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
    await expect(tabBanners(page)).toHaveCount(0);
    await type(page, ']', 's');
    await expect(said(page, new RegExp(`#${STACK.d}\\b.*\\btop\\b`))).toHaveCount(1);
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
    await expect(said(page, new RegExp(`#${STACK.a}\\b.*\\bbottom\\b`))).toHaveCount(1);
    expect(await pullTabs(page)).toBe(1);
  });

  // The stack's tab is where it was: a link to a layer shows it there.
  await test.step('a link to any layer shows it in the tab its stack is in', async () => {
    await open(page, STACK.c);
    await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
    expect(await open(page, STACK.d)).toBe(`${a}:${STACK.d}`);
    await expect(current(page)).toHaveAttribute('data-key', String(STACK.d), { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Stack D: log when a plan's limit is reached",
    );
    expect(await pullTabs(page)).toBe(1);
  });
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

  // A layer's menu shows it, opens it on GitHub, or converts its chain to a GitHub stack.
  await rowOf(page, STACK.d).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Layer actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^Show layer/,
    /^Select layers/,
    /^Show layers 1–2/,
    /^Open on GitHub/,
    /^Convert to GitHub stack…/,
  ]);
  await menu.getByRole('menuitem', { name: /^Open on GitHub/ }).click();
  await expect.poll(() => browsed()).toEqual([`https://github.com/rozed-dev/e2e/pull/${STACK.d}`]);
  await rowOf(page, STACK.c).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Show layer', exact: true }).click();
  await expect(current(page)).toHaveAttribute('data-key', String(STACK.c), { timeout: 20_000 });
  expect(await pullTabs(page)).toBe(1);
});

/** The bar over layers shown as one diff, named for them: "Layers 2–3". */
const bar = (page: Page) => page.getByRole('region', { name: /^Layers \d/ });

test.describe('a run of layers', () => {
  test('v, j and ⏎ show #B and #C as one diff, with no marks, and Esc comes back to #C’s place; and shows the stack up to a layer from its menu, and its bar goes back', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const c = await open(page, STACK.c);

    await test.step('v, j and ⏎ show #B and #C as one diff, with no marks, and Esc comes back to #C’s place', async () => {
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
      await expect(stack).toContainText('1 selected');
      // #D sits on #A, on another branch: `j` from #B goes to #C, and no further.
      await type(page, 'j', 'j');
      const selecting = stack.getByRole('note').first();
      await expect(selecting).toContainText(new RegExp(`\\b2–3\\b.*#${STACK.a}`));
      await expect(selecting.getByRole('button', { name: /^Show layers 2–3/ })).toBeVisible();
      await expect(selecting.getByRole('button', { name: /^Stop/ })).toBeVisible();
      await expect(rowOf(page, STACK.d)).toHaveAttribute('data-dim', '');
      await type(page, 'Enter');

      await expect(bar(page)).toContainText(
        new RegExp(
          `\\b2–3\\b.*#${STACK.b} Stack B: rate limit GraphQL queries by cost\\b.*#${STACK.c} Stack C: count a query's nodes`,
        ),
        { timeout: 20_000 },
      );
      // The window's default width has no room for the branches beside the layers' names, so the bar
      // leaves them out and keeps the count of files whole.
      await expect(bar(page).getByText('2 files')).toBeVisible({ timeout: 20_000 });
      await expect(bar(page).getByText('stack/a → stack/c')).toBeHidden();
      await expect(bar(page).getByRole('button')).toHaveText(/^Show single layer/);
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
      await expect(page.getByRole('note', { name: 'Comparison' })).toHaveText(
        new RegExp(`^#${STACK.b} → #${STACK.c}\\b.*\\bevery change\\b`),
      );
      await expect(page.locator('[data-tab]').first()).toContainText(`#${STACK.c}`);
      await expect(page.locator('[data-tab]').first()).not.toContainText(`#${STACK.b}`);
      // It opens on its diff, which marks no file viewed, and `e` says why; it compares no
      // revisions.
      await settled(page);
      await expect(header(page, 'src/cost.ts')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.lo-diffview .lo-diffhead__ball')).toHaveCount(0);
      await expect(page.locator('button[data-lo-revisions]')).toHaveCount(0);
      await inDiff(page);
      await type(page, 'e');
      await expect(said(page, /\bsingle layer\b/)).toHaveCount(1);

      await type(page, 'Escape');
      await expect(bar(page)).toHaveCount(0, { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-key', String(STACK.c));
      await expect.poll(cursor, { timeout: 20_000 }).toBe(before);
      expect(await pullTabs(page)).toBe(1);
    });

    // Back on #C, as the run left it.
    await test.step('shows the stack up to a layer from its menu, and its bar goes back', async () => {
      await rowOf(page, STACK.c).click({ button: 'right' });
      await page
        .getByRole('menu', { name: 'Layer actions' })
        .getByRole('menuitem', { name: /^Show layers 1–3/ })
        .click();
      await expect(bar(page)).toContainText(
        new RegExp(`\\b1–3\\b.*#${STACK.a} Stack A: load per-plan limits\\b.*#${STACK.b}`),
        { timeout: 20_000 },
      );
      await expect
        .poll(() => diffOf(page, `${c}:${STACK.a}-${STACK.c}`), { timeout: 20_000 })
        .toMatchObject({
          compareFrom: STACK_PULLS.root,
          files: ['src/cost.ts', 'src/nodes.ts', 'src/plans.ts'],
        });
      await bar(page)
        .getByRole('button', { name: /^Show single layer/ })
        .click();
      await expect(bar(page)).toHaveCount(0, { timeout: 20_000 });
      await expect(current(page)).toHaveAttribute('data-key', String(STACK.c));
    });
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
      await expect(tabBanners(page)).toHaveCount(0);
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
        .filter({ hasText: 'This diff includes #83’s changes' });
      await expect(banner).toBeVisible({ timeout: 20_000 });
      expect(await diffOf(page, c)).toMatchObject({ compareFrom: null });
      await expect(header(page, 'src/plans.ts')).toBeVisible();

      await banner.getByRole('button', { name: 'Hide #83’s changes' }).click();
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
        await page.getByRole('button', { name: 'Hide #83’s changes' }).click({ timeout: 20_000 });
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
