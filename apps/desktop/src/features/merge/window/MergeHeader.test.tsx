// @vitest-environment jsdom
// The header's merge status and the panel it opens, with main answered by a stand-in bridge: it
// shows nothing until main says, then "Checking…" until the first read, why it can't check once a
// read failed, and the status as main says it, merged as soon as the merge Lo sent merged; a click
// opens the panel with a row for each reason, whose runs open through main, and the controls of its
// keys, which run through the registry. Its main button names the pull request, dimmed with why as
// its tooltip, but where the reasons above say why; auto-merge is a button, busy while it's turned
// off, and the panel says when that failed. A squash shows GitHub's commit text, read as the panel
// opens, which the reader's own text stands in front of. A pull request in a merge queue says its
// place and when it should merge, as main last read its queue, or that it's leaving it; once it
// left, a banner says so, and the panel's first row says why. One ready for a queue says what's
// ahead of it, read once as the panel opens. Where the pull request sits says what its main button
// merges: a GitHub stack's layers below it too, a chain's bottom layer alone, or nothing until the
// chain is a GitHub stack. That's asked each time the panel opens and as the stack's layers move,
// the button is busy until the first answer, and `⏎` asks again where what the panel heard keeps it
// from merging.

import { handlers, holdRegistry } from '@lo/ui/commands';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import queueKeys from '../../queue/keys.ts';
import type { StackView } from '../../stacks/contract.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { InQueue, JobView, MergeState, MergeView, Placement } from '../contract.ts';
import { closePanel } from './actions.ts';
import feature from './index.ts';
import { LeftBanner } from './LeftBanner.tsx';
import { MergeHeader } from './MergeHeader.tsx';
import { mergeFromPanel } from './merging.ts';
import { merging, panels } from './store.ts';

// The tab on screen, as the tab feature names it: none, unless a test says.
const on = vi.hoisted(() => ({ tab: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => on.tab,
}));

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
/** What main waits on before it says where a view's pull request sits, by its id. */
const holds = new Map<string, Promise<void>>();

/** What main waits on before it answers that it couldn't turn off auto-merge. */
let autoOff: Promise<void> = Promise.resolve();

/** The view whose squash commit text GitHub doesn't say. */
const UNSAID = 't10';

const bridge = installBridge({
  'merge.state': (input) =>
    views.get(String(Reflect.get(Object(input), 'id'))) ?? { kind: 'loading' },
  // The pull request's title, which its author wrote, with characters that turn text around.
  'merge.panel': (input) => {
    if (Reflect.get(Object(input), 'id') === UNSAID) {
      throw new IpcError('unavailable', 'GitHub didn’t answer.');
    }
    return {
      title: 'Fixture M3: ‮squash‬ and merge (#138)',
      message: '* Add ⁦squash.txt⁩',
      head: 'a'.repeat(40),
    };
  },
  'merge.open': () => undefined,
  'merge.place': async (input) => {
    const id = String(Reflect.get(Object(input), 'id'));
    await holds.get(id);
    return places.get(id) ?? { kind: 'alone' };
  },
  'merge.plan': () => ({ kind: 'refused', why: 'Main planned it.' }),
  'merge.queue': (input) =>
    queues.get(String(Reflect.get(Object(input), 'id'))) ?? { place: null, left: null },
  'merge.ahead': () => ({ kind: 'queue', count: 4, atLeast: false, timeToMerge: 1080 }),
  'merge.forgetLeft': () => undefined,
  'merge.autoMergeOff': async () => {
    await autoOff;
    return {
      kind: 'refused',
      refusal: {
        kind: 'failed',
        text: 'GitHub didn’t answer.',
        rules: [],
        until: null,
        newer: null,
      },
    };
  },
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
  // The window's controls run their commands through the registry its keys go through.
  holdRegistry(createRegistry([...feature.commands, ...queueCommands], 'mac'));
  feature.start?.();
});

// No merge is being confirmed, sent or turned off, unless a test says.
beforeEach(() => {
  merging.setState({ dialog: undefined, jobs: new Map(), turningOff: new Set() });
});

function tabOf(id: string, number = 138): PullTab {
  return { id, kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number, title: 't', state: 'open' };
}

/** Puts `tab` on screen, until the test ends. */
function onScreen(tab: PullTab): void {
  on.tab = tab;
  onTestFinished(() => {
    on.tab = undefined;
  });
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

/** A button on the page or in the panel, by what it says. */
function buttonSaying(text: string, within: ParentNode = document): HTMLButtonElement | undefined {
  return [...within.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text),
  );
}

/** What the window asked main to open for view `id` first, if it asked. */
function pageOpened(id: string): unknown {
  return bridge.calls.find(
    ([channel, input]) => channel === 'merge.open' && Reflect.get(Object(input), 'id') === id,
  )?.[1];
}

/** What a button that does work says now: its label, or while it's busy, what it's doing. */
function showing(button: HTMLElement | undefined): string | undefined {
  return button?.querySelector('span > span:not([aria-hidden])')?.textContent ?? undefined;
}

/** The pull request ready to merge into `e4/gated` that a check and a thread block. */
const BLOCKED = state({
  verdict: 'blocked',
  base: 'e4/gated',
  action: { kind: 'notPossible', reason: 'blocked' },
  override: { kind: 'override' },
  blockers: [
    { kind: 'check', check: { name: 'ci', state: 'failed', url: RUN } },
    { kind: 'conversations', unresolved: 1, cutShort: false },
  ],
});

it('shows nothing until main says, then opens the panel with each reason', async () => {
  onScreen(tabOf('t1', 148));
  const page = draw(<MergeHeader tab={tabOf('t1', 148)} />);
  expect(page.querySelector('button')).toBeNull();
  act(() => bridge.push('merge.status', { id: 't1', view: { kind: 'known', state: BLOCKED } }));
  const status = page.querySelector('button');
  expect(status?.textContent).toContain('Can’t merge');
  expect(status?.textContent).toContain('1 check failed · 1 unresolved');
  act(() => status?.click());
  await until(() => panel() !== null);
  expect(panel()?.getAttribute('aria-label')).toBe('Merge panel');
  expect(panel()?.querySelector('button[aria-label="Close merge panel"]')).not.toBeNull();
  const list = panel()?.querySelector('[role="listbox"]');
  expect(list?.getAttribute('aria-label')).toBe('Reasons');
  const reasons = list?.querySelectorAll('[role="option"]') ?? [];
  expect([...reasons].map((row) => row.getAttribute('data-key'))).toEqual([
    'checks-failed',
    'conversations',
  ]);
  expect(panel()?.textContent).toContain('into e4/gated · 2 reasons');
  // The threads' reason goes to the next one, and the keys between the reasons are buttons too.
  const threads = panel()?.querySelector('[data-key="conversations"]') ?? undefined;
  expect(threads && buttonSaying('Next thread', threads)).toBeDefined();
  const focused = () => panel()?.querySelector('[data-focused]')?.getAttribute('data-key');
  expect(focused()).toBe('checks-failed');
  act(() => buttonSaying('Next reason', panel() ?? undefined)?.click());
  expect(focused()).toBe('conversations');
  act(() => buttonSaying('Previous reason', panel() ?? undefined)?.click());
  expect(focused()).toBe('checks-failed');
  expect(buttonSaying('Bypass rules and merge…', panel() ?? undefined)).toBeDefined();
  // The main button names the pull request, dimmed, with no tooltip: the reasons above say why.
  expect(primary()?.textContent).toContain('Merge #148…');
  expect(primary()?.getAttribute('aria-disabled')).toBe('true');
  expect(primary()?.getAttribute('aria-description')).toBeNull();
  const run = buttonSaying('Open in browser', panel() ?? undefined);
  act(() => run?.click());
  await until(() => pageOpened('t1') !== undefined);
  expect(pageOpened('t1')).toEqual({ id: 't1', url: RUN });
  // Merged, it's a line that opens nothing, and the panel goes.
  act(() =>
    bridge.push('merge.status', {
      id: 't1',
      view: { kind: 'known', state: state({ verdict: 'merged' }) },
    }),
  );
  expect(page.querySelector('button')).toBeNull();
  expect(page.textContent).toContain('Merged');
  expect(panel()).toBeNull();
});

it('asks main for a tab drawn before main said anything', async () => {
  views.set('t2', { kind: 'known', state: state({ verdict: 'queued', position: 2 }) });
  const page = draw(<MergeHeader tab={tabOf('t2')} />);
  await until(() => page.textContent?.includes('Queued, 2nd') ?? false);
  expect(page.querySelector('button')?.textContent).toContain('Queued, 2nd');
});

it('says it’s checking until the first read, and its panel opens saying the same', async () => {
  const page = draw(<MergeHeader tab={tabOf('t7')} />);
  await until(() => page.querySelector('button')?.textContent?.includes('Checking…') === true);
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null);
  expect(panel()?.textContent).toContain('Checking…');
  expect(panel()?.querySelector('[role="option"]')).toBeNull();
  // Read, the panel open says what was read.
  act(() => bridge.push('merge.status', { id: 't7', view: { kind: 'known', state: BLOCKED } }));
  await until(() => panel()?.textContent?.includes('1 unresolved thread') === true);
  expect(page.querySelector('button')?.textContent).toContain('Can’t merge');
});

it('says it can’t check merge status once a read failed, and its panel says why', async () => {
  views.set('t8', { kind: 'failed', why: 'GitHub didn’t answer.' });
  const page = draw(<MergeHeader tab={tabOf('t8')} />);
  await until(
    () => page.querySelector('button')?.textContent?.includes('Can’t check merge status') === true,
  );
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null);
  const problem = panel()?.querySelector('[role="alert"]');
  expect(problem?.textContent).toContain('Can’t check merge status');
  expect(problem?.textContent).toContain('GitHub didn’t answer.');
});

it('says in its line what a read may be missing, and on hover only that it opens the panel', async () => {
  views.set('t13', { kind: 'known', state: state({ partial: true }) });
  const page = draw(<MergeHeader tab={tabOf('t13')} />);
  await until(() => page.querySelector('button') !== null);
  const status = page.querySelector('button');
  expect(status?.textContent).toContain('Ready to merge');
  expect(status?.textContent).toContain('Some rules aren’t shown');
  expect(status?.getAttribute('title')).toBe('Merge panel (m)');
});

it('says it merged as soon as the merge Lo sent merged, before its status is read again', async () => {
  views.set('t11', { kind: 'known', state: state() });
  const page = draw(<MergeHeader tab={tabOf('t11', 151)} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null);
  const job: JobView = {
    key: '00000000-0000-4000-8000-000000000151',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 151,
    login: 'rozed-bot',
    kind: 'merge',
    method: 'SQUASH',
    base: 'main',
    head: 'a'.repeat(40),
    already: false,
    state: { kind: 'merged' },
    together: null,
  };
  act(() => bridge.push('merge.jobs', job));
  expect(page.querySelector('button')).toBeNull();
  expect(page.textContent).toContain('Merged');
  expect(panel()).toBeNull();
});

it('reads GitHub’s squash text as the panel opens, without what turns text around, and keeps what the reader typed', async () => {
  views.set('t3', { kind: 'known', state: state({ approvedBy: ['jun-‮park'] }) });
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
  expect(panel()?.innerHTML).not.toMatch(/[‪-‮⁦-⁩]/);
  // The fields are a scope of their own, where `Tab` moves between them.
  expect(title?.closest('[data-lo-scope]')?.getAttribute('data-lo-scope')).toBe('commit');
  expect(panel()?.textContent).toContain('Merge commit is off in this repo.');
  act(() => panels.update('t3', (current) => ({ ...current, title: 'Mine' })));
  expect(panel()?.querySelector('input')?.value).toBe('Mine');
});

it('says when it can’t show GitHub’s commit message, and why', async () => {
  views.set(UNSAID, { kind: 'known', state: state() });
  const page = draw(<MergeHeader tab={tabOf(UNSAID)} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('Can’t show GitHub’s commit message') === true);
  expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain('GitHub didn’t answer.');
  expect(panel()?.querySelector('input')?.getAttribute('placeholder')).toBeNull();
});

/** The panel's main button, at its foot. */
function primary(): HTMLButtonElement | undefined {
  const buttons = [...(panel()?.querySelectorAll('button') ?? [])];
  return buttons.at(-1);
}

it('dims the main button with why while Lo merges nothing, its words the same', async () => {
  views.set('t12', { kind: 'known', state: state({ off: { kind: 'offline' } }) });
  const page = draw(<MergeHeader tab={tabOf('t12')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null && primary()?.getAttribute('aria-busy') === null);
  expect(primary()?.textContent).toContain('Merge #138…');
  expect(primary()?.getAttribute('aria-disabled')).toBe('true');
  expect(primary()?.getAttribute('aria-description')).toBe('Offline');
  // The dimmed button says it: nothing under the panel says it again.
  expect(panel()?.textContent).not.toContain('Offline');
});

it('turns auto-merge off from its button, busy until main answers, and says in the panel when it couldn’t', async () => {
  views.set('t9', {
    kind: 'known',
    state: state({
      verdict: 'waiting',
      blockers: [{ kind: 'check', check: { name: 'ci', state: 'running', url: RUN } }],
      autoMerge: { method: 'SQUASH', by: 'rozed-bot' },
      action: { kind: 'notPossible', reason: 'blocked' },
      auto: { kind: 'off' },
      picked: 'MERGE',
    }),
  });
  onScreen(tabOf('t9'));
  const page = draw(<MergeHeader tab={tabOf('t9')} />);
  await until(
    () => page.querySelector('button')?.textContent?.includes('Auto-merge is on') === true,
  );
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null);
  expect(panel()?.textContent).toContain('Squash · turned on by rozed-bot');
  // The foot names no other method than the one auto-merge merges with.
  expect(panel()?.textContent).not.toContain('Merge commit');
  const off = () => buttonSaying('Turn off auto-merge', panel() ?? undefined);
  expect(off()?.getAttribute('aria-disabled')).toBeNull();
  const answer = Promise.withResolvers<void>();
  autoOff = answer.promise;
  onTestFinished(() => {
    autoOff = Promise.resolve();
  });
  act(() => off()?.click());
  await until(() => off()?.getAttribute('aria-busy') === 'true');
  expect(showing(off())).toBe('Turning off…');
  answer.resolve();
  await until(() => panel()?.textContent?.includes('Couldn’t turn off auto-merge') === true);
  expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain('GitHub didn’t answer.');
  expect(off()?.getAttribute('aria-busy')).toBeNull();
});

it('says what the main button merges, by where the pull request sits', async () => {
  views.set('t14', { kind: 'known', state: state() });
  places.set('t14', { kind: 'stack', stack: 90, below: [136, 137] });
  const page = draw(<MergeHeader tab={tabOf('t14')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('below it in the GitHub stack') === true);
  expect(panel()?.textContent).toContain('#136 and #137 merge too, below it in the GitHub stack.');
  expect(primary()?.textContent).toContain('Merge 3 layers…');
  expect(buttonSaying('Turn on auto-merge…', panel() ?? undefined)).toBeDefined();
});

it('offers to convert a chain to a GitHub stack first, and merges nothing until it is one', async () => {
  views.set('t15', { kind: 'known', state: state() });
  places.set('t15', {
    kind: 'convert',
    offer: 'These PRs share commits but aren’t a GitHub stack. As one, they’d merge together.',
  });
  const page = draw(<MergeHeader tab={tabOf('t15')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('As one, they’d merge together.') === true);
  expect(buttonSaying('Convert to GitHub stack…', panel() ?? undefined)).toBeDefined();
  expect(primary()?.textContent).toContain('Merge #138…');
  expect(primary()?.getAttribute('aria-disabled')).toBe('true');
  expect(primary()?.getAttribute('aria-description')).toBe('Convert to GitHub stack first');
});

it('says a chain’s bottom layer merges alone, and why it can’t be a GitHub stack', async () => {
  views.set('t16', { kind: 'known', state: state() });
  places.set('t16', {
    kind: 'chain',
    into: 'main',
    above: [139, 140],
    reasons: ['This repo has no stacks.'],
  });
  const page = draw(<MergeHeader tab={tabOf('t16')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('#138 merges alone.') === true);
  expect(panel()?.textContent).toContain(
    '#138 merges alone. #139 and #140 then move onto main, while Lo is open.',
  );
  expect(panel()?.textContent).toContain('Can’t convert to GitHub stack');
  expect(panel()?.textContent).toContain('This repo has no stacks.');
  expect(primary()?.textContent).toContain('Merge #138…');
  expect(primary()?.getAttribute('aria-disabled')).toBeNull();
});

it('says why it can’t merge where it sits, with the pull request on GitHub a click away', async () => {
  const why = 'Lo can’t read the GitHub stack #138 is in.';
  views.set('t21', { kind: 'known', state: state() });
  places.set('t21', { kind: 'refused', why, again: false });
  const page = draw(<MergeHeader tab={tabOf('t21')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('Can’t merge #138') === true);
  expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain(why);
  expect(primary()?.getAttribute('aria-disabled')).toBe('true');
  expect(primary()?.getAttribute('aria-description')).toBe(why);
  act(() => buttonSaying('Open on GitHub', panel() ?? undefined)?.click());
  await until(() => pageOpened('t21') !== undefined);
  expect(pageOpened('t21')).toEqual({
    id: 't21',
    url: 'https://github.com/rozed-dev/e2e/pull/138',
  });
});

it('stays checking, saying nothing of it, while Lo lists the open pull requests again, then asks again', async () => {
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
  await until(() => panels.get('t17').place.kind === 'read');
  expect(primary()?.getAttribute('aria-busy')).toBe('true');
  expect(showing(primary())).toBe('Checking…');
  expect(panel()?.textContent).not.toContain('weren’t looked up yet');
  places.set('t17', { kind: 'stack', stack: 90, below: [136] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  await until(() => panel()?.textContent?.includes('#136 merges too') === true);
  expect(primary()?.textContent).toContain('Merge 2 layers…');
  expect(primary()?.getAttribute('aria-busy')).toBeNull();
});

/** A chain of `layers` on `main`, bottom first, with #138 on screen. */
function chainOf(layers: readonly number[]): StackView {
  return {
    kind: 'stack',
    root: 'main',
    githubStack: false,
    found: ['baseBranch'],
    rows: layers.map((number, index) => ({
      number,
      title: `Layer ${number}`,
      author: 'rozed-bot',
      head: `chain/${number}`,
      state: 'open',
      current: number === 138,
      branch: false,
      on: null,
      path: layers.slice(0, index + 1),
      review: null,
      checks: null,
      queue: null,
      needsRebase: false,
      overview: null,
      viewed: null,
      threads: null,
    })),
    notes: [],
    callout: null,
  };
}

/** How many times the window asked main where view `id`'s pull request sits. */
function placeAsked(id: string): number {
  return bridge.calls.filter(
    ([channel, input]) => channel === 'merge.place' && Reflect.get(Object(input), 'id') === id,
  ).length;
}

/** How many times the window asked main for a merge's plan. */
function planAsked(): number {
  return bridge.calls.filter(([channel]) => channel === 'merge.plan').length;
}

const CONVERT: Placement = {
  kind: 'convert',
  offer: 'These PRs share commits but aren’t a GitHub stack. As one, they’d merge together.',
};

it('asks afresh where it sits each time the panel opens, and as its stack’s layers move', async () => {
  views.set('t18', { kind: 'known', state: state() });
  places.set('t18', CONVERT);
  act(() =>
    bridge.push('stacks.stack', { id: 't18', stack: chainOf([137, 138, 139]), offer: null }),
  );
  const page = draw(<MergeHeader tab={tabOf('t18')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('As one, they’d merge together.') === true);
  // #137 merged, and the stack's tree heard it: #138 is now the bottom of a chain on main.
  places.set('t18', { kind: 'chain', into: 'main', above: [139], reasons: [] });
  act(() => bridge.push('stacks.stack', { id: 't18', stack: chainOf([138, 139]), offer: null }));
  await until(() => panel()?.textContent?.includes('#138 merges alone.') === true);
  expect(primary()?.getAttribute('aria-disabled')).toBeNull();
  // What it sits on changed with nothing the stack's tree says: opened again, it asks again.
  act(() => closePanel('t18'));
  await until(() => panel() === null);
  places.set('t18', { kind: 'stack', stack: 91, below: [137] });
  act(() => page.querySelector('button')?.click());
  await until(
    () => panel()?.textContent?.includes('#137 merges too, below it in the GitHub stack.') === true,
  );
  expect(primary()?.textContent).toContain('Merge 2 layers…');
});

it('is busy checking what merges with it until main first says, and `⏎` waits for that', async () => {
  views.set('t19', { kind: 'known', state: state() });
  places.set('t19', { kind: 'stack', stack: 90, below: [137] });
  const answer = Promise.withResolvers<void>();
  holds.set('t19', answer.promise);
  onScreen(tabOf('t19'));
  const plans = planAsked();
  const page = draw(<MergeHeader tab={tabOf('t19')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => primary()?.getAttribute('aria-busy') === 'true');
  expect(showing(primary())).toBe('Checking…');
  expect(primary()?.getAttribute('aria-disabled')).toBe('true');
  // `⏎` waits for the answer, however often it's pressed.
  act(() => mergeFromPanel());
  act(() => mergeFromPanel());
  expect(planAsked()).toBe(plans);
  expect(placeAsked('t19')).toBe(1);
  holds.delete('t19');
  answer.resolve();
  await until(() => planAsked() === plans + 1);
});

it('`⏎` asks again where it sits when what the panel heard keeps it from merging', async () => {
  views.set('t20', { kind: 'known', state: state() });
  places.set('t20', CONVERT);
  onScreen(tabOf('t20'));
  const page = draw(<MergeHeader tab={tabOf('t20')} />);
  await until(() => page.querySelector('button') !== null);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('As one, they’d merge together.') === true);
  const plans = planAsked();
  // Still so, it says why.
  act(() => mergeFromPanel());
  await until(() => placeAsked('t20') === 2);
  await until(() => notice()?.title === 'Convert to GitHub stack first');
  expect(planAsked()).toBe(plans);
  // It moved, which the panel hadn't heard: it asks main for the merge.
  places.set('t20', { kind: 'chain', into: 'main', above: [139], reasons: [] });
  act(() => mergeFromPanel());
  await until(() => planAsked() === plans + 1);
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
  await until(() => page.textContent?.includes('merges in about 12 min') ?? false);
  expect(page.querySelector('button')?.textContent).toContain('Queued, 3rd');
  act(() => page.querySelector('button')?.click());
  await until(() => panel() !== null);
  expect(panel()?.textContent).toContain('In the merge queue for e4/queued · 3rd');
  expect(panel()?.textContent).toContain('Squash, set by the merge queue');
  const see = buttonSaying('Merge queue', panel() ?? undefined);
  expect(see?.textContent).toContain('gq');
  act(() => see?.click());
  expect(queueShown).toBe(1);
  expect(panels.get('t4').open).toBe(false);
});

it('says one whose checks failed in the queue is leaving it, and once it left, why, in the panel', async () => {
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
  expect(page.textContent).toContain('Leaving merge queue');
  expect(page.textContent).toContain('ci failed');
  // The queue no longer lists it, and its status hasn't caught up: it left, never its old place.
  act(() =>
    bridge.push('merge.queued', {
      id: 't5',
      queue: { place: { kind: 'unlisted', partial: false }, left: null },
    }),
  );
  expect(page.querySelector('button')?.textContent).toContain('Left merge queue');
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
  // The banner says it left, in a line; the panel says why.
  expect(page.textContent).toContain('#134 left the merge queue');
  expect(page.textContent).not.toContain('ci failed');
  const open = buttonSaying('Merge panel', page);
  expect(open?.textContent).toContain('m');
  act(() => open?.click());
  await until(() => panel() !== null);
  const first = panel()?.querySelector('[role="option"]');
  expect(first?.getAttribute('data-key')).toBe('left');
  expect(first?.textContent).toContain('Left merge queue');
  expect(first?.textContent).toContain('1 check failed in the merge queue.');
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
  await until(() => page.textContent?.includes('Ready for merge queue') ?? false);
  expect(aheadAsked()).toBe(0);
  act(() => page.querySelector('button')?.click());
  await until(() => panel()?.textContent?.includes('4 ahead') ?? false);
  expect(panel()?.textContent).toContain(
    'main has a merge queue · 4 ahead · merges in about 18 min',
  );
  expect(aheadAsked()).toBe(1);
  expect(panel()?.textContent).toContain('Merge commit, set by the merge queue');
  expect(buttonSaying('Merge queue', panel() ?? undefined)).toBeDefined();
  expect(primary()?.textContent).toContain('Add to merge queue…');
  // The queue does the waiting: there's no auto-merge to turn on.
  expect(buttonSaying('auto-merge', panel() ?? undefined)).toBeUndefined();
});
