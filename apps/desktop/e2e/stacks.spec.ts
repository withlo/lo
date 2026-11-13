// The stacks in the app: Lo, started on the replay server as rozed-bot, finds the stack each pull
// request's tab is in, among rozed-dev/e2e's open pull requests and the merged ones they link
// through, and reads the state of the layers of the stack on screen. A layer's diff leaves out the
// layers below it, from GitHub's comparison until the local copy is ready, and a stack found only
// once the diff is drawn offers that in a banner.

import { STACK_PULLS, writeStackRemote } from '@lo/testing/git';
import type { Page } from '@playwright/test';

import type { DiffState } from '../src/features/diff/contract.ts';
import type { StackState } from '../src/features/stacks/contract.ts';
import { DIFF_FIRST, expect, onStacks as test, STACK } from './app.ts';

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

/** The stack tab `id` shows, as main has it, briefly: its head, and each row with its marks. */
async function stackOf(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('stacks.state', { id: tab }), id);
  if (!reply.ok) return reply;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what the contract says.
  const stack = (reply.value as StackState | undefined)?.stack;
  if (stack?.kind !== 'stack') return stack;
  return {
    head: stack.head,
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

test('finds the stack each tab is in, and reads the state of its layers on screen', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const c = await open(page, STACK.c);
  await expect
    .poll(() => stackOf(page, c), { timeout: 20_000 })
    .toEqual({
      head: '4 layers · by base branch and shared commits',
      root: 'stack/root',
      rows: [
        [STACK.a, '', '', 'layers'],
        [STACK.b, '', '', 'layers'],
        [STACK.c, 'current', '', 'tab'],
        [STACK.d, '', `on #${STACK.a}`, 'layers'],
      ],
    });

  // #E sits alone on #M, which was squash-merged: its stack is it alone, needing a rebase.
  const e = await open(page, STACK.e);
  await expect
    .poll(() => stackOf(page, e), { timeout: 20_000 })
    .toEqual({
      head: '1 layer',
      root: 'stack/mroot',
      rows: [[STACK.e, 'current', '', 'tab']],
    });

  const g2 = await open(page, STACK.g2);
  await expect
    .poll(() => stackOf(page, g2), { timeout: 20_000 })
    .toEqual({
      head: 'GitHub stack · 2 layers',
      root: 'stack/root',
      rows: [
        [STACK.g1, '', '', 'layers'],
        [STACK.g2, 'current', '', 'tab'],
      ],
    });
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
