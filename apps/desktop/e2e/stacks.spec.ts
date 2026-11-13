// The stacks in the app: Lo, started on the replay server as rozed-bot, finds the stack each pull
// request's tab is in, among rozed-dev/e2e's open pull requests and the merged ones they link
// through, and reads the state of the layers of the stack on screen.

import type { Page } from '@playwright/test';

import type { StackState } from '../src/features/stacks/contract.ts';
import { expect, onStacks as test, STACK } from './app.ts';

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

  // #E sits alone on #M, which was squash-merged: no stack, and nothing read for it.
  const e = await open(page, STACK.e);
  await expect.poll(() => stackOf(page, e), { timeout: 20_000 }).toEqual({ kind: 'none' });

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
