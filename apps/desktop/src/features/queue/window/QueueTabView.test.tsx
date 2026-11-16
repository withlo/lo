// @vitest-environment jsdom
// A merge queue's tab, drawn from what main said of it: the queue's settings and the branches it
// can show, its entries with those tested together grouped, those waiting to join, and what stands
// in for the queue when the branch has none, or GitHub left part of it out.

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
  registry = createRegistry(feature.commands, 'mac');
  bridge = installBridge({ 'queue.state': () => undefined, 'queue.show': () => 'q' });
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
    ...extra,
  };
}

const QUEUE: QueueRead = {
  kind: 'queue',
  url: 'https://github.com/rozed-dev/e2e/queue/e4/queued',
  method: 'squash',
  groups: 5,
  nextMerge: null,
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
      review: null,
      checks: 'running',
    },
  ],
  waitingCutShort: false,
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

  it('lists the entries, those tested together in a group, then those waiting to join', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    expect(rowsIn(host)).toEqual(['queued-150', 'queued-151', 'queued-152', 'waiting-153']);
    const group = host.querySelector('[role="rowgroup"][aria-label^="Testing together"]');
    expect(group?.querySelectorAll('[data-key]')).toHaveLength(2);
    const joining = host.querySelector('[role="rowgroup"][aria-label="Waiting to join"]');
    expect(joining?.textContent).toContain('Auto-merge on');
    expect(joining?.textContent).toContain('when checks pass');
    expect(host.querySelector('footer')?.textContent).toContain('Updated just now');
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
          { failure: { message: 'GitHub couldn’t be reached.', retryAt: Date.now() + 40_000 } },
        ),
      ),
    );
    const host = render();
    expect(host.textContent).toContain('e4/queued has no merge queue');
    expect(host.textContent).toContain(
      'Lo couldn’t read the merge queue for e4/queued. GitHub couldn’t be reached. Lo reads it again in 40 s.',
    );
  });

  it('asks main what it has when it has heard nothing yet', () => {
    const host = render();
    expect(host.textContent).toContain('Reading the merge queue for e4/queued');
    expect(bridge.calls).toContainEqual(['queue.state', { id: 'q' }]);
  });
});

describe('a row’s right-click menu', () => {
  it('lists the queue’s commands only on the queue’s own rows, not another list’s', () => {
    // No merge queue's tab is on screen, as when a pull request's timeline is.
    act(() => showQueue(stateOf(QUEUE)));
    const items = menuSections(registry, { kind: 'row', row: 'queued-150' }).flat();
    expect(items.map(({ id }) => id)).toEqual([]);
  });
});
