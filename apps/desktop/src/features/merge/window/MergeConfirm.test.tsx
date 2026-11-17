// @vitest-environment jsdom
// The merge's dialog, with main answered by a stand-in bridge: the confirmation states who merges,
// how, into what and which revision; only a fresh `⏎` once it shows confirms, never a held one, the
// press that opened it or one a field took; the merge goes on as main says, and once it merged the
// dialog goes and a toast says so; a refusal says why and offers the newer push; and `Esc` before
// confirming forgets the plan.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { JobView, MergePlan } from '../contract.ts';
import feature from './index.ts';
import { MergeConfirm } from './MergeConfirm.tsx';
import { heardJob, newerFrom } from './merging.ts';
import { merging } from './store.ts';

const HEAD = 'a'.repeat(40);

const bridge = installBridge({
  'merge.confirm': () => ({ kind: 'sent' }),
  'merge.cancel': () => undefined,
  'merge.dismiss': () => undefined,
  'merge.sent': () => [],
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
});

beforeEach(() => {
  bridge.calls.length = 0;
  merging.setState({ dialog: undefined, jobs: new Map(), seen: new Set() });
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
