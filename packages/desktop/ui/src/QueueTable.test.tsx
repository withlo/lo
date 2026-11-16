// @vitest-environment jsdom
// The merge queue's table: entries in order, those tested together boxed as a group, the account's
// own marked, the pull requests waiting to join, and those that left, each with why.

import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, press, render } from '../test/dom.ts';
import { Button } from './Button.tsx';
import {
  QueueTable,
  type LeftEntry,
  type LeftReason,
  type QueueEntry,
  type QueueItem,
  type WaitingEntry,
} from './QueueTable.tsx';
import { Switch } from './Switch.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const first: QueueEntry = {
  key: '4806',
  position: 1,
  title: 'Pin the Node image to 20.18.1',
  number: 4806,
  author: 'dee-adeyemi',
  state: 'running',
  inQueue: '14 min',
  merges: '~2 min',
};
const mine: QueueEntry = {
  key: '4810',
  position: 2,
  title: 'Return 429 bodies as JSON',
  number: 4810,
  author: 'tess-okafor',
  state: 'running',
  inQueue: '11 min',
  merges: '~2 min',
  yours: true,
  actions: (
    <Button variant="ghost" size="sm">
      Remove
    </Button>
  ),
};
const third: QueueEntry = {
  key: '4797',
  position: 3,
  title: 'Fix N+1 queries in the issue timeline',
  number: 4797,
  author: 'mira-chen',
  state: 'running',
  inQueue: '9 min',
  merges: '~2 min',
};
const waiting: QueueEntry = {
  key: '4774',
  position: 4,
  title: 'Drop the legacy search endpoint',
  number: 4774,
  author: 'ravi-k',
  state: 'waiting',
  inQueue: '6 min',
  merges: '~8 min',
};
const stack: QueueEntry = {
  key: '4821',
  position: 5,
  title: 'Rate limit GraphQL queries by cost',
  number: 4821,
  author: 'tess-okafor',
  state: 'waiting',
  inQueue: '2 min',
  merges: '~8 min',
  yours: true,
  stack: { layers: 3, range: '#4818–#4821' },
};
const removal: QueueEntry = {
  key: '4815',
  position: 6,
  title: 'Upgrade graphql-js to 16.9',
  number: 4815,
  author: 'jun-park',
  state: 'removal',
  inQueue: '1 min',
  merges: '—',
};

const items: QueueItem[] = [
  { kind: 'group', group: { key: 'g1', entries: [first, mine, third] } },
  { kind: 'entry', entry: waiting },
  { kind: 'entry', entry: stack },
  { kind: 'entry', entry: removal },
];

const joining: WaitingEntry = {
  key: '4826',
  title: 'Cache plan lookups per request',
  number: 4826,
  author: 'ravi-k',
  until: 'when approved',
  actions: <Switch checked onCheckedChange={() => undefined} aria-label="Auto-merge" />,
};

const left = (key: string, reason: LeftReason, extra: Partial<LeftEntry> = {}): LeftEntry => ({
  key,
  title: `Pull request ${key}`,
  number: Number(key),
  reason,
  when: '5 h ago',
  inQueue: '23 min',
  ...extra,
});

/** The rows of the table, by key. */
function rows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="row"][data-key]')];
}

function row(host: HTMLElement, key: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[role="row"][data-key="${key}"]`);
  if (found === null) throw new Error(`No row ${key}.`);
  return found;
}

describe('QueueTable', () => {
  it('names its columns, then lists the entries in order with place, title and author', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const grid = host.querySelector('[role="grid"]');
    expect(grid?.getAttribute('aria-label')).toBe('Merge queue for main');
    expect(
      [...host.querySelectorAll('[role="columnheader"]')].map((each) => each.textContent),
    ).toEqual(['#', 'Pull request', 'State', 'In queue', 'Merges', 'Actions']);
    expect(rows(host).map((each) => each.dataset.key)).toEqual([
      '4806',
      '4810',
      '4797',
      '4774',
      '4821',
      '4815',
    ]);
    const cells = [...row(host, '4806').querySelectorAll('[role="gridcell"]')].map(
      (each) => each.textContent,
    );
    expect(cells).toEqual([
      '1',
      'Pin the Node image to 20.18.1#4806DAdee-adeyemi',
      'Checks running',
      '14 min',
      '~2 min',
      '',
    ]);
  });

  it('boxes the entries tested together as a group, labelled with how many', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const groups = host.querySelectorAll('[role="rowgroup"]');
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.getAttribute('aria-label')).toBe('Testing together, 3 PRs');
    expect(group?.textContent).toContain('Testing together · 3 PRs');
    expect(
      [...(group?.querySelectorAll('[role="row"][data-key]') ?? [])].map((each) =>
        each.getAttribute('data-key'),
      ),
    ).toEqual(['4806', '4810', '4797']);
    // The label is a row of its own, with a cell across the table, so nothing in the grid is loose.
    const label = group?.querySelector('[role="row"]:not([data-key])');
    expect(label?.textContent).toBe('Testing together · 3 PRs');
    expect(label?.querySelector('[role="rowheader"]')?.getAttribute('aria-colspan')).toBe('6');
    // The group has the queue color's edge, and a ring turning while it tests.
    expect(group?.className).toContain('inset-ring-state-merged-border');
    expect(group?.querySelector('.spinner')).not.toBeNull();
    // An entry outside it isn't in the box.
    expect(group?.contains(row(host, '4774'))).toBe(false);
  });

  it('marks the account’s own entries, and a stack queued as one', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    expect(row(host, '4806').hasAttribute('data-yours')).toBe(false);
    const own = row(host, '4810');
    expect(own.hasAttribute('data-yours')).toBe(true);
    expect(own.className).toContain('bg-on-screen');
    expect(own.querySelector('.font-semibold')?.textContent).toBe('Return 429 bodies as JSON');
    expect(own.textContent).toContain('tess-okafor · yours');
    expect(own.querySelector('button')?.textContent).toBe('Remove');
    const layers = row(host, '4821');
    expect(layers.textContent).toContain('3 layers');
    expect(layers.textContent).toContain('tess-okafor · queued by you · stack #4818–#4821');
    // The place of what's yours is in the accent; the others' is quiet.
    expect(own.querySelector('[role="gridcell"]')?.className).toContain('text-fg-accent');
    expect(row(host, '4806').querySelector('[role="gridcell"]')?.className).toContain(
      'text-fg-muted',
    );
  });

  it('says how each entry stands, in words and in its color', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const state = (key: string) => row(host, key).querySelectorAll('[role="gridcell"]')[2];
    expect(state('4806')?.textContent).toBe('Checks running');
    expect(state('4806')?.className).toContain('text-queue');
    expect(state('4774')?.textContent).toBe('Waiting');
    expect(state('4774')?.className).toContain('text-fg-muted');
    expect(state('4815')?.textContent).toBe('Will be removed');
    expect(state('4815')?.className).toContain('text-danger');
  });

  it('lists the pull requests waiting to join, under the queue, with auto-merge on', () => {
    const host = render(
      <QueueTable label="Merge queue for main" items={items} waiting={[joining]} />,
    );
    const group = host.querySelector('[role="rowgroup"][aria-label="Waiting to join"]');
    expect(group?.querySelector('[role="rowheader"]')?.textContent).toBe('Waiting to join');
    const only = row(host, '4826');
    expect(group?.contains(only)).toBe(true);
    expect([...only.querySelectorAll('[role="gridcell"]')].map((each) => each.textContent)).toEqual(
      [
        '—',
        'Cache plan lookups per request#4826RKravi-k',
        'Auto-merge on',
        'not yet',
        'when approved',
        '',
      ],
    );
    expect(only.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    // It sits after the whole queue.
    const keys = rows(host).map((each) => each.dataset.key);
    expect(keys.at(-1)).toBe('4826');
  });

  describe('left the queue', () => {
    const check = vi.fn<() => void>();
    const entries: LeftEntry[] = [
      left('4821', { kind: 'failed', check: { name: 'test (node 20)', onOpen: check } }),
      left('4780', { kind: 'conflict' }, { when: '2 h ago', inQueue: '8 min' }),
      left('4799', { kind: 'removed', by: 'dee-adeyemi' }, { when: '1 h ago', inQueue: '31 min' }),
      left('4792', { kind: 'timedOut' }, { when: 'this morning', inQueue: '60 min' }),
      left('4750', { kind: 'merged' }, { when: '3 h ago' }),
      left('4760', { kind: 'failed' }, { when: '4 h ago' }),
      left('4761', { kind: 'removed' }, { when: '6 h ago' }),
      left('4762', { kind: 'other', word: 'The pull request was converted to a draft' }),
    ];

    it('says why each left, in the words for its reason', () => {
      const host = render(<QueueTable label="Merge queue for main" items={[]} left={entries} />);
      const group = host.querySelector('[role="rowgroup"][aria-label="Left the queue"]');
      expect(group?.querySelector('[role="rowheader"]')?.textContent).toBe('Left the queue');
      const said = (key: string) =>
        [...row(host, key).querySelectorAll('[role="gridcell"]')].map((each) => each.textContent);
      expect(said('4821')).toEqual([
        '',
        'Pull request 4821#4821removed 5 h ago: test (node 20) failed with its group',
        'Checks failed',
        '23 min',
        '',
        '',
      ]);
      expect(said('4780')[1]).toContain(
        'removed 2 h ago: it conflicts with the branch or an entry ahead of it',
      );
      expect(said('4780')[2]).toBe('Conflict');
      expect(said('4799')[1]).toContain('removed 1 h ago by dee-adeyemi');
      expect(said('4799')[2]).toBe('Removed');
      expect(said('4792')[1]).toContain(
        "removed this morning: its checks ran past the queue's time limit",
      );
      expect(said('4792')[2]).toBe('Timed out');
      expect(said('4750')[1]).toContain('merged 3 h ago');
      expect(said('4750')[2]).toBe('Merged');
      expect(said('4760')[1]).toContain('removed 4 h ago: its checks failed');
      expect(said('4761')[1]).toContain('removed 6 h ago');
      expect(said('4761')[1]).not.toContain(' by ');
      expect(said('4762')[1]).toContain(
        'removed 5 h ago: The pull request was converted to a draft',
      );
      expect(said('4762')[2]).toBe('Removed');
    });

    it('links the check that failed, to its run', () => {
      const host = render(<QueueTable label="Merge queue for main" items={[]} left={entries} />);
      const link = row(host, '4821').querySelector('button');
      expect(link?.textContent).toBe('test (node 20)');
      expect(link?.getAttribute('aria-label')).toBe('Open test (node 20) on GitHub');
      click(link!);
      expect(check).toHaveBeenCalledOnce();
      // Without a known check there's no link to give.
      expect(row(host, '4760').querySelector('button')).toBeNull();
    });

    it('marks each with an icon of its reason, in the color of how it ended', () => {
      const host = render(<QueueTable label="Merge queue for main" items={[]} left={entries} />);
      const tone = (key: string) =>
        row(host, key).querySelector('[role="gridcell"] > span')?.className;
      expect(tone('4821')).toContain('text-danger');
      expect(tone('4780')).toContain('text-warning');
      expect(tone('4799')).toContain('text-fg-muted');
      expect(tone('4792')).toContain('text-fg-muted');
      expect(tone('4750')).toContain('text-state-merged');
      for (const each of entries) {
        expect(row(host, each.key).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it('lists them after those waiting', () => {
      const host = render(
        <QueueTable
          label="Merge queue for main"
          items={items}
          waiting={[joining]}
          left={entries}
        />,
      );
      const keys = rows(host).map((each) => each.dataset.key);
      expect(keys.indexOf('4826')).toBeLessThan(keys.indexOf('4821', 6));
      expect(keys.at(-1)).toBe('4762');
    });
  });

  it('says how many more the queue holds than it lists, and links to them', () => {
    const onOpen = vi.fn<() => void>();
    const host = render(
      <QueueTable label="Merge queue for main" items={items} more={{ count: 120, onOpen }} />,
    );
    expect(host.textContent).toContain("120 more aren't shown.");
    const link = [...host.querySelectorAll('button')].find(
      (each) => each.textContent === 'See the queue on GitHub.',
    );
    // The note and its link are a cell of a row of the grid.
    expect(link?.closest('[role="gridcell"]')?.getAttribute('aria-colspan')).toBe('6');
    expect(link?.closest('[role="gridcell"]')?.parentElement?.getAttribute('role')).toBe('row');
    expect(link?.closest('[role="grid"]')).not.toBeNull();
    click(link!);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('says when nothing is in the queue', () => {
    const host = render(<QueueTable label="Merge queue for main" items={[]} />);
    expect(host.textContent).toContain('Nothing is in the merge queue.');
    expect(rows(host)).toHaveLength(0);
  });

  it('is one focusable element, whose active descendant is the row the keyboard is on', () => {
    const table = createRef<HTMLDivElement>();
    const host = render(
      <QueueTable
        label="Merge queue for main"
        items={items}
        waiting={[joining]}
        focused="4821"
        tableRef={table}
      />,
    );
    const grid = host.querySelector<HTMLElement>('[role="grid"]');
    expect(table.current).toBe(grid);
    // It can hold focus, so the attribute means something: a grid that can't is no help.
    expect(grid?.tabIndex).toBe(0);
    focus(grid!);
    expect(document.activeElement).toBe(grid);
    const on = row(host, '4821');
    expect(grid?.getAttribute('aria-activedescendant')).toBe(on.id);
    expect(host.ownerDocument.getElementById(on.id)).toBe(on);
    expect(on.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    // The ring shows only while the table has keyboard focus, and only on that row.
    expect(on.className).toContain('group-focus-visible/list:shadow-ring-inset');
    expect(grid?.className).toContain('group/list');
    expect(host.querySelectorAll('.group-focus-visible\\/list\\:shadow-ring-inset')).toHaveLength(
      1,
    );
  });

  it('names no active row when the keyboard is on none', () => {
    const host = render(
      <QueueTable label="Merge queue for main" items={items} focused="nothing" />,
    );
    expect(host.querySelector('[role="grid"]')?.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('takes its keys and key scope as attributes, for the feature that drives it', () => {
    const onKeyDown = vi.fn<(event: { key: string }) => void>();
    const host = render(
      <QueueTable
        label="Merge queue for main"
        items={items}
        data-lo-scope="queue"
        onKeyDown={onKeyDown}
      />,
    );
    const grid = host.querySelector('[role="grid"]');
    expect(grid?.getAttribute('data-lo-scope')).toBe('queue');
    press(grid!, 'j');
    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual(['j']);
    // What it draws itself stays: attributes added don't take its role or its name.
    expect(grid?.getAttribute('aria-label')).toBe('Merge queue for main');
  });

  it('says which row was clicked', () => {
    const onRowClick = vi.fn<(key: string) => void>();
    const host = render(
      <QueueTable label="Merge queue for main" items={items} onRowClick={onRowClick} />,
    );
    click(row(host, '4797'));
    expect(onRowClick).toHaveBeenCalledWith('4797');
  });

  it('draws a pull request’s text as text, without the characters that turn it around', () => {
    const odd: QueueEntry = {
      ...first,
      title: 'Fix <img src=x onerror=alert(1)> \u202Egnirts',
      author: 'ev\u202Eil',
    };
    const host = render(
      <QueueTable
        label="Merge queue for main"
        items={[{ kind: 'entry', entry: odd }]}
        left={[
          left('1', { kind: 'removed', by: 'ma\u2066llory' }),
          left('2', { kind: 'failed', check: { name: 'te\u202Est', onOpen: () => undefined } }),
        ]}
      />,
    );
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('Fix <img src=x onerror=alert(1)> gnirts');
    expect(host.innerHTML).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(host.textContent).toContain('evil');
    expect(host.textContent).toContain('by mallory');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <QueueTable
        label="Merge queue for main"
        items={items}
        waiting={[joining]}
        left={[
          left('1', { kind: 'failed', check: { name: 'test', onOpen: () => undefined } }),
          left('2', { kind: 'conflict' }),
          left('3', { kind: 'removed', by: 'x' }),
          left('4', { kind: 'timedOut' }),
          left('5', { kind: 'merged' }),
          left('6', { kind: 'other', word: 'y' }),
        ]}
        more={{ count: 3, onOpen: () => undefined }}
        focused="4806"
      />,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
