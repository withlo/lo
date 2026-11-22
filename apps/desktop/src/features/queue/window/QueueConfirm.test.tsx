// @vitest-environment jsdom
// The merge queue's dialog, with main answered by a stand-in bridge: one title and one body from
// the moment it opens, naming who changes which queue, the entry and its place, and what else the
// change does; only a fresh `⏎` once it shows confirms, never a held one or the press that opened
// it; its main button busy while the change is checked and sent; a change that went closes it with
// a toast; one that didn't says why above the foot, with what can be done; one whose answer was
// lost reads "Check again", which only looks; `Esc` before confirming forgets it; and a question
// that no longer stands says why, or is asked again.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { IpcError } from '../../../ipc/contract.ts';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { Acted, ActPlan, ActPlanned, Entry, QueueRead, QueueState } from '../contract.ts';
import {
  acting,
  actOn,
  autoMergeOn,
  autoMergeSettledBy,
  closedQueue,
  confirmTitle,
  doneLine,
  dropWhy,
  effectsOf,
  heardQueue,
  ordinal,
  settledBy,
  type Sketch,
  type Step,
} from './acting.ts';
import feature from './index.ts';
import { QueueConfirm } from './QueueConfirm.tsx';
import { showQueue } from './store.ts';

const HEAD = 'a'.repeat(40);

/** How main answers a confirmation: removed, unless a test says. */
let confirming: () => Acted = () => ({ kind: 'removed', numbers: [260] });
/** How main answers a plan: the plan a test sets. */
let planning: () => ActPlanned = () => ({ kind: 'plan', plan: planOf() });

const bridge = installBridge({
  'queue.plan': () => planning(),
  'queue.confirm': () => confirming(),
  'queue.cancel': () => undefined,
  'queue.look': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
});

beforeEach(() => {
  confirming = () => ({ kind: 'removed', numbers: [260] });
  planning = () => ({ kind: 'plan', plan: planOf() });
  bridge.calls.length = 0;
  acting.setState({ dialog: undefined, working: new Map(), problems: new Map() });
});

function planOf(change: Partial<ActPlan> = {}): ActPlan {
  return {
    key: '00000000-0000-4000-8000-000000000001',
    id: 'q',
    owner: 'rozed-dev',
    repo: 'e2e',
    branch: 'e4/queued',
    login: 'rozed-bot',
    kind: 'remove',
    number: 260,
    title: 'Fixture M9: queued, slow (2)',
    position: 2,
    head: HEAD,
    stack: null,
    above: [],
    ...change,
  };
}

function sketchOf(change: Partial<Sketch> = {}): Sketch {
  return {
    id: 'q',
    branch: 'e4/queued',
    login: 'rozed-bot',
    kind: 'remove',
    number: 260,
    title: 'Fixture M9: queued, slow (2)',
    position: 2,
    enqueuedAt: 100,
    ...change,
  };
}

/** Opens the dialog at `step`, for `sketch`. */
function open(step: Step, sketch: Sketch = sketchOf()): void {
  act(() => acting.setState({ dialog: { sketch, step } }));
}

/** Opens the dialog asking about `plan`. */
function ask(plan: ActPlan = planOf()): void {
  open({ kind: 'ask', plan, note: undefined }, sketchOf({ kind: plan.kind, number: plan.number }));
}

function entry(
  position: number,
  number: number,
  head = HEAD,
  enqueuedAt: number | null = 100,
): Entry {
  return {
    position,
    number,
    title: `Fixture M9: ${number}`,
    url: `https://github.com/rozed-dev/e2e/pull/${number}`,
    author: 'rozed-bot',
    state: 'AWAITING_CHECKS',
    enqueuedAt,
    timeToMerge: null,
    yours: true,
    queuedByYou: true,
    head,
    testedTogether: false,
    stack: null,
  };
}

function stateOf(entries: Entry[], extra: Partial<QueueState> = {}, leftOut = false): QueueState {
  return {
    id: 'q',
    branch: 'e4/queued',
    branches: [{ name: 'e4/queued', count: entries.length }],
    read: {
      kind: 'queue',
      url: null,
      method: 'squash',
      groups: 5,
      nextMerge: null,
      admin: true,
      entries,
      more: 0,
      leftOut,
      waiting: [],
      waitingCutShort: false,
      left: [],
    },
    readAt: 1,
    failure: null,
    away: false,
    ...extra,
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

/** The dialog's buttons in its foot, by what they say at rest. */
function button(label: string): HTMLButtonElement | undefined {
  return [...(dialog()?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent?.startsWith(label),
  );
}

/** The dialog's facts, as they read. */
function facts(): (string | null)[] {
  return [...(dialog()?.querySelectorAll('dd') ?? [])].map((each) => each.textContent);
}

/** A read of the queue with #259 at its front, and `numbers` waiting to join. */
function waiting(numbers: number[]): QueueRead {
  const state = stateOf([entry(1, 259)]);
  if (state.read.kind !== 'queue') throw new Error('expected a queue');
  return {
    ...state.read,
    waiting: numbers.map((number) => ({
      number,
      title: `Fixture M9: ${number}`,
      url: '',
      author: 'rozed-bot',
      yours: true,
      head: HEAD,
      review: null,
      checks: null,
    })),
  };
}

/** A key-down of `⏎`, made now, so stamped now. */
function enter(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
}

function calls(channel: string): number {
  return bridge.calls.filter(([each]) => each === channel).length;
}

function stepKind(): string | undefined {
  return acting.getState().dialog?.step.kind;
}

describe('the question', () => {
  it('names the change, as whom, the queue, the pull request and its place, and the layers removed with it', async () => {
    draw(<QueueConfirm />);
    ask(planOf({ number: 251, stack: 263, above: [252, 253] }));
    await until(() => dialog() !== null);
    const box = dialog()!;
    expect(box.textContent).toContain('Remove #251 from merge queue?');
    expect([...box.querySelectorAll('dt')].map((each) => each.textContent)).toEqual([
      'As',
      'Queue',
      'Pull request',
      'Place',
    ]);
    expect(box.textContent).toContain('2nd');
    expect(box.textContent).toContain('The layers above it are removed too: #252 and #253.');
    expect(button('Remove from merge queue')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('keeps its title and facts from the check to the end, its main button busy meanwhile', async () => {
    draw(<QueueConfirm />);
    const plan = planOf();
    open({ kind: 'planning', again: undefined, note: undefined });
    await until(() => dialog() !== null);
    const before = facts();
    expect(button('Remove from merge queue')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Cancel')).toBeDefined();
    for (const step of [
      { kind: 'ask', plan, note: undefined },
      { kind: 'checking', plan },
      { kind: 'sent', plan },
    ] as const) {
      open(step);
      expect(dialog()!.textContent).toContain('Remove #260 from merge queue?');
      expect(facts()).toEqual(before);
    }
    // Sent, it's at work, and nothing leaves it until GitHub answers: Cancel is dimmed.
    expect(button('Remove from merge queue')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Remove from merge queue')?.textContent).toContain('Removing…');
    expect(button('Cancel')?.getAttribute('aria-disabled')).toBe('true');
    expect(button('Close')).toBeUndefined();
  });

  it('says what each change does, and what it did', () => {
    expect(confirmTitle({ kind: 'jump', number: 260 })).toBe('Move #260 to front?');
    expect(effectsOf(planOf({ kind: 'jump' }))).toEqual([
      'Checks start again for it and the pull requests tested with it.',
    ]);
    expect(effectsOf(planOf({ above: [261] }))).toEqual([
      'The layer above it is removed too: #261.',
    ]);
    expect(effectsOf(planOf())).toEqual([]);
    expect(doneLine(planOf(), { kind: 'removed', numbers: [260] })).toBe(
      'Removed #260 from merge queue',
    );
    expect(doneLine(planOf(), { kind: 'removed', numbers: [260, 261, 262] })).toBe(
      'Removed 3 layers from merge queue',
    );
    expect(doneLine(planOf({ kind: 'jump' }), { kind: 'moved', position: 1 })).toBe(
      'Moved #260 to front',
    );
    expect(doneLine(planOf({ kind: 'jump' }), { kind: 'moved', position: 3 })).toBe(
      'Moved #260 to 3rd',
    );
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
  });
});

describe('confirming', () => {
  it('confirms only on a fresh `⏎` once it shows, then closes, and a toast says it went', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    // The press that opened it went down before it showed.
    const opening = enter();
    await later();
    ask(plan);
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
    expect(calls('queue.confirm')).toBe(0);

    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    // Pressed again while it's checked, nothing more is confirmed.
    act(() => {
      dialog()?.dispatchEvent(enter());
    });
    await until(() => acting.getState().dialog === undefined);
    expect(calls('queue.confirm')).toBe(1);
    expect(bridge.calls.find(([channel]) => channel === 'queue.confirm')?.[1]).toEqual({
      key: plan.key,
    });
    expect(notice()).toMatchObject({ title: 'Removed #260 from merge queue', done: true });
  });

  it('shows why a change didn’t go above the foot, with what the reason offers', async () => {
    confirming = () => ({
      kind: 'partly',
      why: 'It left the merge queue and wasn’t added back.',
      next: 'open',
      details: 'GitHub: Pull request is not mergeable',
    });
    draw(<QueueConfirm />);
    ask(planOf({ kind: 'jump' }));
    await until(() => dialog() !== null);
    await later();
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    await until(() => stepKind() === 'failed');
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('Move #260 to front?');
    expect(text).toContain('Couldn’t move #260 to the front');
    expect(text).toContain('It left the merge queue and wasn’t added back.');
    expect(text).not.toContain('Pull request is not mergeable');
    expect(button('Open pull request')).toBeDefined();
    expect(button('Close')).toBeDefined();
  });

  it('offers to try again where nothing else is offered', async () => {
    confirming = () => ({ kind: 'refused', why: 'GitHub returned an error.' });
    draw(<QueueConfirm />);
    ask();
    await until(() => dialog() !== null);
    await later();
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    await until(() => stepKind() === 'failed');
    expect(dialog()?.textContent).toContain('Couldn’t remove #260 from the merge queue');
    expect(button('Try again')).toBeDefined();
    // Tried again and planned the same, it goes at once.
    act(() => button('Try again')!.click());
    await until(() => calls('queue.confirm') === 2);
  });

  it('takes a confirmation whose answer never came back as not known, not as refused', async () => {
    confirming = () => {
      throw new IpcError('unavailable', 'Main stopped answering.');
    };
    draw(<QueueConfirm />);
    ask();
    await until(() => dialog() !== null);
    await later();
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    await until(() => stepKind() === 'unknown');
    expect(button('Check again')).toBeDefined();
    expect(button('Try again')).toBeUndefined();
  });

  it('says GitHub’s answer was lost, and "Check again" only looks', async () => {
    confirming = () => ({ kind: 'unknown', why: 'GitHub didn’t respond.' });
    showQueue(stateOf([entry(1, 259), entry(2, 260)]));
    draw(<QueueConfirm />);
    ask();
    await until(() => dialog() !== null);
    await later();
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    await until(() => stepKind() === 'unknown');
    expect(dialog()?.textContent).toContain('Removal not confirmed');
    expect(dialog()?.textContent).toContain('GitHub didn’t respond.');
    // Still listed as it was read: nothing is known yet.
    act(() => button('Check again')!.click());
    await until(() => stepKind() === 'failed');
    expect(calls('queue.look')).toBe(1);
    expect(calls('queue.confirm')).toBe(1);
  });

  it('closes once a look finds the change went', async () => {
    confirming = () => ({ kind: 'unknown', why: 'GitHub didn’t respond.' });
    showQueue(stateOf([entry(1, 259), entry(2, 260)]));
    draw(<QueueConfirm />);
    ask();
    await until(() => dialog() !== null);
    await later();
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    await until(() => stepKind() === 'unknown');
    showQueue(stateOf([entry(1, 259)]));
    act(() => button('Check again')!.click());
    await until(() => acting.getState().dialog === undefined);
    expect(notice()).toMatchObject({ title: 'Removed #260 from merge queue' });
    expect(calls('queue.confirm')).toBe(1);
  });

  it('confirms nothing on a double click’s second click, which lands on what came up in its place', async () => {
    draw(<QueueConfirm />);
    ask();
    await until(() => dialog() !== null);
    const main = button('Remove from merge queue');
    act(() => {
      main!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    });
    expect(calls('queue.confirm')).toBe(0);
    act(() => {
      main!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    await until(() => acting.getState().dialog === undefined);
    expect(calls('queue.confirm')).toBe(1);
  });

  it('forgets the question on `Esc` before it’s confirmed', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    ask(plan);
    await until(() => dialog() !== null);
    act(() => {
      dialog()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await until(() => acting.getState().dialog === undefined);
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
    expect(calls('queue.confirm')).toBe(0);
  });

  it('stops a change while it’s checked, and stays while one sent waits for GitHub', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    open({ kind: 'checking', plan });
    await until(() => dialog() !== null);
    act(() => button('Cancel')!.click());
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
    bridge.calls.length = 0;
    open({ kind: 'sent', plan });
    await until(() => dialog() !== null);
    act(() => button('Cancel')!.click());
    act(() => {
      dialog()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(acting.getState().dialog?.step.kind).toBe('sent');
    expect(calls('queue.cancel')).toBe(0);
  });
});

describe('a question that no longer stands', () => {
  it('stands while a read lists its entry as it was, and not once it’s gone or pushed to', () => {
    const plan = planOf();
    expect(dropWhy(plan, stateOf([entry(1, 259), entry(2, 260)]))).toBeUndefined();
    expect(dropWhy(plan, stateOf([entry(1, 259)]))).toEqual({
      why: '#260 left the merge queue.',
      next: 'gone',
    });
    expect(dropWhy(plan, stateOf([entry(1, 259)], {}, true))).toBeUndefined();
    expect(dropWhy(plan, stateOf([entry(1, 259), entry(2, 260, 'b'.repeat(40))]))).toEqual({
      why: '#260’s revision is out of date.',
      next: 'ask',
    });
  });

  it('goes when its account does, or its tab shows another branch, or closes', () => {
    const plan = planOf();
    expect(
      dropWhy(
        plan,
        stateOf([entry(2, 260)], {
          away: true,
          failure: { message: 'rozed-bot is signed out.', retryAt: null },
        }),
      ),
    ).toEqual({ why: 'rozed-bot is signed out.', next: 'signIn' });
    expect(dropWhy(plan, stateOf([entry(2, 260)], { branch: 'main' }))).toEqual({
      why: '',
      next: 'gone',
    });
    expect(dropWhy(plan, undefined)).toEqual({ why: '', next: 'gone' });
  });

  it('closes with its tab, and main forgets it, but not with another tab', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    ask(plan);
    await until(() => dialog() !== null);
    act(() => closedQueue('other'));
    expect(stepKind()).toBe('ask');
    act(() => closedQueue('q'));
    expect(acting.getState().dialog).toBeUndefined();
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
  });

  it('says why in the dialog once its entry left, and main forgets it', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    ask(plan);
    await until(() => dialog() !== null);
    act(() => heardQueue(stateOf([entry(1, 259)])));
    expect(stepKind()).toBe('gone');
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
    expect(dialog()?.textContent).toContain('#260 left the merge queue.');
    expect(button('Close')).toBeDefined();
    expect(button('Remove from merge queue')).toBeUndefined();
  });

  it('asks again once its entry was pushed to, saying why', async () => {
    const pushed = planOf({ key: '00000000-0000-4000-8000-000000000002', head: 'b'.repeat(40) });
    planning = () => ({ kind: 'plan', plan: pushed });
    draw(<QueueConfirm />);
    ask();
    await until(() => dialog() !== null);
    act(() => heardQueue(stateOf([entry(1, 259), entry(2, 260, 'b'.repeat(40))])));
    await until(() => stepKind() === 'ask' && calls('queue.plan') === 1);
    const { dialog: shown } = acting.getState();
    expect(shown?.step).toMatchObject({ plan: pushed, note: '#260’s revision is out of date.' });
    expect(dialog()?.textContent).toContain('#260’s revision is out of date.');
  });
});

describe('what a look finds a change whose answer was lost did', () => {
  it('finds an entry removed once a whole read no longer lists it', () => {
    const sketch = sketchOf();
    const plan = planOf({ above: [261] });
    expect(settledBy(sketch, plan, stateOf([entry(1, 259)]).read)).toEqual({
      kind: 'removed',
      numbers: [260, 261],
    });
    expect(settledBy(sketch, plan, stateOf([entry(1, 259)], {}, true).read)).toBeUndefined();
    expect(settledBy(sketch, plan, stateOf([entry(2, 260)]).read)).toMatchObject({
      kind: 'refused',
    });
  });

  it('finds an entry moved once it’s nearer the front or joined again, and one not added back', () => {
    const sketch = sketchOf({ kind: 'jump' });
    const plan = planOf({ kind: 'jump' });
    expect(settledBy(sketch, plan, stateOf([entry(1, 260)]).read)).toEqual({
      kind: 'moved',
      position: 1,
    });
    expect(
      settledBy(sketch, plan, stateOf([entry(1, 259), entry(2, 260, HEAD, 200)]).read),
    ).toEqual({ kind: 'moved', position: 2 });
    expect(settledBy(sketch, plan, stateOf([entry(1, 259), entry(2, 260)]).read)).toMatchObject({
      kind: 'refused',
    });
    expect(settledBy(sketch, plan, stateOf([entry(1, 259)]).read)).toEqual({
      kind: 'partly',
      why: 'It left the merge queue and wasn’t added back.',
      next: 'open',
    });
  });

  it('finds auto-merge off once its pull request no longer waits, unless it joined', () => {
    expect(autoMergeSettledBy(258, waiting([258]))).toMatchObject({ kind: 'refused' });
    expect(autoMergeSettledBy(258, waiting([]))).toEqual({ kind: 'autoMergeOff' });
    expect(autoMergeSettledBy(259, waiting([]))).toEqual({
      kind: 'partly',
      why: '#259 had already joined the merge queue.',
      next: 'remove',
    });
  });
});

describe('what each key acts on', () => {
  const read = stateOf([entry(1, 259), entry(2, 260)]).read;
  const entryRow = { key: 'queued-259', kind: 'entry', number: 259, url: '' } as const;
  const behindRow = { key: 'queued-260', kind: 'entry', number: 260, url: '' } as const;
  const waitingRow = { key: 'waiting-258', kind: 'waiting', number: 258, url: '' } as const;
  const leftRow = { key: 'left-261', kind: 'left', number: 261, url: '' } as const;

  it('removes and moves only entries in the queue, and moves them only for an admin', () => {
    expect(actOn('remove', entryRow, read)).toBe(true);
    expect(actOn('jump', behindRow, read)).toBe(true);
    if (read.kind !== 'queue') throw new Error('expected a queue');
    expect(actOn('jump', behindRow, { ...read, admin: false })).toBe(
      'Only repo admins can move to front',
    );
    expect(actOn('remove', waitingRow, read)).toBe('#258 is waiting to join');
    expect(actOn('jump', leftRow, read)).toBe('#261 left the queue');
  });

  it('doesn’t move the front entry to the front', () => {
    expect(actOn('jump', entryRow, read)).toBe('#259 is already at the front');
    expect(actOn('remove', entryRow, read)).toBe(true);
  });

  it('turns auto-merge off for one waiting, on for one that left, and says one queued is queued', () => {
    if (read.kind !== 'queue') throw new Error('expected a queue');
    expect(autoMergeOn(entryRow, read)).toBe('#259 is already in the merge queue');
    expect(autoMergeOn(waitingRow, read)).toBe(true);
    expect(autoMergeOn(leftRow, read)).toBe(true);
    const merged = {
      ...read,
      left: [
        {
          number: 261,
          title: 'Fixture M9: 261',
          url: '',
          at: 1,
          enqueuedAt: null,
          why: { kind: 'merged' as const },
          partial: false,
        },
      ],
    };
    expect(autoMergeOn(leftRow, merged)).toBe('#261 merged');
  });
});
