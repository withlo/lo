// @vitest-environment jsdom
// The merge's dialog, with main answered by a stand-in bridge: the confirmation states who merges,
// how, into what and which revision; only a fresh `⏎` once it shows confirms, never a held one, the
// press that opened it or one a field took; the merge goes on as main says, and once it merged the
// dialog goes and a toast says so; a refusal says why and offers the newer push; and `Esc` before
// confirming forgets the plan. Auto-merge's says what GitHub waits for and what a push would do; a
// merge past the rules lists what it skips and goes only with the number typed, asked afresh each
// time; and auto-merge GitHub won't turn on, as it can merge now, shows the merge in its place.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { JobView, MergePlan, MergeState } from '../contract.ts';
import feature from './index.ts';
import { MergeConfirm } from './MergeConfirm.tsx';
import { heardJob, newerFrom, typeNumber } from './merging.ts';
import { merging, statuses } from './store.ts';

const HEAD = 'a'.repeat(40);

/** How main answers a confirmation: sent, unless a test says. */
let confirming: () => unknown = () => ({ kind: 'sent' });

const bridge = installBridge({
  'merge.confirm': () => confirming(),
  'merge.cancel': () => undefined,
  'merge.askAgain': () => undefined,
  'merge.dismiss': () => undefined,
  'merge.sent': () => [],
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
});

beforeEach(() => {
  confirming = () => ({ kind: 'sent' });
  bridge.calls.length = 0;
  merging.setState({ dialog: undefined, jobs: new Map(), seen: new Set() });
  statuses.setState({ views: new Map() });
});

function planOf(change: Partial<MergePlan> = {}): MergePlan {
  return {
    key: '00000000-0000-4000-8000-000000000001',
    id: 't1',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 138,
    login: 'rozed-bot',
    kind: 'merge',
    method: 'SQUASH',
    base: 'main',
    head: HEAD,
    title: 'Rate limit by cost',
    message: '',
    ...change,
  };
}

function jobOf(plan: MergePlan, state: JobView['state']): JobView {
  const { key, owner, repo, number, login, kind, method, base, head } = plan;
  return { key, owner, repo, number, login, kind, method, base, head, already: false, state };
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

/** A key-down of `⏎`, made now, so stamped now. */
function enter(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
}

function confirms(): number {
  return bridge.calls.filter(([channel]) => channel === 'merge.confirm').length;
}

it('states who merges, how, into what and which revision, and that Lo deletes no branches', async () => {
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: { kind: 'confirm', plan: planOf(), note: undefined, sending: false },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Merge #138 into main?');
  expect([...box.querySelectorAll('dt')].map((each) => each.textContent)).toEqual([
    'As',
    'Method',
    'Into',
    'Revision',
    'Commit',
  ]);
  const values = [...box.querySelectorAll('dd')].map((each) => each.textContent);
  expect(values.slice(1)).toEqual([
    'Squash',
    'main',
    'aaaaaaa of #138, the one on screen',
    'Rate limit by cost',
  ]);
  expect(box.textContent).toContain('Lo deletes no branches; the repo’s own setting applies.');
  expect(box.textContent).toContain('Squash and merge');

  // Into a merge queue, whose settings choose the method.
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ kind: 'enqueue', base: 'e4/queued', method: null, title: '' }),
        note: undefined,
        sending: false,
      },
    }),
  );
  expect(box.textContent).toContain('Add #138 to the merge queue for e4/queued?');
  expect(box.textContent).toContain('The queue’s settings choose the method and the message.');
  expect(box.textContent).not.toContain('Method');
  expect(box.textContent).toContain('Add to merge queue');
});

it('confirms only on a fresh `⏎` once it shows, then follows the merge until a toast says it merged', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  // The press that opened it went down before it showed.
  const opening = enter();
  await later();
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  await later();
  act(() => {
    dialog()!.dispatchEvent(opening);
  });
  // Held, it repeats; a field inside may take a press for itself.
  act(() => {
    dialog()!.dispatchEvent(enter({ repeat: true }));
  });
  const taken = enter();
  taken.preventDefault();
  act(() => {
    dialog()!.dispatchEvent(taken);
  });
  expect(confirms()).toBe(0);

  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  await until(() => merging.getState().dialog?.kind === 'sent');
  expect(confirms()).toBe(1);
  expect(bridge.calls.find(([channel]) => channel === 'merge.confirm')?.[1]).toEqual({
    key: plan.key,
  });
  expect(dialog()?.textContent).toContain('Sending');

  act(() => heardJob(jobOf(plan, { kind: 'pending', trouble: null })));
  expect(dialog()?.textContent).toContain(
    'GitHub is merging it. You can close this; the tab shows how it ends.',
  );
  // Nothing more is confirmed, however often `⏎` is pressed.
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  expect(confirms()).toBe(1);

  act(() => heardJob(jobOf(plan, { kind: 'merged' })));
  expect(merging.getState().dialog).toBeUndefined();
  expect(notice()).toMatchObject({ title: 'Merged #138 into main', done: true });
});

it('says why main refused it, and offers the newer push', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'refused',
        plan,
        refusal: {
          kind: 'newerPush',
          text: '#138 has a newer push than the one on screen, so Lo didn’t merge.',
          rules: [],
          until: null,
          newer: { from: HEAD, to: 'b'.repeat(40) },
        },
      },
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('#138 has a newer push than the one on screen');
  expect(dialog()?.textContent).toContain('See the newer push');
});

it('forgets the plan on `Esc` before it’s confirmed', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  act(() => {
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await until(() => merging.getState().dialog === undefined);
  expect(bridge.calls.find(([channel]) => channel === 'merge.cancel')?.[1]).toEqual({
    key: plan.key,
  });
  expect(confirms()).toBe(0);
});

it('offers the newer push a refusal names, or one Lo read since a refusal that names none', () => {
  const refusal = { kind: 'failed', text: 'Pull Request is not mergeable', rules: [], until: null };
  const NEWER = 'b'.repeat(40);
  // GitHub's "not mergeable" just after a push names none: only a newer push read since is offered.
  expect(newerFrom({ ...refusal, newer: null }, HEAD, undefined)).toBeUndefined();
  expect(newerFrom({ ...refusal, newer: null }, HEAD, HEAD)).toBeUndefined();
  expect(newerFrom({ ...refusal, newer: null }, HEAD, NEWER)).toEqual({ from: HEAD, to: NEWER });
  // One that names it offers it, with the newer head as GitHub said, else as Lo read it since.
  const moved = { ...refusal, kind: 'newerPush', newer: { from: HEAD, to: null } };
  expect(newerFrom(moved, HEAD, undefined)).toEqual({ from: HEAD, to: undefined });
  expect(newerFrom(moved, HEAD, NEWER)).toEqual({ from: HEAD, to: NEWER });
  expect(newerFrom({ ...moved, newer: { from: HEAD, to: 'c'.repeat(40) } }, HEAD, NEWER)).toEqual({
    from: HEAD,
    to: 'c'.repeat(40),
  });
});

it('says it’s checking once confirmed, and `Esc` then cancels it in main', async () => {
  const plan = planOf();
  let answer: ((confirmed: unknown) => void) | undefined;
  confirming = () => new Promise((resolve) => (answer = resolve));
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  await until(() => dialog()?.textContent?.includes('Checking #138 with GitHub') === true);

  act(() => {
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await until(() => merging.getState().dialog === undefined);
  expect(bridge.calls.find(([channel]) => channel === 'merge.cancel')?.[1]).toEqual({
    key: plan.key,
  });

  // Had main sent it before the cancel reached it, the reader is told it went.
  await act(async () => {
    answer?.({ kind: 'sent' });
    await Promise.resolve();
  });
  await until(() => notice()?.body.startsWith('Lo had sent') === true);
  expect(notice()).toMatchObject({
    body: 'Lo had sent #138’s merge already. The tab shows how it ends.',
  });
});

it('draws the base in the title without bidi controls', async () => {
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ base: 'main\u202Eevil' }),
        note: undefined,
        sending: false,
      },
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
});

it('offers to ask GitHub again when Lo can’t tell how the last merge went, and goes back', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'refused',
        plan,
        refusal: {
          kind: 'unsettled',
          text: 'Lo can’t tell whether #138 merged.',
          rules: [],
          until: null,
          newer: null,
        },
      },
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('Lo can’t tell whether #138 merged.');
  expect(dialog()?.textContent).toContain('Ask GitHub again');
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  await until(() => merging.getState().dialog === undefined);
  expect(bridge.calls.find(([channel]) => channel === 'merge.askAgain')?.[1]).toEqual({
    key: plan.key,
  });
});

/** #138 as Lo last read it in view `t1`, waiting on two checks, at the head the plans merge. */
function readAs(change: Partial<MergeState> = {}): void {
  const state: MergeState = {
    verdict: 'waiting',
    position: null,
    blockers: [
      { kind: 'check', check: { name: 'e2e (chromium)', state: 'running', url: null } },
      { kind: 'check', check: { name: 'typecheck', state: 'yet', url: null } },
    ],
    autoMerge: null,
    partial: false,
    incomplete: null,
    action: { kind: 'notPossible', reason: 'blocked' },
    auto: { kind: 'on' },
    override: { kind: 'notPossible', reason: 'noPermission' },
    afterPush: 'keepsApprovals',
    picked: 'SQUASH',
    methods: { merge: true, squash: true, rebase: true },
    signedCommits: false,
    unchecked: [],
    base: 'main',
    queue: { required: false, method: null },
    approvedBy: ['jun-park'],
    checks: { passed: 0, total: 2 },
    url: 'https://github.com/rozed-dev/e2e/pull/138',
    head: HEAD,
    readAt: Date.now(),
    stale: null,
    off: null,
    ...change,
  };
  statuses.setState({ views: new Map([['t1', { kind: 'known', state }]]) });
}

it('turning on auto-merge says what GitHub waits for, and what a push before then would do', async () => {
  readAs();
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ kind: 'autoMerge', title: '' }),
        note: undefined,
        sending: false,
      },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Merge #138 when it’s ready?');
  expect(box.textContent).toContain(
    'GitHub squashes #138 into main once e2e (chromium) and typecheck pass.',
  );
  expect(box.textContent).toContain(
    'A push before it merges would merge with the approvals already given.',
  );
  expect(box.textContent).toContain('Merge when ready');

  // On a branch with a merge queue, GitHub adds it to the queue once they pass.
  readAs({
    base: 'e4/queued',
    queue: { required: true, method: 'SQUASH' },
    afterPush: 'newApproval',
  });
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ kind: 'whenReady', base: 'e4/queued', title: '' }),
        note: undefined,
        sending: false,
      },
    }),
  );
  expect(box.textContent).toContain(
    'GitHub adds #138 to the merge queue for e4/queued once e2e (chromium) and typecheck pass.',
  );
  expect(box.textContent).toContain(
    'The queue’s settings choose the method and the message: squash.',
  );
  expect(box.textContent).not.toContain('A push before it merges');
  expect(box.textContent).not.toContain('Method');
});

it('merges past the rules only with the number typed, which it asks for afresh when it asks again', async () => {
  readAs({ verdict: 'blocked', override: { kind: 'override' } });
  const plan = planOf({ kind: 'override' });
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Merge #138 without the rules?');
  expect(box.textContent).toContain('You can bypass main’s rules in rozed-dev/e2e.');
  expect(box.textContent).toContain('This skips:');
  expect(box.textContent).toContain('2 required checks');
  expect(box.textContent).toContain('Type 138 to confirm');
  const field = () => box.querySelector('input')!;
  const button = [...box.querySelectorAll('button')].find((each) =>
    each.textContent?.includes('Merge anyway'),
  )!;
  expect(button.getAttribute('aria-disabled')).toBe('true');
  await later();

  // Not typed, or typed wrong, neither `⏎` nor the button confirms.
  act(() => {
    box.dispatchEvent(enter());
  });
  act(() => typeNumber('13'));
  act(() => {
    field().dispatchEvent(enter());
  });
  act(() => button.click());
  expect(confirms()).toBe(0);

  // Typed, `⏎` in the field confirms once, with the number.
  const again = planOf({ kind: 'override', key: '00000000-0000-4000-8000-000000000002' });
  confirming = () => ({ kind: 'again', plan: again, why: 'Someone approved #138.' });
  act(() => typeNumber('138'));
  expect(field().value).toBe('138');
  act(() => {
    field().dispatchEvent(enter());
  });
  await until(() => {
    const now = merging.getState().dialog;
    return now?.kind === 'confirm' && now.plan.key === again.key;
  });
  expect(bridge.calls.find(([channel]) => channel === 'merge.confirm')?.[1]).toEqual({
    key: plan.key,
    typed: '138',
  });
  // Asked again, the field is empty again.
  expect(field().value).toBe('');
  expect(box.textContent).toContain('Someone approved #138.');
});

it('shows the merge main planned in auto-merge’s place when GitHub says it can merge now', async () => {
  const plan = planOf({ kind: 'autoMerge', title: '' });
  const offer = planOf({ kind: 'merge', key: '00000000-0000-4000-8000-000000000003' });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: { kind: 'sent', plan } }));
  await until(() => dialog() !== null);
  act(() =>
    heardJob(
      jobOf(plan, {
        kind: 'refused',
        refusal: {
          kind: 'canMergeNow',
          text: 'Nothing blocks #138 now, so GitHub didn’t turn on auto-merge. It can merge as it is.',
          rules: [],
          until: null,
          newer: null,
          offer,
        },
      }),
    ),
  );
  await until(() => merging.getState().dialog?.kind === 'confirm');
  expect(dialog()?.textContent).toContain('Merge #138 into main?');
  expect(dialog()?.textContent).toContain('It can merge as it is.');
  // Seen here, it needs no banner.
  expect(bridge.calls.find(([channel]) => channel === 'merge.dismiss')?.[1]).toEqual({
    key: plan.key,
  });
});
