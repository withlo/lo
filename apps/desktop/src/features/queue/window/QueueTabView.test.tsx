// @vitest-environment jsdom
// A merge queue's tab, drawn from what main said of it: the queue's settings and the branches it
// can show, its entries with those tested together grouped, those waiting to join, those Lo saw
// leave with why, and what stands in for the queue when the branch has none, or GitHub left part
// of it out.

import { menuSections, type Registry } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge, type FakeBridge } from '../../../window/test/bridge.ts';
import type { QueueTab } from '../../tab/contract.ts';
import type { Entry, QueueRead, QueueState } from '../contract.ts';
import feature from './index.ts';
import { QueueTabView } from './QueueTabView.tsx';
import { forgetQueue, showQueue } from './store.ts';

const TAB: QueueTab = {
  id: 'q',
  kind: 'queue',
  owner: 'rozed-dev',
  repo: 'e2e',
  branch: 'e4/queued',
  login: 'rozed-bot',
};

let bridge: FakeBridge;
let registry: Registry;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom lays nothing out, so it has nothing to scroll a row into view in.
  Element.prototype.scrollIntoView = () => undefined;
  registry = createRegistry(feature.commands, 'mac');
  bridge = installBridge({
    'queue.state': () => undefined,
    'queue.show': () => 'q',
    'tab.openExternal': () => undefined,
  });
});

afterEach(() => {
  act(() => forgetQueue(TAB.id));
  bridge.calls.length = 0;
});

function entry(position: number, number: number, extra: Partial<Entry> = {}): Entry {
  return {
    position,
    number,
    title: `Fixture M4: ${number}`,
    url: `https://github.com/rozed-dev/e2e/pull/${number}`,
    author: 'rozed-bot',
    state: 'AWAITING_CHECKS',
    enqueuedAt: Date.now() - 60_000,
    timeToMerge: null,
    yours: true,
    queuedByYou: true,
    head: 'a'.repeat(40),
    testedTogether: false,
    stack: null,
    ...extra,
  };
}

function stateOf(read: QueueRead, extra: Partial<QueueState> = {}): QueueState {
  return {
    id: TAB.id,
    branch: TAB.branch,
    branches: [
      { name: 'e4/queued', count: 3 },
      { name: 'merge/4/base', count: null },
    ],
    read,
    readAt: Date.now(),
    failure: null,
    away: false,
    ...extra,
  };
}

const QUEUE: QueueRead = {
  kind: 'queue',
  url: 'https://github.com/rozed-dev/e2e/queue/e4/queued',
  method: 'squash',
  groups: 5,
  nextMerge: null,
  admin: true,
  entries: [
    entry(1, 150, { testedTogether: true }),
    entry(2, 151, { testedTogether: true }),
    entry(3, 152, { state: 'QUEUED' }),
  ],
  more: 0,
  leftOut: false,
  waiting: [
    {
      number: 153,
      title: 'Fixture M4: waiting',
      url: 'https://github.com/rozed-dev/e2e/pull/153',
      author: 'rozed-bot',
      yours: true,
      head: 'b'.repeat(40),
      review: null,
      checks: 'running',
    },
  ],
  waitingCutShort: false,
  left: [
    {
      number: 154,
      title: 'Fixture M4: queued, fails in the queue',
      url: 'https://github.com/rozed-dev/e2e/pull/154',
      at: Date.now() - 5 * 60_000,
      enqueuedAt: Date.now() - 28 * 60_000,
      why: {
        kind: 'failedChecks',
        checks: [{ name: 'ci', url: 'https://github.com/rozed-dev/e2e/actions/runs/1' }],
      },
      partial: false,
    },
    {
      number: 149,
      title: 'Fixture M4: gone',
      url: 'https://github.com/rozed-dev/e2e/pull/149',
      at: Date.now() - 60 * 60_000,
      enqueuedAt: null,
      why: { kind: 'unknown' },
      partial: true,
    },
  ],
};

function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<QueueTabView tab={TAB} />));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const rowsIn = (host: HTMLElement) =>
  [...host.querySelectorAll('[role="row"][data-key]')].map((row) => row.getAttribute('data-key'));

describe('a merge queue’s tab', () => {
  it('names the repository, the branch, the queue’s settings, the branches and the account', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const header = host.querySelector('header');
    expect(header?.textContent).toContain('Merge queue');
    expect(header?.textContent).toContain('rozed-dev/e2e into');
    expect(header?.textContent).toContain('e4/queued');
    expect(header?.textContent).toContain('squash, groups of up to 5');
    expect(header?.textContent).toContain('as rozed-bot');
    const tabs = [...(header?.querySelectorAll('[role="tab"]') ?? [])];
    expect(tabs.map((each) => each.textContent)).toEqual(['e4/queued3', 'merge/4/base']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('lists the entries, those tested together in a group, then those waiting to join, then those that left', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    expect(rowsIn(host)).toEqual([
      'queued-150',
      'queued-151',
      'queued-152',
      'waiting-153',
      'left-154',
      'left-149',
    ]);
    const group = host.querySelector('[role="rowgroup"][aria-label^="Testing together"]');
    expect(group?.querySelectorAll('[data-key]')).toHaveLength(2);
    const joining = host.querySelector('[role="rowgroup"][aria-label="Waiting to join"]');
    expect(joining?.textContent).toContain('Auto-merge on');
    expect(joining?.textContent).toContain('when checks pass');
    expect(host.querySelector('footer')?.textContent).toContain('Updated just now');
  });

  it('says why each that left did, its failed check’s run opening on GitHub, and never that one Lo can’t tell about stayed', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const left = host.querySelector('[role="rowgroup"][aria-label="Left the queue"]');
    const failed = left?.querySelector('[data-key="left-154"]');
    expect(failed?.textContent).toContain('removed 5 min ago: ci failed with its group');
    expect(failed?.textContent).toContain('Checks failed');
    expect(failed?.textContent).toContain('23 min');
    const unknown = left?.querySelector('[data-key="left-149"]');
    expect(unknown?.textContent).toContain('left 1 h ago: Lo can’t tell why');
    expect(unknown?.textContent).toContain('GitHub left part of why out');
    act(() => failed?.querySelector('button')?.click());
    expect(bridge.calls).toContainEqual([
      'tab.openExternal',
      { url: 'https://github.com/rozed-dev/e2e/actions/runs/1' },
    ]);
  });

  it('switches branch from the header, through main', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const other = [...host.querySelectorAll('[role="tab"]')].find((each) =>
      each.textContent.startsWith('merge/4/base'),
    );
    act(() => {
      other?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(bridge.calls).toContainEqual(['queue.show', { id: 'q', branch: 'merge/4/base' }]);
  });

  it('says a partial read may not hold every entry, never that the queue is empty', () => {
    act(() => showQueue(stateOf({ ...QUEUE, url: null, entries: [], waiting: [], leftOut: true })));
    const host = render();
    expect(host.textContent).toContain('Lo may not see every entry');
    expect(host.textContent).toContain('Lo couldn’t read the queue’s entries.');
    expect(host.textContent).not.toContain('Nothing is in the merge queue.');
  });

  it('says when the branch has no queue, and why a read failed, with when Lo reads again', () => {
    act(() =>
      showQueue(
        stateOf(
          { kind: 'none' },
          {
            failure: {
              message: 'GitHub couldn’t be \u202Ereached.',
              retryAt: Date.now() + 40_000,
            },
          },
        ),
      ),
    );
    const host = render();
    expect(host.textContent).toContain('e4/queued has no merge queue');
    expect(host.textContent).toContain(
      'Lo couldn’t read the merge queue for e4/queued. GitHub couldn’t be reached. Lo reads it again in 40 s.',
    );
  });

  it('keeps focus on the page as the table goes for a branch with no queue, so its keys still work', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const grid = host.querySelector<HTMLElement>('[role="grid"]');
    act(() => grid?.focus());
    expect(document.activeElement).toBe(grid);
    act(() => showQueue(stateOf({ kind: 'none' }, { branch: 'merge/4/base' })));
    expect(document.activeElement).toBe(host.querySelector('[data-lo-scope="queue"]'));
  });

  it('asks main what it has when it has heard nothing yet', () => {
    const host = render();
    expect(host.textContent).toContain('Reading the merge queue for e4/queued');
    expect(bridge.calls).toContainEqual(['queue.state', { id: 'q' }]);
  });
});

/** The commands a right-click on row `row` lists. */
function listed(row: string): string[] {
  return menuSections(registry, { kind: 'row', row })
    .flat()
    .map(({ id }) => id);
}

describe('a row’s right-click menu', () => {
  it('lists the queue’s commands on the queue’s own rows', () => {
    act(() => showQueue(stateOf(QUEUE)));
    render();
    expect(listed('queued-150')).toEqual([
      'queue.open',
      'queue.remove',
      'queue.jump',
      'queue.autoMerge',
      'queue.openOnGithub',
    ]);
    // Moving to the front is for entries only.
    const others = ['queue.open', 'queue.remove', 'queue.autoMerge', 'queue.openOnGithub'];
    expect(listed('waiting-153')).toEqual(others);
    expect(listed('left-154')).toEqual(others);
  });

  it('offers moving to the front only to the repository’s admins', () => {
    act(() => showQueue(stateOf({ ...QUEUE, admin: false })));
    render();
    expect(listed('queued-150')).toEqual([
      'queue.open',
      'queue.remove',
      'queue.autoMerge',
      'queue.openOnGithub',
    ]);
  });

  it('lists none of them on another list’s rows, as a pull request’s timeline’s', () => {
    act(() => showQueue(stateOf(QUEUE)));
    // The queue's table isn't drawn: a pull request's tab is on screen.
    expect(listed('queued-150')).toEqual([]);
    render();
    expect(listed('comment-150')).toEqual([]);
  });
});
