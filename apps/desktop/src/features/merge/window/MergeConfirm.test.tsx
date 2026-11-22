// @vitest-environment jsdom
// The merge's dialog, with main answered by a stand-in bridge: the confirmation states who merges,
// how, into what and which revision; only a fresh `⏎` once it shows confirms, never a held one, the
// press that opened it or one a field took; the merge goes on as main says, and once it merged the
// dialog goes and a toast says so; a refusal says why and offers the newer push; and `Esc` before
// confirming forgets the plan. Auto-merge's says what GitHub waits for and what a push would do; a
// merge past the rules lists what it skips and goes only with the number typed, asked afresh each
// time; and auto-merge GitHub won't turn on, as it can merge now, shows the merge in its place. A
// GitHub stack's merge lists its layers, then how GitHub gets on with each, and offers the layer
// above once they merged; a chain's lists each base branch Lo moves, then how each went, and a toast
// says how its run ended.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { JobView, MergePlan, Named, Progress, Together } from '../contract.ts';
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
  'tab.open': () => 't2',
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
    named: null,
    together: null,
    ...change,
  };
}

function jobOf(plan: MergePlan, state: JobView['state']): JobView {
  const { key, owner, repo, number, login, kind, method, base, head } = plan;
  return {
    key,
    owner,
    repo,
    number,
    login,
    kind,
    method,
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

/** What the dialog's main button says it's doing, while it's busy. */
function working(): string | undefined {
  const face = dialog()?.querySelector('button[aria-busy="true"] > span > span:not([aria-hidden])');
  return face?.textContent ?? undefined;
}

/** A key-down of `⏎`, made now, so stamped now. */
function enter(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
}

function confirms(): number {
  return bridge.calls.filter(([channel]) => channel === 'merge.confirm').length;
}

it('states the merge under one title from the check on, with only its button waiting', async () => {
  const plan = planOf();
  const { id, number, login, kind, method, base, head, title } = plan;
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'planning',
        id,
        number,
        label: 'Squash and merge',
        title: 'Merge #138',
        sketch: { id, number, login, kind, method, base, head, title, stack: false },
      },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  const stated = () => ({
    title: box.querySelector('h2')?.textContent,
    facts: [...box.querySelectorAll('dt, dd')].map((each) => each.textContent),
  });
  const checking = stated();
  expect(checking.title).toBe('Merge #138');
  expect(checking.facts).toEqual([
    'As',
    expect.stringContaining('rozed-bot'),
    'Method',
    'Squash',
    'Into',
    'main',
    'Revision',
    'aaaaaaa of #138, the one on screen',
    'Commit',
    'Rate limit by cost',
  ]);
  expect(working()).toBe('Checking…');
  // The plan comes: the same title over the same rows, and the button can be pressed.
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  expect(stated()).toEqual(checking);
  expect(working()).toBeUndefined();
});

it('states who merges, how, into what and which revision, and nothing of what it won’t do', async () => {
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: { kind: 'confirm', plan: planOf(), note: undefined, sending: false },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Merge #138');
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
  expect(box.textContent).not.toContain('Lo deletes no branches');
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
  expect(box.textContent).toContain('Add #138 to merge queue');
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
  expect(working()).toBe('Merging…');
  // What was confirmed stays in view while it's sent, so the button doesn't move.
  const facts = () => [...dialog()!.querySelectorAll('dd')].map((each) => each.textContent);
  const confirmed = facts();
  expect(confirmed).toContain('Squash');

  act(() => heardJob(jobOf(plan, { kind: 'pending', trouble: null })));
  // The button says it, and no sentence beside it does.
  expect(working()).toBe('Merging…');
  expect(facts()).toEqual(confirmed);
  expect(dialog()?.textContent).not.toContain('GitHub is merging it');
  // Nothing more is confirmed, however often `⏎` is pressed.
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  expect(confirms()).toBe(1);

  act(() => heardJob(jobOf(plan, { kind: 'merged' })));
  expect(merging.getState().dialog).toBeUndefined();
  expect(notice()).toMatchObject({ title: 'Merged #138 into main', done: true });
});

it('keeps what was confirmed once it’s done, with Done as the one button, which `⏎` presses', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: { kind: 'sent', plan } }));
  await until(() => dialog() !== null);
  // A merge the tab's watch follows leaves its dialog open.
  act(() => heardJob({ ...jobOf(plan, { kind: 'merged' }), watch: true }));
  const buttons = [...dialog()!.querySelectorAll('button')];
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.textContent).toContain('Done');
  expect([...dialog()!.querySelectorAll('dd')].map((each) => each.textContent)).toContain('Squash');
  await until(() => document.activeElement === buttons[0]);
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  expect(merging.getState().dialog).toBeUndefined();
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

it('is busy once confirmed, and `Esc` then cancels it in main', async () => {
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
  await until(() => working() === 'Merging…');

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

/**
 * What a confirmation names, as main planned it: #138 waiting on two checks, into a base whose
 * approvals a push keeps, with `change`.
 */
function namedOf(change: Partial<Named> = {}): Named {
  return {
    blockers: [
      { kind: 'check', check: { name: 'e2e (chromium)', state: 'running', url: null } },
      { kind: 'check', check: { name: 'typecheck', state: 'running', url: null } },
    ],
    unchecked: [],
    partial: false,
    afterPush: 'keepsApprovals',
    queue: { required: false, method: null },
    ...change,
  };
}

it('turning on auto-merge says what GitHub waits for, and what a push before then would do', async () => {
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ kind: 'autoMerge', title: '', named: namedOf() }),
        note: undefined,
        sending: false,
      },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Turn on auto-merge');
  expect(box.textContent).toContain(
    'GitHub squashes #138 into main once e2e (chromium) and typecheck pass.',
  );
  expect(box.textContent).toContain(
    'A push before it merges would merge with the approvals already given.',
  );
  expect(box.textContent).toContain('Merge when ready');

  // On a branch with a merge queue, GitHub adds it to the queue once they pass.
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({
          kind: 'whenReady',
          base: 'e4/queued',
          title: '',
          named: namedOf({
            queue: { required: true, method: 'SQUASH' },
            afterPush: 'newApproval',
          }),
        }),
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
  const plan = planOf({ kind: 'override', named: namedOf() });
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Merge #138 without the rules');
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
  const again = planOf({
    kind: 'override',
    key: '00000000-0000-4000-8000-000000000002',
    named: namedOf(),
  });
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
  expect(dialog()?.textContent).toContain('Merge #138');
  expect(dialog()?.textContent).toContain('It can merge as it is.');
  // Seen here, it needs no banner.
  expect(bridge.calls.find(([channel]) => channel === 'merge.dismiss')?.[1]).toEqual({
    key: plan.key,
  });
});

/** GitHub stack #90: #136 and #137 below #138, the one on screen, and #139 above. */
const STACK: Extract<Together, { kind: 'stack' }> = {
  kind: 'stack',
  stack: 90,
  below: [
    {
      number: 136,
      title: 'Move the token bucket',
      head: 'c'.repeat(40),
      review: 'approved',
      checks: 'passing',
    },
    {
      number: 137,
      title: 'Load per-plan limits',
      head: 'd'.repeat(40),
      review: null,
      checks: null,
    },
  ],
  above: [139],
};

/** How GitHub gets on with #90's merge, from the Stacks API. */
function stackProgress(
  states: Extract<Progress, { kind: 'stack' }>['layers'][number]['state'][],
  more: Partial<Extract<Progress, { kind: 'stack' }>> = {},
): Progress {
  const titles = ['Move the token bucket', 'Load per-plan limits', 'Rate limit by cost'];
  return {
    kind: 'stack',
    layers: [136, 137, 138].map((number, index) => ({
      number,
      title: titles[index]!,
      state: states[index] ?? null,
    })),
    above: [139],
    takenAt: Date.now() - 40_000,
    landed: null,
    ...more,
  };
}

/** The dialog's rows, as each reads. */
function rows(): string[] {
  return [...dialog()!.querySelectorAll('li')].map((row) => row.textContent);
}

it('lists a GitHub stack’s layers that merge as one, and the one above that stays open', async () => {
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ together: STACK }),
        note: undefined,
        sending: false,
      },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(box.textContent).toContain('Merge 3 layers');
  expect(box.textContent).toContain('A GitHub stack merges as one.');
  // Each layer keeps its own commit.
  expect([...box.querySelectorAll('dt')].map((each) => each.textContent)).not.toContain('Commit');
  expect(box.textContent).toContain('Squash, one commit per layer');
  expect(rows()).toEqual([
    expect.stringMatching(/#136 Move the token bucket.*Approved · checks passed/),
    expect.stringContaining('#137 Load per-plan limits'),
    expect.stringContaining('The one on screen'),
  ]);
  expect(box.textContent).toContain('#139, above it, stays open and moves onto main.');
  expect(box.textContent).toContain('Merge 3 layers');
});

it('follows a stack’s merge layer by layer, then offers the layer above', async () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000003', together: STACK });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: { kind: 'sent', plan } }));
  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'pending', trouble: null }),
      together: stackProgress(['open', 'open', 'open']),
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('Merging 3 layers into main');
  expect(dialog()?.textContent).toContain(
    'Submitted to GitHub’s async merge 40 s ago. Branch rules are checked as it runs.',
  );
  expect(rows()).toEqual([
    expect.stringContaining('Checking rules'),
    expect.stringContaining('Waiting'),
    expect.stringContaining('Waiting'),
  ]);
  expect(dialog()?.textContent).toContain('You can close this; the tab shows the result.');

  // Merged, the dialog stays to offer the layer above, now on main.
  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'merged' }),
      together: stackProgress(['merged', 'merged', 'merged']),
    }),
  );
  expect(notice()).toMatchObject({ title: 'Merged 3 layers into main', done: true });
  expect(dialog()?.textContent).toContain('#136, #137 and #138. #139 now sits on main.');
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  await until(() => merging.getState().dialog === undefined);
  expect(bridge.calls.find(([channel]) => channel === 'tab.open')?.[1]).toEqual({
    kind: 'pull',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 139,
  });
});

it('says nothing merged when GitHub stopped a stack’s merge, in GitHub’s words', async () => {
  const plan = planOf({ together: STACK });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: { kind: 'sent', plan } }));
  const refusal = {
    kind: 'failed',
    text: 'GitHub stopped at #137: "Required status check security/scan is expected."',
    rules: [],
    until: null,
    newer: null,
  };
  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'refused', refusal }),
      together: stackProgress(['open', 'open', 'open'], { landed: [] }),
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).toContain('Nothing merged.');
  expect(dialog()?.textContent).toContain(`${refusal.text} No layer went in.`);
});

/** #138, the bottom layer of a chain by base branch, with #139 on its branch. */
const CHAIN: Extract<Together, { kind: 'chain' }> = {
  kind: 'chain',
  before: null,
  after: [{ pr: 139, from: 'chain-1', to: 'main' }],
  needsRebase: [139],
};

function chainProgress(
  phase: Extract<Progress, { kind: 'chain' }>['phase'],
  status: Extract<Progress, { kind: 'chain' }>['moves'][number]['status'],
  text: string | null = null,
): Progress {
  return {
    kind: 'chain',
    phase,
    moves: [{ move: CHAIN.after[0]!, before: false, status, detail: null }],
    needsRebase: [139],
    text,
  };
}

it('lists a chain’s merge a layer at a time, then each move as it goes, and toasts its end', async () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000004', together: CHAIN });
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  expect(rows()).toEqual([
    expect.stringContaining('Merge #138 into main'),
    expect.stringContaining('Move #139 onto main'),
  ]);
  expect(rows()[1]).toContain('From chain-1 · needs rebase');
  expect(dialog()?.textContent).toContain(
    'Lo moves the layers above once it has merged, while Lo is open.',
  );

  act(() => merging.setState({ dialog: { kind: 'sent', plan } }));
  act(() =>
    heardJob({ ...jobOf(plan, { kind: 'merged' }), together: chainProgress('moving', 'now') }),
  );
  // Merged, it stays while the layer on it moves.
  expect(merging.getState().dialog?.kind).toBe('sent');
  expect(rows()).toEqual([
    expect.stringContaining('Merged'),
    expect.stringContaining('Move #139 onto main'),
  ]);

  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'merged' }),
      together: chainProgress('done', 'done', '#139 now points at main and needs a rebase.'),
    }),
  );
  expect(merging.getState().dialog).toBeUndefined();
  expect(notice()).toMatchObject({
    title: 'Merged #138, one layer at a time',
    body: '#139 now points at main and needs a rebase.',
  });
});

it('says in a toast that a chain’s run stopped after its merge, with the dialog closed', () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000002', together: CHAIN });
  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'merged' }),
      together: chainProgress(
        'stopped',
        'failed',
        '#138 merged, but Lo stopped moving the layers on it.',
      ),
    }),
  );
  expect(notice()).toMatchObject({
    title: 'Lo stopped moving the layers on #138.',
    body: '#138 merged, but Lo stopped moving the layers on it.',
  });
});
