// @vitest-environment jsdom
// Approve and ship's dialog, with main answered by a stand-in bridge: the confirmation lists its
// steps, naming the revision it approves first; only a fresh `⏎` once it shows confirms, never a
// held one or the press that opened it; it follows the run, and once the merge it sent is done the
// dialog goes and a toast says so; a stop after approving says the approval stays and offers the
// merge panel, `m`; a newer push before approving says nothing was approved and offers it.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { JobView, ShipPlan, ShipView } from '../contract.ts';
import feature from './index.ts';
import { heardJob } from './merging.ts';
import { ShipDialog } from './ShipDialog.tsx';
import { followShipJobs, heardShip } from './shipping.ts';
import { merging, shipping, statuses } from './store.ts';

const HEAD = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

/** How main answers a confirmation: started, unless a test says. */
let confirming: () => unknown = () => ({ kind: 'started' });

const bridge = installBridge({
  'merge.shipConfirm': () => confirming(),
  'merge.cancel': () => undefined,
  'merge.dismiss': () => undefined,
  'merge.sent': () => [],
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
  followShipJobs();
});

beforeEach(() => {
  confirming = () => ({ kind: 'started' });
  bridge.calls.length = 0;
  merging.setState({ dialog: undefined, jobs: new Map(), seen: new Set() });
  shipping.setState({ dialog: undefined, runs: new Map(), watched: new Map() });
  statuses.setState({ views: new Map() });
});

let keys = 0;

function planOf(change: Partial<ShipPlan> = {}): ShipPlan {
  keys += 1;
  return {
    key: `00000000-0000-4000-8000-${String(keys).padStart(12, '0')}`,
    id: 't1',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 138,
    login: 'rozed-bot',
    base: 'main',
    head: HEAD,
    approval: { kind: 'approve' },
    summary: true,
    likely: { kind: 'merge', method: 'SQUASH' },
    together: null,
    warning: false,
    afterPush: 'keepsApprovals',
    ...change,
  };
}

function viewOf(plan: ShipPlan, phase: ShipView['phase'], approved = true): ShipView {
  const { key, owner, repo, number, login, base, head, approval } = plan;
  return { key, owner, repo, number, login, base, head, approval, approved, phase };
}

function jobOf(plan: ShipPlan, key: string, state: JobView['state']): JobView {
  const { owner, repo, number, login, base, head } = plan;
  return {
    key,
    owner,
    repo,
    number,
    login,
    kind: 'merge',
    method: 'SQUASH',
    base,
    head,
    already: false,
    state,
    together: null,
  };
}

/** Draws `node` on the page, until the test ends. */
function draw(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** Lets what's waiting settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

/** A moment, so what happens next is stamped later than what came before. */
function later(): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

/** A key-down of `key`, made now, so stamped now. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
}

function confirms(): number {
  return bridge.calls.filter(([channel]) => channel === 'merge.shipConfirm').length;
}

/** The steps' text, a line each. */
function steps(): string[] {
  return [...(dialog()?.querySelectorAll('li') ?? [])].map((each) => each.textContent ?? '');
}

it('lists its steps, the revision it approves first, and confirms only on a fresh `⏎` once it shows', async () => {
  const plan = planOf({ approval: { kind: 'submitPending', comments: 1 } });
  draw(<ShipDialog />);
  // The press that opened it went down before it showed, and `⌘⇧⏎` again doesn't confirm it.
  const opening = press('Enter', { metaKey: true, shiftKey: true });
  const plain = press('Enter');
  await later();
  act(() =>
    shipping.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('Approve and ship #138?');
  expect(steps()).toEqual([
    expect.stringContaining('Check that aaaaaaa is still the newest push'),
    expect.stringContaining('Approve as rozed-bot'),
    expect.stringContaining('Squash and merge into main'),
  ]);
  expect(steps()[0]).toContain('Lo stops here and approves nothing');
  expect(steps()[1]).toContain('With your summary and 1 pending comment.');
  await later();
  for (const each of [opening, plain, press('Enter', { repeat: true })]) {
    act(() => {
      dialog()!.dispatchEvent(each);
    });
  }
  act(() => {
    dialog()!.dispatchEvent(press('Enter', { metaKey: true, shiftKey: true }));
  });
  expect(confirms()).toBe(0);

  act(() => {
    dialog()!.dispatchEvent(press('Enter'));
  });
  await until(() => shipping.getState().dialog?.kind === 'running');
  expect(confirms()).toBe(1);
  expect(bridge.calls.find(([channel]) => channel === 'merge.shipConfirm')?.[1]).toEqual({
    key: plan.key,
  });

  act(() => heardShip(viewOf(plan, { kind: 'approving' }, false)));
  expect(dialog()?.textContent).toContain('Approving and shipping #138');
  const job = '00000000-0000-4000-8000-0000000000ff';
  act(() =>
    heardShip(viewOf(plan, { kind: 'sending', step: { kind: 'merge', method: 'SQUASH' }, job })),
  );
  act(() => heardJob(jobOf(plan, job, { kind: 'pending', trouble: null })));
  expect(steps()[1]).toContain('Approved as rozed-bot');
  expect(steps()[2]).toContain('GitHub is merging it.');
  // Nothing more is confirmed, however often `⏎` is pressed.
  act(() => {
    dialog()!.dispatchEvent(press('Enter'));
  });
  expect(confirms()).toBe(1);

  act(() => heardJob(jobOf(plan, job, { kind: 'merged' })));
  expect(shipping.getState().dialog).toBeUndefined();
  expect(notice()).toMatchObject({ title: 'Approved and merged #138 into main', done: true });
});

it('a stop after approving says the approval stays, why, and offers the merge panel', async () => {
  const plan = planOf();
  draw(<ShipDialog />);
  act(() => shipping.setState({ dialog: { kind: 'running', plan } }));
  act(() =>
    heardShip(
      viewOf(plan, {
        kind: 'stopped',
        at: 'ship',
        refusal: { kind: 'blocked', text: 'Blocked.', rules: [], until: null, newer: null },
        stop: {
          kind: 'blocked',
          autoMerge: false,
          blockers: [{ kind: 'conflicts' }],
        },
      }),
    ),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('Approved, but not merged');
  expect(dialog()?.textContent).toContain('e2e #138 · your approval stays');
  expect(steps()[1]).toContain('Approved as rozed-bot');
  expect(steps()[2]).toContain('Can’t merge');
  expect(dialog()?.textContent).toContain('Merge panel');
  expect(dialog()?.textContent).toContain('Done');
});

it('a newer push before approving says nothing was approved, who pushed, and offers it', async () => {
  const plan = planOf();
  draw(<ShipDialog />);
  act(() =>
    shipping.setState({
      dialog: {
        kind: 'refused',
        id: plan.id,
        number: plan.number,
        plan,
        refusal: {
          kind: 'headMoved',
          text: 'Someone pushed.',
          rules: [],
          until: null,
          newer: { from: HEAD, to: NEWER },
        },
      },
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('A newer push arrived');
  expect(dialog()?.textContent).toContain('nothing was approved');
  expect(steps()[0]).toContain('Someone pushed bbbbbbb');
  expect(steps()[0]).toContain('You reviewed aaaaaaa.');
  expect(dialog()?.textContent).toContain('See the newer push');
});
