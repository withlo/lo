// @vitest-environment jsdom
// Approve and ship's dialog, with main answered by a stand-in bridge: one title and the revision it
// approves in every state, over its two steps, the approval then what follows it; the main button
// busy while Lo checks and while each step runs, saying which; only a fresh `⏎` once the plan shows
// confirms, never a held one or the press that opened it; once the merge it sent is done the dialog
// says so beside the mark's kiss, with Done, and a toast says it only when the dialog was closed
// before; a stop is a problem above the foot, with what its reason asks: the merge panel once it
// approved, Check again where Lo can't tell whether it did, and the newer revision once Lo has it.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished } from 'vitest';

import { notice, notices } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import {
  catchUpRevisions,
  revisionsOf,
  type ComparisonView,
} from '../../revisions/window/shared.ts';
import type { JobView, MergeState, ShipPlan, ShipView } from '../contract.ts';
import feature from './index.ts';
import { heardJob } from './merging.ts';
import { ShipDialog } from './ShipDialog.tsx';
import { followShipJobs, heardShip } from './shipping.ts';
import { merging, panels, shipping, statuses, takeStatus } from './store.ts';

const HEAD = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

/** A revision of view `t1`'s pull request: its head, and its number. */
function revisionOf(head: string, number: number): ComparisonView['revisions'][number] {
  return {
    head,
    number,
    pushedAt: { kind: 'unknown' },
    forced: null,
    pusher: null,
    rebased: false,
    available: true,
  };
}

/** View `t1`'s revisions: the one on screen, r3, and a newer push, r4. */
const REVISIONS: ComparisonView = {
  id: 't1',
  status: 'ready',
  revisions: [revisionOf(HEAD, 3), revisionOf(NEWER, 4)],
  base: null,
  markers: { review: null, lastSeen: null },
  shown: HEAD,
  comparison: null,
  pending: null,
  offered: null,
  waitingFor: null,
  nothingNewSince: null,
  replay: null,
  conflicted: 0,
  uncertain: false,
  problem: null,
};

/** How main answers a confirmation: started, unless a test says. */
let confirming: () => unknown = () => ({ kind: 'started' });
/** How main answers a request for a plan: with one, unless a test says. */
let planning: () => unknown = () => ({ kind: 'plan', plan: planOf() });

const bridge = installBridge({
  'merge.ship': () => planning(),
  'merge.shipConfirm': () => confirming(),
  'merge.cancel': () => undefined,
  'merge.dismiss': () => undefined,
  'merge.sent': () => [],
  'revisions.list': () => REVISIONS,
  'revisions.compare': () => undefined,
});

beforeAll(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
  followShipJobs();
  catchUpRevisions('t1');
  await until(() => revisionsOf('t1') !== undefined);
});

beforeEach(() => {
  confirming = () => ({ kind: 'started' });
  planning = () => ({ kind: 'plan', plan: planOf() });
  bridge.calls.length = 0;
  merging.setState({ dialog: undefined, jobs: new Map(), seen: new Set(), checking: new Set() });
  shipping.setState({ dialog: undefined, runs: new Map(), watched: new Map() });
  statuses.setState({ views: new Map() });
  panels.update('t1', (panel) => ({ ...panel, open: false }));
});

let keys = 0;

/** A key no plan or merge had before. */
function keyOf(): string {
  keys += 1;
  return `00000000-0000-4000-8000-${String(keys).padStart(12, '0')}`;
}

function planOf(change: Partial<ShipPlan> = {}): ShipPlan {
  return {
    key: keyOf(),
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

/** The merge status of view `t1`'s pull request, as read with GitHub's head at `head`. */
function readAt(head: string): MergeState {
  return {
    verdict: 'blocked',
    position: null,
    blockers: [{ kind: 'conflicts' }],
    autoMerge: null,
    partial: false,
    incomplete: null,
    action: { kind: 'notPossible', reason: 'blocked' },
    auto: { kind: 'on' },
    override: { kind: 'notPossible', reason: 'noPermission' },
    afterPush: 'keepsApprovals',
    picked: null,
    methods: { merge: true, squash: true, rebase: true },
    signedCommits: false,
    unchecked: [],
    base: 'main',
    queue: { required: false, method: null },
    approvedBy: [],
    checks: { passed: 0, total: 0 },
    url: 'https://github.com/rozed-dev/e2e/pull/138',
    head,
    readAt: 1,
    stale: null,
    off: null,
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

/** What a screen reader hears of `element`: its text, less what's hidden from it. */
function heard(element: Element | null | undefined): string {
  if (!element || element.getAttribute('aria-hidden') === 'true') return '';
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? '';
}

/** The dialog's title. */
function title(): string {
  return heard(document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? ''));
}

/** The line under the title. */
function description(): string {
  return heard(document.getElementById(dialog()?.getAttribute('aria-describedby') ?? ''));
}

/** The steps, each as a screen reader hears it, how it stands and what it is, then the line under it. */
function steps(): string[][] {
  const list = dialog()?.querySelector('ol[aria-label="Steps"]');
  return [...(list?.querySelectorAll('li') ?? [])].map((step) =>
    [...step.children].map((part) => heard(part)).filter((text) => text !== ''),
  );
}

/** The dialog's buttons, as a screen reader names them, in order. */
function buttons(): string[] {
  return [...(dialog()?.querySelectorAll('button') ?? [])].map((button) => heard(button));
}

/** The main button: what it says, and whether it's busy. */
function primary(): { says: string; busy: boolean } {
  const button = dialog()?.querySelector('button[data-fill]');
  return { says: heard(button), busy: button?.getAttribute('aria-busy') === 'true' };
}

/** Clicks the button a screen reader names `name`. */
function click(name: string): void {
  const button = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (each) => heard(each) === name,
  );
  expect(button).toBeDefined();
  act(() => button?.click());
}

/** The problem above the foot, if there's one: what failed, and why. */
function problem(): { title: string; reason: string | undefined } | undefined {
  const alert = dialog()?.querySelector('[role="alert"]');
  if (!alert) return undefined;
  const [what, why] = [...alert.querySelectorAll('p')].map((each) => each.textContent ?? '');
  return { title: what ?? '', reason: why };
}

/** The line that says what it did, once it's done, and whether the mark is beside it. */
function doneRow(): { line: string; mark: boolean } | undefined {
  const line = dialog()?.querySelector('p[role="status"]');
  if (!line) return undefined;
  return { line: heard(line), mark: line.previousElementSibling?.localName === 'svg' };
}

/** The notes on screen that name pull request `number`. */
function toastsOf(number: number): string[] {
  return notices()
    .map((note) => note.title)
    .filter((said) => said.includes(`#${number}`));
}

it('keeps one title over its two steps, checks while it plans and as it confirms, and confirms only on a fresh `⏎` once the plan shows', async () => {
  const plan = planOf({ approval: { kind: 'submitPending', comments: 1 } });
  let start: ((confirmed: unknown) => void) | undefined;
  confirming = () =>
    new Promise((resolve) => {
      start = resolve;
    });
  draw(<ShipDialog />);
  // The press that opened it went down before it showed, and `⌘⇧⏎` again doesn't confirm it.
  const opening = press('Enter', { metaKey: true, shiftKey: true });
  const plain = press('Enter');
  await later();
  act(() => shipping.setState({ dialog: { kind: 'planning', id: plan.id, number: plan.number } }));
  await until(() => dialog() !== null);
  expect(title()).toBe('Approve and ship #138?');
  expect(steps()).toEqual([]);
  expect(primary()).toEqual({ says: 'Checking…', busy: true });
  expect(buttons()).toEqual(['Cancel', 'Checking…']);

  act(() =>
    shipping.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  expect(title()).toBe('Approve and ship #138?');
  expect(description()).toBe('r3');
  expect(steps()).toEqual([
    [
      'Not yet: Approve #138 as rozed-bot.',
      'Your summary and 1 pending comment are submitted with it.',
    ],
    ['Not yet: Squash and merge it into main.'],
  ]);
  expect(buttons()).toEqual(['Cancel', 'Approve and ship']);
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

  // Pressed, main checks it again before anything is sent, and it can still be cancelled.
  act(() => {
    dialog()!.dispatchEvent(press('Enter'));
  });
  expect(confirms()).toBe(1);
  expect(bridge.calls.find(([channel]) => channel === 'merge.shipConfirm')?.[1]).toEqual({
    key: plan.key,
  });
  expect(primary()).toEqual({ says: 'Checking…', busy: true });
  expect(buttons()).toEqual(['Cancel', 'Checking…']);

  // Sent, Cancel turns to Close, and the main button says which step runs.
  expect(start).toBeDefined();
  act(() => start?.({ kind: 'started' }));
  await until(() => shipping.getState().dialog?.kind === 'running');
  expect(title()).toBe('Approve and ship #138?');
  expect(description()).toBe('r3');
  expect(buttons()).toEqual(['Close', 'Approving…']);
  act(() => heardShip(viewOf(plan, { kind: 'approving' }, false)));
  expect(steps()).toEqual([
    [
      'Now: Approve #138 as rozed-bot.',
      'Your summary and 1 pending comment are submitted with it.',
    ],
    ['Not yet: Squash and merge it into main.'],
  ]);
  expect(primary()).toEqual({ says: 'Approving…', busy: true });

  const job = keyOf();
  act(() =>
    heardShip(viewOf(plan, { kind: 'sending', step: { kind: 'merge', method: 'SQUASH' }, job })),
  );
  act(() => heardJob(jobOf(plan, job, { kind: 'pending', trouble: null })));
  expect(title()).toBe('Approve and ship #138?');
  expect(steps()).toEqual([
    ['Done: Approved as rozed-bot.'],
    ['Now: Squash and merge it into main.'],
  ]);
  expect(buttons()).toEqual(['Close', 'Merging…']);
  // GitHub can merge it now: Lo merges it instead, and the step says so in place.
  act(() =>
    heardJob(
      jobOf(plan, job, {
        kind: 'refused',
        refusal: { kind: 'canMergeNow', text: '', rules: [], until: null, newer: null },
      }),
    ),
  );
  expect(steps()).toEqual([['Done: Approved as rozed-bot.'], ['Now: Merge it into main.']]);
  expect(buttons()).toEqual(['Close', 'Merging…']);
  // Nothing more is confirmed, however often `⏎` is pressed.
  act(() => {
    dialog()!.dispatchEvent(press('Enter'));
  });
  expect(confirms()).toBe(1);
});

it('a run that ends while the dialog shows it stays there, says what it did beside the mark’s kiss, with Done, and no toast', async () => {
  const plan = planOf({ number: 264 });
  draw(<ShipDialog />);
  act(() => shipping.setState({ dialog: { kind: 'running', plan } }));
  const job = keyOf();
  act(() =>
    heardShip(viewOf(plan, { kind: 'sending', step: { kind: 'merge', method: 'SQUASH' }, job })),
  );
  act(() => heardJob(jobOf(plan, job, { kind: 'pending', trouble: null })));
  await until(() => dialog() !== null);
  expect(doneRow()).toBeUndefined();

  act(() => heardJob(jobOf(plan, job, { kind: 'merged' })));
  expect(shipping.getState().dialog?.kind).toBe('running');
  expect(title()).toBe('Approve and ship #264?');
  expect(description()).toBe('r3');
  expect(steps()).toEqual([
    ['Done: Approved as rozed-bot.'],
    ['Done: Squash and merge it into main.'],
  ]);
  expect(doneRow()).toEqual({ line: 'Approved and merged #264', mark: true });
  expect(buttons()).toEqual(['Done']);
  expect(primary()).toEqual({ says: 'Done', busy: false });
  expect(toastsOf(264)).toEqual([]);

  // `⏎` presses Done, and the dialog goes, with still no toast.
  await later();
  act(() => {
    dialog()!.dispatchEvent(press('Enter'));
  });
  expect(shipping.getState().dialog).toBeUndefined();
  expect(toastsOf(264)).toEqual([]);
});

it('a run whose dialog was closed before it ended says how it ended in a toast', async () => {
  const plan = planOf();
  draw(<ShipDialog />);
  act(() => shipping.setState({ dialog: { kind: 'running', plan } }));
  const job = keyOf();
  act(() =>
    heardShip(viewOf(plan, { kind: 'sending', step: { kind: 'merge', method: 'SQUASH' }, job })),
  );
  act(() => heardJob(jobOf(plan, job, { kind: 'pending', trouble: null })));
  await until(() => dialog() !== null);
  click('Close');
  expect(shipping.getState().dialog).toBeUndefined();

  act(() => heardJob(jobOf(plan, job, { kind: 'merged' })));
  expect(notice()).toEqual({ title: 'Approved and merged #138', body: '', done: true });
});

it('a stop after approving says it couldn’t merge it, and why, with the approval done in place, and Merge panel leaves for the panel', async () => {
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
  expect(title()).toBe('Approve and ship #138?');
  expect(description()).toBe('r3');
  expect(problem()).toEqual({
    title: 'Couldn’t merge #138',
    reason: 'Can’t merge yet. Conflicts.',
  });
  expect(steps()).toEqual([
    ['Done: Approved as rozed-bot.'],
    ['Stopped: Squash and merge it into main.'],
  ]);
  expect(buttons()).toEqual(['Close', 'Merge panel']);

  click('Merge panel');
  expect(shipping.getState().dialog).toBeUndefined();
  expect(panels.get(plan.id).open).toBe(true);
});

it('a stop where Lo can’t tell whether GitHub took the approval says it isn’t confirmed, not that it failed, and Check again only plans it afresh', async () => {
  const plan = planOf();
  const afresh = planOf({ approval: { kind: 'alreadyApproved' } });
  planning = () => ({ kind: 'plan', plan: afresh });
  draw(<ShipDialog />);
  act(() => shipping.setState({ dialog: { kind: 'running', plan } }));
  act(() =>
    heardShip(
      viewOf(
        plan,
        {
          kind: 'stopped',
          at: 'unsure',
          refusal: { kind: 'unknown', text: '', rules: [], until: null, newer: null },
          stop: null,
        },
        false,
      ),
    ),
  );
  await until(() => dialog() !== null);
  expect(title()).toBe('Approve and ship #138?');
  expect(problem()).toEqual({ title: 'Approval not confirmed', reason: 'GitHub didn’t respond.' });
  expect(steps()).toEqual([
    ['Stopped: Approve #138 as rozed-bot.', 'Your summary is submitted with it.'],
    ['Not done: Squash and merge it into main.'],
  ]);
  expect(buttons()).toEqual(['Close', 'Check again']);

  click('Check again');
  expect(problem()).toBeUndefined();
  expect(buttons()).toEqual(['Cancel', 'Checking…']);
  await until(() => shipping.getState().dialog?.kind === 'confirm');
  expect(bridge.calls.filter(([channel]) => channel === 'merge.ship')).toEqual([
    ['merge.ship', { id: plan.id }],
  ]);
  expect(confirms()).toBe(0);
  expect(steps()).toEqual([
    ['Done: Approved as rozed-bot.'],
    ['Not yet: Squash and merge it into main.'],
  ]);
  expect(buttons()).toEqual(['Cancel', 'Approve and ship']);
});

it('a newer push before approving says the revision is out of date, and offers the newer one once Lo has read it', async () => {
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
          newer: { from: HEAD, to: null },
        },
      },
    }),
  );
  await until(() => dialog() !== null);
  expect(title()).toBe('Approve and ship #138?');
  expect(description()).toBe('r3');
  expect(problem()).toEqual({
    title: 'Couldn’t approve #138',
    reason: 'This revision is out of date.',
  });
  // The steps stay as they were asked.
  expect(steps()).toEqual([
    ['Not yet: Approve #138 as rozed-bot.', 'Your summary is submitted with it.'],
    ['Not yet: Squash and merge it into main.'],
  ]);
  // Busy until Lo has read the newer revision.
  expect(primary()).toEqual({ says: 'Show latest', busy: true });

  act(() => takeStatus({ id: plan.id, view: { kind: 'known', state: readAt(NEWER) } }));
  expect(primary()).toEqual({ says: 'Show r4', busy: false });
  expect(buttons()).toEqual(['Close', 'Show r4']);
  click('Show r4');
  expect(shipping.getState().dialog).toBeUndefined();
  expect(bridge.calls).toContainEqual([
    'revisions.compare',
    { id: plan.id, from: HEAD, to: NEWER },
  ]);
});
