// @vitest-environment jsdom
// The merge's dialog, with main answered by a stand-in bridge: the confirmation states who merges,
// how, into what and which revision, under one title and over one body from the check until it's
// done, and only its foot and the line above it change. Only a fresh `⏎` once it shows confirms,
// never a held one, the press that opened it or one a field took; its main button is busy while Lo
// checks and while the merge runs, and "Cancel" turns to "Close" once it's sent. Once it merged the
// dialog stays, saying so beside the mark's kiss, with "Done", and a toast says it only when the
// dialog was closed before then. A refusal is a problem above the foot, which offers the newer
// push, to check again or to try again; and `Esc` before confirming forgets the plan. Auto-merge's
// says what GitHub waits for and what a push would do; a merge past the rules lists what it bypasses
// and goes only with the number typed, asked afresh each time; and auto-merge GitHub won't turn on,
// as it can merge now, shows the merge in its place. A GitHub stack's merge lists its layers, then
// how GitHub gets on with each, and offers the layer above once they merged; a chain's lists each
// base branch Lo moves, then how each went.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, expect, it, onTestFinished } from 'vitest';

import { notice, notices, withdraw } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { JobView, MergePlan, Named, Progress, Refusal, Together } from '../contract.ts';
import feature from './index.ts';
import { MergeConfirm } from './MergeConfirm.tsx';
import { heardJob, newerFrom, typeNumber } from './merging.ts';
import { merging, statuses, type MergeDialog } from './store.ts';

const HEAD = 'a'.repeat(40);

/** How main answers a confirmation: sent, unless a test says. */
let confirming: () => unknown = () => ({ kind: 'sent' });

/** How main answers a request for a plan: it can't plan one now. */
const planning = () => ({ kind: 'refused', why: 'GitHub didn’t respond.' });

const bridge = installBridge({
  'merge.plan': () => planning(),
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
  merging.setState({ dialog: undefined, jobs: new Map(), seen: new Set(), checking: new Set() });
  statuses.setState({ views: new Map() });
  for (const note of notices()) withdraw(note.title, note.body);
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

/** The dialog once `plan` went. */
function sentOf(plan: MergePlan): MergeDialog {
  return { kind: 'sent', plan, note: undefined };
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

function title(): string | undefined {
  return dialog()?.querySelector('h2')?.textContent ?? undefined;
}

/** What `element` says, without what's hidden from a screen reader: a key's cap, a ring, a face. */
function spoken(element: Element): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent;
}

/** The dialog's main button, last in its foot. */
function primary(): HTMLButtonElement {
  return [...dialog()!.querySelectorAll('button')].at(-1)!;
}

/** The buttons in the dialog's foot, as each reads, the main one last. */
function footButtons(): HTMLButtonElement[] {
  return [...primary().parentElement!.querySelectorAll('button')];
}

/** The foot, as it reads: "Checking…" for a main button that's checking. */
function foot(): string[] {
  return footButtons().map(spoken);
}

/** Presses the button in the foot that reads `label`. */
function press(label: string): void {
  act(() =>
    footButtons()
      .find((button) => spoken(button) === label)!
      .click(),
  );
}

/** What the dialog's main button says it's doing, while it's busy. */
function working(): string | undefined {
  const face = dialog()?.querySelector('button[aria-busy="true"] > span > span:not([aria-hidden])');
  return face?.textContent ?? undefined;
}

/** The problem above the foot, as it reads: what failed, and why. */
function problem(): { title: string | undefined; reason: string | undefined } | undefined {
  const alert = dialog()?.querySelector('[role="alert"]');
  if (!alert) return undefined;
  const [what, why] = [...alert.querySelectorAll('p')].map((line) => line.textContent);
  return { title: what, reason: why };
}

/** What the line above the foot says is done, beside the mark's kiss: nothing before then. */
function doneSaid(): string | undefined {
  const line = [...dialog()!.querySelectorAll('[role="status"]')].find(
    (each) => each.previousElementSibling?.localName === 'svg',
  );
  return line?.textContent ?? undefined;
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
  const { id, number, login, kind, method, base, head, title: commit } = plan;
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'planning',
        id,
        number,
        label: 'Merge #138',
        title: 'Merge #138',
        ask: { id, asked: 'merge', method, title: commit, message: '' },
        sketch: { id, number, login, kind, method, base, head, title: commit, stack: false },
      },
    }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  const stated = () => ({
    title: title(),
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
    'aaaaaaa',
    'Commit',
    'Rate limit by cost',
  ]);
  expect(working()).toBe('Checking…');
  expect(foot()).toEqual(['Cancel', 'Checking…']);
  // The plan comes: the same title over the same rows, and the button can be pressed.
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  expect(stated()).toEqual(checking);
  expect(working()).toBeUndefined();
  expect(foot()).toEqual(['Cancel', 'Merge #138']);
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
  const labels = () => [...box.querySelectorAll('dt')].map((each) => each.textContent);
  expect(title()).toBe('Merge #138');
  expect(labels()).toEqual(['As', 'Method', 'Into', 'Revision', 'Commit']);
  const values = [...box.querySelectorAll('dd')].map((each) => each.textContent);
  expect(values.slice(1)).toEqual(['Squash', 'main', 'aaaaaaa', 'Rate limit by cost']);
  expect(box.textContent).not.toContain('Lo deletes no branches');
  expect(foot()).toEqual(['Cancel', 'Merge #138']);

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
  expect(title()).toBe('Add #138 to merge queue');
  expect(labels()).toEqual(['As', 'Into', 'Revision']);
  expect(box.textContent).toContain('Method set by the merge queue');
  expect(foot()).toEqual(['Cancel', 'Add to merge queue']);
});

it('confirms only on a fresh `⏎` once it shows, then follows the merge with its button at work', async () => {
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
  // Sent, "Cancel" is "Close", and the button says it's merging.
  expect(foot()).toEqual(['Close', 'Merging…']);
  expect(working()).toBe('Merging…');
  // What was confirmed stays in view while it's sent, under the same title.
  const facts = () => [...dialog()!.querySelectorAll('dd')].map((each) => each.textContent);
  const confirmed = facts();
  expect(confirmed).toContain('Squash');
  expect(title()).toBe('Merge #138');

  act(() => heardJob(jobOf(plan, { kind: 'pending', trouble: null })));
  // The button says it, and no line beside it does.
  expect(working()).toBe('Merging…');
  expect(facts()).toEqual(confirmed);
  expect(dialog()?.querySelector('[role="status"]')).toBeNull();
  // Nothing more is confirmed, however often `⏎` is pressed.
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  expect(confirms()).toBe(1);
});

it('keeps what was confirmed once it’s done, with Done as the one button, which `⏎` presses', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: sentOf(plan) }));
  await until(() => dialog() !== null);
  act(() => heardJob(jobOf(plan, { kind: 'merged' })));
  expect(foot()).toEqual(['Done']);
  expect([...dialog()!.querySelectorAll('dd')].map((each) => each.textContent)).toContain('Squash');
  await until(() => document.activeElement === primary());
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  expect(merging.getState().dialog).toBeUndefined();
});

it('stays open once the merge it shows is done, saying so beside the mark’s kiss, with no toast', async () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000005' });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: sentOf(plan) }));
  act(() => heardJob(jobOf(plan, { kind: 'pending', trouble: null })));
  await until(() => dialog() !== null);
  expect(doneSaid()).toBeUndefined();

  act(() => heardJob(jobOf(plan, { kind: 'merged' })));
  expect(merging.getState().dialog?.kind).toBe('sent');
  expect(title()).toBe('Merge #138');
  expect(doneSaid()).toBe('Merged #138');
  expect(foot()).toEqual(['Done']);
  // The dialog says it, so no toast says it again.
  expect(notices()).toEqual([]);
});

it('says in a toast that the merge ended, once its dialog was closed before then', async () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000006' });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: sentOf(plan) }));
  act(() => heardJob(jobOf(plan, { kind: 'pending', trouble: null })));
  await until(() => dialog() !== null);
  press('Close');
  expect(merging.getState().dialog).toBeUndefined();
  // It goes on, and nothing is said until it ends.
  expect(notices()).toEqual([]);

  act(() => heardJob(jobOf(plan, { kind: 'merged' })));
  expect(notice()).toEqual({ title: 'Merged #138', body: '', done: true });
});

/** The dialog after main refused `plan`'s merge as it was confirmed, for `refusal`. */
function refusedOf(plan: MergePlan, refusal: Refusal): MergeDialog {
  return { kind: 'refused', plan, refusal, note: undefined };
}

/** Main's refusal for a newer push than the one on screen, to `to` once GitHub names it. */
function newerPush(to: string | null): Refusal {
  return {
    kind: 'newerPush',
    text: 'This revision is out of date.',
    rules: [],
    until: null,
    newer: { from: HEAD, to },
  };
}

it('says why main refused it as a problem, and offers the newer push once Lo has read it', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: refusedOf(plan, newerPush(null)) }));
  await until(() => dialog() !== null);
  expect(title()).toBe('Merge #138');
  expect(problem()).toEqual({
    title: 'Couldn’t merge #138',
    reason: 'This revision is out of date.',
  });
  // Lo hasn't read the newer push yet, so its button waits.
  expect(foot()).toEqual(['Close', 'Show latest']);
  expect(primary().getAttribute('aria-busy')).toBe('true');

  act(() => merging.setState({ dialog: refusedOf(plan, newerPush('b'.repeat(40))) }));
  expect(foot()).toEqual(['Close', 'Show latest']);
  expect(primary().hasAttribute('aria-busy')).toBe(false);
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

it('is busy checking once confirmed, and `Esc` then cancels it in main', async () => {
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
  await until(() => working() === 'Checking…');
  // Main checks it again before anything is sent, so it can still be cancelled.
  expect(foot()).toEqual(['Cancel', 'Checking…']);

  act(() => {
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await until(() => merging.getState().dialog === undefined);
  expect(bridge.calls.find(([channel]) => channel === 'merge.cancel')?.[1]).toEqual({
    key: plan.key,
  });

  // Had main sent it before the cancel reached it, it goes on, with the dialog closed.
  await act(async () => {
    answer?.({ kind: 'sent' });
    await Promise.resolve();
  });
  await later();
  expect(merging.getState().dialog).toBeUndefined();
  expect(notices()).toEqual([]);
});

it('draws the base in the title without bidi controls', async () => {
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: {
        kind: 'confirm',
        plan: planOf({ base: 'main‮evil' }),
        note: undefined,
        sending: false,
      },
    }),
  );
  await until(() => dialog() !== null);
  expect(dialog()?.textContent).not.toMatch(/[‪-‮⁦-⁩]/);
});

it('offers to check again when Lo can’t tell how the last merge went, busy while it looks, and goes back', async () => {
  const plan = planOf();
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({
      dialog: refusedOf(plan, {
        kind: 'unsettled',
        text: 'Merge not confirmed',
        rules: [],
        until: null,
        newer: null,
      }),
    }),
  );
  await until(() => dialog() !== null);
  expect(title()).toBe('Merge #138');
  expect(problem()?.title).toBe('Merge not confirmed');
  expect(foot()).toEqual(['Close', 'Check again']);
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  // It only looks: nothing is sent again.
  expect(working()).toBe('Checking…');
  await until(() => merging.getState().dialog === undefined);
  expect(bridge.calls.find(([channel]) => channel === 'merge.askAgain')?.[1]).toEqual({
    key: plan.key,
  });
  expect(confirms()).toBe(0);
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
  expect(title()).toBe('Turn on auto-merge');
  expect(box.textContent).toContain(
    'GitHub merges #138 into main once e2e (chromium) and typecheck pass.',
  );
  expect(box.textContent).toContain(
    'A commit pushed before it merges will merge with the same approvals.',
  );
  expect(foot()).toEqual(['Cancel', 'Turn on auto-merge']);

  // On a branch with a merge queue, it joins the queue once they pass.
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
    '#138 joins the merge queue for e4/queued once e2e (chromium) and typecheck pass.',
  );
  expect(box.textContent).toContain('Squash, set by the merge queue');
  expect(box.textContent).not.toContain('A commit pushed before it merges');
  expect([...box.querySelectorAll('dt')].map((each) => each.textContent)).toEqual([
    'As',
    'Into',
    'Revision',
  ]);
});

it('merges past the rules only with the number typed, which it asks for afresh when it asks again', async () => {
  const plan = planOf({ kind: 'override', named: namedOf() });
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  const box = dialog()!;
  expect(title()).toBe('Bypass rules and merge');
  expect(box.textContent).toContain('Bypassed rules');
  expect([...box.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
    '2 checks running: e2e (chromium) and typecheck',
  ]);
  expect(box.textContent).toContain('Type 138 to confirm');
  const field = () => box.querySelector('input')!;
  const button = primary();
  expect(foot()).toEqual(['Cancel', 'Bypass rules and merge']);
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
  act(() => merging.setState({ dialog: sentOf(plan) }));
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
  expect(title()).toBe('Merge #138');
  expect(dialog()?.textContent).toContain('It can merge as it is.');
  expect(foot()).toEqual(['Cancel', 'Merge #138']);
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
  expect(title()).toBe('Merge 3 layers');
  // Each layer keeps its own commit.
  expect([...box.querySelectorAll('dt')].map((each) => each.textContent)).not.toContain('Commit');
  expect(box.textContent).toContain('Squash · 1 commit per layer');
  expect(rows()).toEqual([
    expect.stringMatching(/#136 Move the token bucket.*Approved · checks passed/),
    expect.stringContaining('#137 Load per-plan limits'),
    expect.stringContaining('#138'),
  ]);
  expect(box.textContent).toContain('#139 stays open and moves onto main.');
  expect(foot()).toEqual(['Cancel', 'Merge 3 layers']);
});

it('follows a stack’s merge layer by layer, then offers the layer above', async () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000003', together: STACK });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: sentOf(plan) }));
  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'pending', trouble: null }),
      together: stackProgress(['open', 'open', 'open']),
    }),
  );
  await until(() => dialog() !== null);
  expect(title()).toBe('Merge 3 layers');
  expect(rows()).toEqual([
    expect.stringContaining('Merging…'),
    expect.stringContaining('Waiting'),
    expect.stringContaining('Waiting'),
  ]);
  expect(foot()).toEqual(['Close', 'Merging…']);

  // Merged, the dialog says so, and offers the layer above, now on main.
  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'merged' }),
      together: stackProgress(['merged', 'merged', 'merged']),
    }),
  );
  expect(title()).toBe('Merge 3 layers');
  expect(rows()).toEqual([
    expect.stringContaining('Merged'),
    expect.stringContaining('Merged'),
    expect.stringContaining('Merged'),
  ]);
  expect(dialog()?.textContent).toContain('#139 moved onto main.');
  expect(doneSaid()).toBe('Merged 3 layers');
  expect(foot()).toEqual(['Open #139', 'Done']);
  expect(notices()).toEqual([]);
  press('Open #139');
  expect(merging.getState().dialog).toBeUndefined();
  await until(() => bridge.calls.some(([channel]) => channel === 'tab.open'));
  expect(bridge.calls.find(([channel]) => channel === 'tab.open')?.[1]).toEqual({
    kind: 'pull',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 139,
  });
});

it('says GitHub stopped a stack’s merge as a problem in its words, and tries it again from the check', async () => {
  const plan = planOf({ together: STACK });
  draw(<MergeConfirm />);
  act(() => merging.setState({ dialog: sentOf(plan) }));
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
  expect(title()).toBe('Merge 3 layers');
  expect(problem()).toEqual({ title: 'Couldn’t merge 3 layers', reason: refusal.text });
  expect(foot()).toEqual(['Close', 'Try again']);

  // Tried again, it's planned afresh as it was asked, under the same title.
  await later();
  act(() => {
    dialog()!.dispatchEvent(enter());
  });
  expect(merging.getState().dialog?.kind).toBe('planning');
  expect(title()).toBe('Merge 3 layers');
  expect(working()).toBe('Checking…');
  expect(bridge.calls.find(([channel]) => channel === 'merge.plan')?.[1]).toEqual({
    id: 't1',
    method: 'SQUASH',
    title: 'Rate limit by cost',
    message: '',
  });
  // Main can't plan it now: the dialog says so, to try again from.
  await until(() => problem()?.title === 'Couldn’t check #138');
  expect(problem()?.reason).toBe('GitHub didn’t respond.');
  expect(title()).toBe('Merge 3 layers');
  expect(foot()).toEqual(['Close', 'Try again']);
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

it('lists a chain’s merge a layer at a time, then each move as it goes, and says when its run is done', async () => {
  const plan = planOf({ key: '00000000-0000-4000-8000-000000000004', together: CHAIN });
  draw(<MergeConfirm />);
  act(() =>
    merging.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
  );
  await until(() => dialog() !== null);
  expect(rows()).toEqual([
    expect.stringContaining('Merge #138 into main.'),
    expect.stringContaining('Move #139 onto main.'),
  ]);
  expect(rows()[1]).toContain('From chain-1. Needs a rebase.');
  expect(dialog()?.textContent).toContain(
    'The layers above move once it has merged, while Lo is open.',
  );

  act(() => merging.setState({ dialog: sentOf(plan) }));
  act(() =>
    heardJob({ ...jobOf(plan, { kind: 'merged' }), together: chainProgress('moving', 'now') }),
  );
  // Merged, it's still at work while the layer on it moves.
  expect(merging.getState().dialog?.kind).toBe('sent');
  expect(rows()).toEqual([
    expect.stringContaining('Merged'),
    expect.stringContaining('Move #139 onto main.'),
  ]);
  expect(foot()).toEqual(['Close', 'Merging…']);
  expect(doneSaid()).toBeUndefined();

  act(() =>
    heardJob({
      ...jobOf(plan, { kind: 'merged' }),
      together: chainProgress('done', 'done', '#139 now points at main and needs a rebase.'),
    }),
  );
  expect(merging.getState().dialog?.kind).toBe('sent');
  expect(doneSaid()).toBe('Merged #138');
  expect(foot()).toEqual(['Done']);
  expect(notices()).toEqual([]);
});

it('leaves a chain’s run that stopped after its merge to the tab’s banner, not a toast, with the dialog closed', () => {
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
  expect(notices()).toEqual([]);
  // Not seen, so its banner says it.
  expect(merging.getState().seen.has(plan.key)).toBe(false);
});
