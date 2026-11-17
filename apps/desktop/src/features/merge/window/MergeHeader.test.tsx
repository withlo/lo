// @vitest-environment jsdom
// The header's merge status and the panel it opens, with main answered by a stand-in bridge: it
// shows nothing until main says, then the status as main says it; a click opens the panel with a
// row for each reason, whose runs open through main; a squash shows GitHub's commit text, read as
// the panel opens, which the reader's own text stands in front of. Where the pull request sits says
// what its main button merges: a GitHub stack's layers below it too, a chain's bottom layer alone,
// or nothing until the chain is a GitHub stack.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { MergeState, MergeView, Placement } from '../contract.ts';
import feature from './index.ts';
import { MergeHeader } from './MergeHeader.tsx';
import { panels } from './store.ts';

/** When the tests' statuses were read: now, so none is out of date unless a test says. */
const NOW = Date.now();

const RUN = 'https://github.com/rozed-dev/e2e/actions/runs/1';

/** What main says of each view's status, by its id. */
const views = new Map<string, MergeView>();

/** Where main says each view's pull request sits, by its id: alone unless a test says. */
const places = new Map<string, Placement>();

const bridge = installBridge({
  'merge.state': (input) =>
    views.get(String(Reflect.get(Object(input), 'id'))) ?? { kind: 'loading' },
  // The pull request's title, which its author wrote, with characters that turn text around.
  'merge.panel': () => ({
    title: 'Fixture M3: \u202Esquash\u202C and merge (#138)',
    message: '* Add \u2066squash.txt\u2069',
    head: 'a'.repeat(40),
  }),
  'merge.open': () => undefined,
  'merge.place': (input) =>
    places.get(String(Reflect.get(Object(input), 'id'))) ?? { kind: 'alone' },
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
  feature.start?.();
});

function tabOf(id: string, number = 138): PullTab {
  return { id, kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number, title: 't', state: 'open' };
}

/** A pull request ready to squash into `main`, with `change`. */
function state(change: Partial<MergeState> = {}): MergeState {
  return {
    verdict: 'ready',
    position: null,
    blockers: [],
    autoMerge: null,
    partial: false,
    incomplete: null,
    action: { kind: 'merge', methods: ['SQUASH', 'REBASE'], method: 'SQUASH' },
    picked: 'SQUASH',
    methods: { merge: false, squash: true, rebase: true },
    signedCommits: false,
    unchecked: [],
    base: 'main',
    queue: { required: false, method: null },
    approvedBy: [],
    checks: { passed: 1, total: 1 },
    url: 'https://github.com/rozed-dev/e2e/pull/138',
    head: 'a'.repeat(40),
    readAt: NOW,
    stale: null,
    off: null,
    ...change,
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

/** Lets what's waiting on main settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

/** The merge panel, once open: Base UI draws it into the page's root. */
function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-lo-scope="merge"]');
}

it('shows nothing until main says, then opens the panel with each reason', async () => {
  const page = draw(<MergeHeader tab={tabOf('t1', 148)} />);
  expect(page.querySelector('button')).toBeNull();
  const blocked = state({
    verdict: 'blocked',
    base: 'e4/gated',
    action: { kind: 'notPossible', reason: 'blocked' },
    blockers: [
      { kind: 'check', check: { name: 'ci', state: 'failed', url: RUN } },
      { kind: 'conversations', unresolved: 1, cutShort: false },
    ],
  });
  act(() => bridge.push('merge.status', { id: 't1', view: { kind: 'known', state: blocked } }));
  const status = page.querySelector('button');
  expect(status?.textContent).toContain('Can’t merge');
  expect(status?.textContent).toContain('1 check failed · 1 unresolved');
  act(() => status?.click());
  await until(() => panel() !== null);
  const reasons = panel()?.querySelectorAll('[role="option"]') ?? [];
  expect([...reasons].map((row) => row.getAttribute('data-key'))).toEqual([
    'checks-failed',
    'conversations',
  ]);
  expect(panel()?.textContent).toContain('2 things in the way');
  const run = [...(panel()?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent === 'Open the run ↗',
  );
  act(() => run?.click());
  await until(() => bridge.calls.some(([channel]) => channel === 'merge.open'));
  expect(bridge.calls.find(([channel]) => channel === 'merge.open')?.[1]).toEqual({
    id: 't1',
    url: RUN,
  });
  // Merged, it's a line that opens nothing, and the panel goes.
  act(() =>
    bridge.push('merge.status', {
      id: 't1',
      view: { kind: 'known', state: state({ verdict: 'merged' }) },
    }),
  );
  expect(page.querySelector('button')).toBeNull();
  expect(page.textContent).toContain('Merged');
});

it('asks main for a tab drawn before main said anything', async () => {
  views.set('t2', { kind: 'known', state: state({ verdict: 'queued', position: 2 }) });
  const page = draw(<MergeHeader tab={tabOf('t2')} />);
  await until(() => page.textContent?.includes('Queued, 2nd') ?? false);
  expect(page.querySelector('button')?.textContent).toContain('Queued, 2nd');
});

it('reads GitHub’s squash text as the panel opens, without what turns text around, and keeps what the reader typed', async () => {
  views.set('t3', { kind: 'known', state: state({ approvedBy: ['jun-\u202Epark'] }) });
  const page = draw(<MergeHeader tab={tabOf('t3')} />);
  await until(() => page.querySelector('button') !== null);
  expect(page.querySelector('button')?.textContent).toContain('Squash into main');
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.querySelector('input') !== null && panel() !== null);
  await until(() => bridge.calls.some(([channel]) => channel === 'merge.panel'));
  const title = panel()?.querySelector('input');
  await until(() => title?.getAttribute('placeholder') === 'Fixture M3: squash and merge (#138)');
  expect(panel()?.querySelector('textarea')?.getAttribute('placeholder')).toBe('* Add squash.txt');
  expect(panel()?.textContent).toContain('approved by jun-park');
  expect(panel()?.innerHTML).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  // The fields are a scope of their own, where `Tab` moves between them.
  expect(title?.closest('[data-lo-scope]')?.getAttribute('data-lo-scope')).toBe('commit');
  expect(panel()?.textContent).toContain('Merge commits are off in this repo');
  act(() => panels.update('t3', (current) => ({ ...current, title: 'Mine' })));
  expect(panel()?.querySelector('input')?.value).toBe('Mine');
});

/** The panel's main button, at its foot. */
function primary(): HTMLButtonElement | undefined {
  const buttons = [...(panel()?.querySelectorAll('button') ?? [])];
  return buttons.at(-1);
}

it('says what the main button merges, by where the pull request sits', async () => {
  views.set('t4', { kind: 'known', state: state() });
  places.set('t4', { kind: 'stack', stack: 90, below: [136, 137] });
  const page = draw(<MergeHeader tab={tabOf('t4')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('GitHub stack #90') === true);
  expect(panel()?.textContent).toContain(
    '#136 and #137, below it in GitHub stack #90, merge with it.',
  );
  expect(primary()?.textContent).toContain('Merge 3 layers');
});

it('offers to make a chain a GitHub stack first, and merges nothing until it is one', async () => {
  views.set('t5', { kind: 'known', state: state() });
  places.set('t5', {
    kind: 'convert',
    offer: 'These PRs share commits but aren’t a GitHub stack. As one, they’d merge together.',
  });
  const page = draw(<MergeHeader tab={tabOf('t5')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('As one, they’d merge together.') === true);
  const make = [...(panel()?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent?.startsWith('Make this a GitHub stack'),
  );
  expect(make).toBeDefined();
  expect(primary()?.getAttribute('aria-disabled')).toBe('true');
});

it('says a chain’s bottom layer merges alone, and why it can’t be a GitHub stack', async () => {
  views.set('t6', { kind: 'known', state: state() });
  places.set('t6', {
    kind: 'chain',
    into: 'main',
    above: [139],
    reasons: ['This repo has no stacks.'],
  });
  const page = draw(<MergeHeader tab={tabOf('t6')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('merges into main alone') === true);
  expect(panel()?.textContent).toContain('Then Lo moves #139 onto main, while Lo is open.');
  expect(panel()?.textContent).toContain('This repo has no stacks.');
  expect(primary()?.getAttribute('aria-disabled')).toBeNull();
});

it('asks again where it sits while Lo lists the open pull requests again', async () => {
  views.set('t7', { kind: 'known', state: state() });
  places.set('t7', {
    kind: 'refused',
    why: 'Some merged pull requests weren’t looked up yet. Lo is listing the open pull requests again.',
    again: true,
  });
  const page = draw(<MergeHeader tab={tabOf('t7')} />);
  await until(() => page.querySelector('button') !== null);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('weren’t looked up yet') === true);
  places.set('t7', { kind: 'stack', stack: 90, below: [136] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  await until(() => panel()?.textContent?.includes('GitHub stack #90') === true);
  expect(primary()?.textContent).toContain('Merge 2 layers');
});
