// @vitest-environment jsdom
// The header's merge status and the panel it opens, with main answered by a stand-in bridge: it
// shows nothing until main says, then the status as main says it; a click opens the panel with a
// row for each reason, whose runs open through main; a squash shows GitHub's commit text, read as
// the panel opens, which the reader's own text stands in front of. A pull request in a merge queue
// says its place and when it should merge, as main last read its queue, or that the queue will
// remove it; once it left, a banner says why, and the panel's first row says it again. One ready for
// a queue says what's ahead of it, read once as the panel opens. Where the pull request sits says
// what its main button merges: a GitHub stack's layers below it too, a chain's bottom layer alone,
// or nothing until the chain is a GitHub stack.

import { handlers } from '@lo/ui/commands';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import queueKeys from '../../queue/keys.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { InQueue, MergeState, MergeView, Placement } from '../contract.ts';
import feature from './index.ts';
import { LeftBanner } from './LeftBanner.tsx';
import { MergeHeader } from './MergeHeader.tsx';
import { panels } from './store.ts';

/** When the tests' statuses were read: now, so none is out of date unless a test says. */
const NOW = Date.now();

const RUN = 'https://github.com/rozed-dev/e2e/actions/runs/1';

/** What main says of each view's status, by its id. */
const views = new Map<string, MergeView>();
/** What main says of each view's pull request in a merge queue, by its id. */
const queues = new Map<string, InQueue>();

/** Each time the merge queue was shown, as `gq` shows it. */
let queueShown = 0;

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
  'merge.queue': (input) =>
    queues.get(String(Reflect.get(Object(input), 'id'))) ?? { place: null, left: null },
  'merge.ahead': () => ({ kind: 'queue', count: 4, atLeast: false, timeToMerge: 1080 }),
  'merge.forgetLeft': () => undefined,
});

/** `gq`, which the merge queue's feature has, standing in. */
const idle = { run: () => undefined };
const queueCommands = handlers(queueKeys, {
  show: { run: () => void queueShown++ },
  down: idle,
  up: idle,
  open: idle,
  remove: idle,
  jump: idle,
  autoMerge: idle,
  nextBranch: idle,
  previousBranch: idle,
  openOnGithub: idle,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry([...feature.commands, ...queueCommands], 'mac');
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
    auto: { kind: 'notPossible', reason: 'ready' },
    override: { kind: 'notPossible', reason: 'nothingToSkip' },
    afterPush: 'noReview',
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
  views.set('t14', { kind: 'known', state: state() });
  places.set('t14', { kind: 'stack', stack: 90, below: [136, 137] });
  const page = draw(<MergeHeader tab={tabOf('t14')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('GitHub stack #90') === true);
  expect(panel()?.textContent).toContain(
    '#136 and #137, below it in GitHub stack #90, merge with it.',
  );
  expect(primary()?.textContent).toContain('Merge 3 layers');
});

it('offers to make a chain a GitHub stack first, and merges nothing until it is one', async () => {
  views.set('t15', { kind: 'known', state: state() });
  places.set('t15', {
    kind: 'convert',
    offer: 'These PRs share commits but aren’t a GitHub stack. As one, they’d merge together.',
  });
  const page = draw(<MergeHeader tab={tabOf('t15')} />);
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
  views.set('t16', { kind: 'known', state: state() });
  places.set('t16', {
    kind: 'chain',
    into: 'main',
    above: [139],
    reasons: ['This repo has no stacks.'],
  });
  const page = draw(<MergeHeader tab={tabOf('t16')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('merges into main alone') === true);
  expect(panel()?.textContent).toContain('Then Lo moves #139 onto main, while Lo is open.');
  expect(panel()?.textContent).toContain('This repo has no stacks.');
  expect(primary()?.getAttribute('aria-disabled')).toBeNull();
});

it('asks again where it sits while Lo lists the open pull requests again', async () => {
  views.set('t17', { kind: 'known', state: state() });
  places.set('t17', {
    kind: 'refused',
    why: 'Some merged pull requests weren’t looked up yet. Lo is listing the open pull requests again.',
    again: true,
  });
  const page = draw(<MergeHeader tab={tabOf('t17')} />);
  await until(() => page.querySelector('button') !== null);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('weren’t looked up yet') === true);
  places.set('t17', { kind: 'stack', stack: 90, below: [136] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  await until(() => panel()?.textContent?.includes('GitHub stack #90') === true);
  expect(primary()?.textContent).toContain('Merge 2 layers');
});

/** Into `e4/queued`, whose queue squashes, 2nd as GitHub last said. */
function queued(change: Partial<MergeState> = {}): MergeView {
  return {
    kind: 'known',
    state: state({
      verdict: 'queued',
      position: 2,
      base: 'e4/queued',
      action: { kind: 'notPossible', reason: 'queued' },
      queue: { required: true, method: 'SQUASH' },
      ...change,
    }),
  };
}

/** How many times the window asked main what's ahead in a queue. */
function aheadAsked(): number {
  return bridge.calls.filter(([channel]) => channel === 'merge.ahead').length;
}

/** A button on the page or in the panel, by what it says. */
function buttonSaying(text: string, within: ParentNode = document): HTMLButtonElement | undefined {
  return [...within.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text),
  );
}

it('says a queued pull request’s place and when it should merge, with the queue a key away', async () => {
  views.set('t4', queued());
  queues.set('t4', {
    place: {
      kind: 'listed',
      position: 3,
      state: 'AWAITING_CHECKS',
      timeToMerge: 720,
      failed: [],
      partial: false,
    },
    left: null,
  });
  const page = draw(<MergeHeader tab={tabOf('t4', 169)} />);
  await until(() => page.textContent?.includes('about 12 min') ?? false);
  expect(page.querySelector('button')?.textContent).toContain('Queued, 3rd');
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null);
  expect(panel()?.textContent).toContain('In the merge queue for e4/queued · 3rd');
  expect(panel()?.textContent).toContain(
    'The queue’s settings choose the method and the message: squash.',
  );
  const see = buttonSaying('See the queue', panel() ?? undefined);
  expect(see?.textContent).toContain('gq');
  act(() => see?.click());
  expect(queueShown).toBe(1);
  expect(panels.get('t4').open).toBe(false);
});

it('says the queue will remove one whose checks failed there, and once it left, why', async () => {
  views.set('t5', queued());
  const page = draw(
    <>
      <LeftBanner tab={tabOf('t5', 134)} />
      <MergeHeader tab={tabOf('t5', 134)} />
    </>,
  );
  await until(() => page.querySelector('button') !== null);
  const failed = { name: 'ci', state: 'failed', url: RUN } as const;
  act(() =>
    bridge.push('merge.queued', {
      id: 't5',
      queue: {
        place: {
          kind: 'listed',
          position: 4,
          state: 'UNMERGEABLE',
          timeToMerge: null,
          failed: [failed],
          partial: false,
        },
        left: null,
      },
    }),
  );
  expect(page.textContent).toContain('Will be removed');
  expect(page.textContent).toContain('ci failed in the queue');
  // The queue no longer lists it, and its status hasn't caught up: it left, never its old place.
  act(() =>
    bridge.push('merge.queued', {
      id: 't5',
      queue: { place: { kind: 'unlisted', partial: false }, left: null },
    }),
  );
  expect(page.querySelector('button')?.textContent).toContain('Left the queue');
  expect(page.querySelector('button')?.textContent).not.toContain('Queued');
  const blocked = state({
    verdict: 'blocked',
    base: 'e4/queued',
    action: { kind: 'notPossible', reason: 'blocked' },
    queue: { required: true, method: 'SQUASH' },
  });
  act(() => {
    bridge.push('merge.status', { id: 't5', view: { kind: 'known', state: blocked } });
    bridge.push('merge.queued', {
      id: 't5',
      queue: {
        place: null,
        left: { at: NOW, why: { kind: 'failedChecks', checks: [failed] }, partial: false },
      },
    });
  });
  expect(page.textContent).toContain('#134 left the merge queue:');
  expect(page.textContent).toContain('ci failed with its group.');
  const open = buttonSaying('Merge panel', page);
  expect(open?.textContent).toContain('m');
  act(() => open?.click());
  await until(() => panel() !== null);
  const first = panel()?.querySelector('[role="option"]');
  expect(first?.getAttribute('data-key')).toBe('left');
  expect(first?.textContent).toContain('1 check failed with its group.');
  act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click());
  expect(page.textContent).not.toContain('left the merge queue');
  await until(() => bridge.calls.some(([channel]) => channel === 'merge.forgetLeft'));
});

it('reads what’s ahead in the queue one ready for it would join, once, as the panel opens', async () => {
  views.set('t6', {
    kind: 'known',
    state: state({
      action: { kind: 'enqueue', method: 'MERGE' },
      queue: { required: true, method: 'MERGE' },
    }),
  });
  const page = draw(<MergeHeader tab={tabOf('t6')} />);
  await until(() => page.textContent?.includes('Ready for the queue') ?? false);
  expect(aheadAsked()).toBe(0);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('4 ahead') ?? false);
  expect(panel()?.textContent).toContain('main merges through a queue · 4 ahead, about 18 min');
  expect(aheadAsked()).toBe(1);
  expect(buttonSaying('See the queue', panel() ?? undefined)).toBeDefined();
});
