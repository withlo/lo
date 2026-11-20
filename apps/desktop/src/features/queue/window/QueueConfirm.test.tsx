// @vitest-environment jsdom
// The merge queue's dialog, with main answered by a stand-in bridge: the question says who changes
// which queue, the entry and its place, and what else leaves with it or happens to it; only a fresh
// `⏎` once it shows confirms, never a held one or the press that opened it; a change that went
// closes it with a note; one that didn't says why; `Esc` before confirming forgets it; and the
// question drops when its entry leaves, is pushed to, or its account goes.

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { ActPlan, Entry, QueueState } from '../contract.ts';
import {
  acting,
  actOn,
  autoMergeOn,
  canAct,
  closedQueue,
  doneLine,
  dropWhy,
  effectsOf,
  heardQueue,
  ordinal,
} from './acting.ts';
import feature from './index.ts';
import { QueueConfirm } from './QueueConfirm.tsx';

const HEAD = 'a'.repeat(40);

/** How main answers a confirmation: taken out, unless a test says. */
let confirming: () => unknown = () => ({ kind: 'removed', numbers: [260] });

const bridge = installBridge({
  'queue.confirm': () => confirming(),
  'queue.cancel': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
});

beforeEach(() => {
  confirming = () => ({ kind: 'removed', numbers: [260] });
  bridge.calls.length = 0;
  acting.setState({ dialog: undefined });
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

function entry(position: number, number: number, head = HEAD): Entry {
  return {
    position,
    number,
    title: `Fixture M9: ${number}`,
    url: `https://github.com/rozed-dev/e2e/pull/${number}`,
    author: 'rozed-bot',
    state: 'AWAITING_CHECKS',
    enqueuedAt: null,
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

/** A key-down of `⏎`, made now, so stamped now. */
function enter(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
}

function confirms(): number {
  return bridge.calls.filter(([channel]) => channel === 'queue.confirm').length;
}

describe('the question', () => {
  it('says who takes which pull request out of which queue, and the layers that leave with it', async () => {
    draw(<QueueConfirm />);
    act(() =>
      acting.setState({
        dialog: {
          kind: 'confirm',
          plan: planOf({ number: 251, stack: 263, above: [252, 253] }),
          note: undefined,
          sending: false,
        },
      }),
    );
    await until(() => dialog() !== null);
    const box = dialog()!;
    expect(box.textContent).toContain('Take #251 out of the merge queue for e4/queued?');
    expect([...box.querySelectorAll('dt')].map((each) => each.textContent)).toEqual([
      'As',
      'Queue',
      'Pull request',
      'Place',
    ]);
    expect(box.textContent).toContain(
      '#252 and #253, above it in GitHub stack #263, leave the queue with it.',
    );
    expect(box.textContent).toContain('Remove from the queue');
  });

  it('says moving to the front tests it, and those tested with it, again from the start', () => {
    expect(effectsOf(planOf({ kind: 'jump' }))).toEqual([
      'It leaves the queue and joins again at the front, so GitHub tests it, and the entries tested with it, again from the start.',
    ]);
    expect(doneLine(planOf({ kind: 'jump' }), { kind: 'moved', position: 1 })).toBe(
      'Moved #260 to the front of the merge queue for e4/queued',
    );
    expect(doneLine(planOf({ kind: 'jump' }), { kind: 'moved', position: 3 })).toBe(
      'Moved #260 up to 3rd in the merge queue for e4/queued, behind what GitHub is testing',
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
  it('confirms only on a fresh `⏎` once it shows, then closes with a note once it went', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    // The press that opened it went down before it showed.
    const opening = enter();
    await later();
    act(() =>
      acting.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
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
    // Pressed again while it's sent, nothing more is confirmed.
    act(() => {
      dialog()?.dispatchEvent(enter());
    });
    await until(() => acting.getState().dialog === undefined);
    expect(confirms()).toBe(1);
    expect(bridge.calls.find(([channel]) => channel === 'queue.confirm')?.[1]).toEqual({
      key: plan.key,
    });
    expect(notice()).toMatchObject({
      title: 'Took #260 out of the merge queue for e4/queued',
      done: true,
    });
  });

  it('says why nothing changed, or not all of it, in the dialog', async () => {
    confirming = () => ({
      kind: 'partly',
      why: 'GitHub took #260 out of the merge queue for e4/queued to move it, then wouldn’t add it back.',
    });
    draw(<QueueConfirm />);
    act(() =>
      acting.setState({
        dialog: {
          kind: 'confirm',
          plan: planOf({ kind: 'jump' }),
          note: undefined,
          sending: false,
        },
      }),
    );
    await until(() => dialog() !== null);
    await later();
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    await until(() => acting.getState().dialog?.kind === 'ended');
    expect(dialog()?.textContent).toContain('#260 is out of the merge queue');
    expect(dialog()?.textContent).toContain('then wouldn’t add it back');
    // Nothing more to confirm.
    act(() => {
      dialog()!.dispatchEvent(enter());
    });
    expect(confirms()).toBe(1);
  });

  it('confirms nothing on a double click’s second click, which lands on what came up in its place', async () => {
    draw(<QueueConfirm />);
    act(() =>
      acting.setState({
        dialog: { kind: 'confirm', plan: planOf(), note: undefined, sending: false },
      }),
    );
    await until(() => dialog() !== null);
    const button = [...dialog()!.querySelectorAll('button')].find((each) =>
      each.textContent?.includes('Remove from the queue'),
    );
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    });
    expect(confirms()).toBe(0);
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    await until(() => acting.getState().dialog === undefined);
    expect(confirms()).toBe(1);
  });

  it('forgets the question on `Esc` before it’s confirmed', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    act(() =>
      acting.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
    );
    await until(() => dialog() !== null);
    act(() => {
      dialog()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await until(() => acting.getState().dialog === undefined);
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
    expect(confirms()).toBe(0);
  });
});

describe('a question that no longer stands', () => {
  it('drops when a read of the whole queue no longer lists its entry, or lists it pushed to', () => {
    const plan = planOf();
    expect(dropWhy(plan, stateOf([entry(1, 259), entry(2, 260)]))).toBeUndefined();
    expect(dropWhy(plan, stateOf([entry(1, 259)]))).toBe(
      '#260 left the merge queue for e4/queued.',
    );
    expect(dropWhy(plan, stateOf([entry(1, 259)], {}, true))).toBeUndefined();
    expect(dropWhy(plan, stateOf([entry(1, 259), entry(2, 260, 'b'.repeat(40))]))).toBe(
      '#260 has a newer push.',
    );
  });

  it('drops when its account goes, its tab shows another branch, or closes', () => {
    const plan = planOf();
    const signedOut = 'rozed-bot is signed out. Lo reads the queue again once you sign in to it.';
    expect(
      dropWhy(
        plan,
        stateOf([entry(2, 260)], { away: true, failure: { message: signedOut, retryAt: null } }),
      ),
    ).toBe(signedOut);
    expect(dropWhy(plan, stateOf([entry(2, 260)], { branch: 'main' }))).toBe(
      'The tab shows main’s queue now.',
    );
    expect(dropWhy(plan, undefined)).toBe('The merge queue’s tab is closed.');
  });

  it('closes with its tab, and main forgets it, but not with another tab', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    act(() =>
      acting.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
    );
    await until(() => dialog() !== null);
    act(() => closedQueue('other'));
    expect(acting.getState().dialog).toMatchObject({ kind: 'confirm' });
    act(() => closedQueue('q'));
    expect(acting.getState().dialog).toBeUndefined();
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
  });

  it('closes the dialog and says why, and main forgets it', async () => {
    const plan = planOf();
    draw(<QueueConfirm />);
    act(() =>
      acting.setState({ dialog: { kind: 'confirm', plan, note: undefined, sending: false } }),
    );
    await until(() => dialog() !== null);
    act(() => heardQueue(stateOf([entry(1, 259)])));
    expect(acting.getState().dialog).toBeUndefined();
    expect(bridge.calls).toContainEqual(['queue.cancel', { key: plan.key }]);
    expect(notice()).toMatchObject({
      title: 'Remove from the queue',
      body: '#260 left the merge queue for e4/queued. Lo dropped the question.',
    });
  });
});

describe('what each key acts on', () => {
  const read = stateOf([entry(1, 259), entry(2, 260)]).read;
  const entryRow = { key: 'queued-259', kind: 'entry', number: 259, url: '' } as const;
  const behindRow = { key: 'queued-260', kind: 'entry', number: 260, url: '' } as const;
  const waitingRow = { key: 'waiting-258', kind: 'waiting', number: 258, url: '' } as const;
  const leftRow = { key: 'left-261', kind: 'left', number: 261, url: '' } as const;

  it('takes out and moves only entries in the queue, and moves them only for an admin', () => {
    expect(actOn('remove', entryRow, read)).toBe(true);
    expect(actOn('jump', behindRow, read)).toBe(true);
    if (read.kind !== 'queue') throw new Error('expected a queue');
    expect(actOn('jump', behindRow, { ...read, admin: false })).toBe(
      'GitHub lets only the repository’s admins move a pull request to the front of the merge queue.',
    );
    expect(actOn('remove', waitingRow, read)).toBe(
      '#258 isn’t in the queue yet: it joins once it’s ready, with auto-merge on.',
    );
    expect(actOn('jump', leftRow, read)).toBe('#261 isn’t in the queue any more.');
  });

  it('doesn’t move the front entry to the front', () => {
    expect(actOn('jump', entryRow, read)).toBe('#259 is at the front of the merge queue already.');
    expect(actOn('remove', entryRow, read)).toBe(true);
  });

  it('turns auto-merge off for one waiting, on for one that left, and says one queued is queued', () => {
    if (read.kind !== 'queue') throw new Error('expected a queue');
    expect(autoMergeOn(entryRow, read)).toBe('#259 is in the merge queue already.');
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
    expect(autoMergeOn(leftRow, merged)).toBe('#261 merged.');
  });
});

it('asks nothing while a question is open', () => {
  acting.setState({
    dialog: { kind: 'confirm', plan: planOf(), note: undefined, sending: false },
  });
  expect(canAct('remove', { kind: 'row', row: 'queued-259' })).toBe('The queue is being changed.');
});
