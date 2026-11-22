// @vitest-environment jsdom
// The merge queue's table: entries in order, those tested together boxed as a group, the account's
// own tagged, the pull requests waiting to join, and those that left, each with why; each row's
// actions on the keyboard's row and under the pointer, a line under a row, and a double click that
// opens it.

import { act, createRef } from 'react';
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
  merges: 'about 2 min',
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
  merges: 'about 8 min',
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
  until: 'needs approval',
  actions: (
    <Button variant="ghost" size="sm">
      Turn off auto-merge
    </Button>
  ),
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

/** Double-clicks `target`. */
function twice(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
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
      'about 2 min',
      '',
    ]);
  });

  it('boxes the entries tested together as a group, labelled with how many', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const groups = host.querySelectorAll('[role="rowgroup"]');
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.getAttribute('aria-label')).toBe('Testing together, 3 pull requests');
    expect(group?.textContent).toContain('Testing together · 3 pull requests');
    expect(
      [...(group?.querySelectorAll('[role="row"][data-key]') ?? [])].map((each) =>
        each.getAttribute('data-key'),
      ),
    ).toEqual(['4806', '4810', '4797']);
    // The label is a row of its own, with a cell across the table, so nothing in the grid is loose.
    const label = group?.querySelector('[role="row"]:not([data-key])');
    expect(label?.textContent).toBe('Testing together · 3 pull requests');
    expect(label?.querySelector('[role="rowheader"]')?.getAttribute('aria-colspan')).toBe('6');
    // The group has the queue color's edge, and a ring turning while it tests.
    expect(group?.className).toContain('inset-ring-state-merged-border');
    expect(group?.querySelector('.spinner')).not.toBeNull();
    // An entry outside it isn't in the box.
    expect(group?.contains(row(host, '4774'))).toBe(false);
  });

  it('tags the account’s own entries by their author, and marks a stack queued as one', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const tagged = (key: string) =>
      [...row(host, key).querySelectorAll('span')].some((each) => each.textContent === 'you');
    expect(row(host, '4806').hasAttribute('data-yours')).toBe(false);
    expect(tagged('4806')).toBe(false);
    const own = row(host, '4810');
    expect(own.hasAttribute('data-yours')).toBe(true);
    expect(tagged('4810')).toBe(true);
    expect(own.textContent).toContain('tess-okaforyou');
    // Yours is tagged, not tinted, and its title and place are as the others'.
    expect(own.className).not.toContain('bg-on-screen');
    expect(own.querySelector('.font-semibold')).toBeNull();
    expect(own.querySelector('[role="gridcell"]')?.className).toContain('text-fg-muted');
    expect(own.querySelector('button')?.textContent).toBe('Remove');
    const layers = row(host, '4821');
    expect(layers.textContent).toContain('3 layers');
    expect(layers.textContent).toContain('· stack #4818–#4821');
  });

  it('tints only the row the keyboard is on', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} focused="4806" />);
    expect(row(host, '4806').className).toContain('bg-selected');
    expect(row(host, '4810').className).not.toContain('bg-selected');
    expect(row(host, '4806').hasAttribute('data-focused')).toBe(true);
    expect(row(host, '4810').hasAttribute('data-focused')).toBe(false);
  });

  it('shows a row’s actions on the keyboard’s row, and on one under the pointer or with focus in it', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const actions = row(host, '4810').querySelectorAll('[role="gridcell"]')[5];
    expect(actions?.className).toContain('invisible');
    expect(actions?.className).toContain('group-hover/row:visible');
    expect(actions?.className).toContain('group-focus-within/row:visible');
    expect(actions?.className).toContain('group-data-focused/row:visible');
    // A key chip in it shows on the keyboard's row alone.
    expect(row(host, '4810').hasAttribute('data-key-scope')).toBe(true);
  });

  it('says how each entry stands, in words and in its color', () => {
    const host = render(<QueueTable label="Merge queue for main" items={items} />);
    const state = (key: string) => row(host, key).querySelectorAll('[role="gridcell"]')[2];
    expect(state('4806')?.textContent).toBe('Checks running');
    expect(state('4806')?.className).toContain('text-queue');
    expect(state('4774')?.textContent).toBe('Waiting');
    expect(state('4774')?.className).toContain('text-fg-muted');
    expect(state('4815')?.textContent).toBe('Leaving');
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
        'Auto-merge is on',
        'needs approval',
        'Turn off auto-merge',
      ],
    );
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
      left('4792', { kind: 'timedOut' }, { when: '8 h ago', inQueue: '1 h' }),
      left('4750', { kind: 'merged' }, { when: '3 h ago' }),
      left('4760', { kind: 'failed' }, { when: '4 h ago' }),
      left('4761', { kind: 'removed' }, { when: '6 h ago' }),
      left('4762', { kind: 'other', word: 'The pull request was converted to a draft' }),
    ];

    it('says why each left, in the words for its reason', () => {
      const host = render(<QueueTable label="Merge queue for main" items={[]} left={entries} />);
      const group = host.querySelector('[role="rowgroup"][aria-label="Left"]');
      expect(group?.querySelector('[role="rowheader"]')?.textContent).toBe('Left');
      const said = (key: string) =>
        [...row(host, key).querySelectorAll('[role="gridcell"]')].map((each) => each.textContent);
      expect(said('4821')).toEqual([
        '',
        'Pull request 4821#4821Left 5 h ago · test (node 20) failed',
        'Checks failed',
        '23 min',
        '',
        '',
      ]);
      expect(said('4780')[1]).toContain('Left 2 h ago · conflict');
      expect(said('4780')[2]).toBe('Conflict');
      expect(said('4799')[1]).toContain('Removed 1 h ago by dee-adeyemi');
      expect(said('4799')[2]).toBe('Removed');
      expect(said('4792')[1]).toContain('Left 8 h ago · checks timed out');
      expect(said('4792')[2]).toBe('Timed out');
      expect(said('4750')[1]).toContain('Merged 3 h ago');
      expect(said('4750')[2]).toBe('Merged');
      expect(said('4760')[1]).toContain('Left 4 h ago · checks failed');
      expect(said('4761')[1]).toContain('Removed 6 h ago');
      expect(said('4761')[1]).not.toContain(' by ');
      expect(said('4762')[1]).toContain('Left 5 h ago · The pull request was converted to a draft');
      expect(said('4762')[2]).toBe('Left');
    });

    it('says only when one left when why isn’t known, never that it stayed', () => {
      const host = render(
        <QueueTable
          label="Merge queue for main"
          items={[]}
          left={[
            left('4763', { kind: 'unknown' }),
            left('4764', { kind: 'conflict' }, { partial: true }),
          ]}
        />,
      );
      const said = (key: string) =>
        [...row(host, key).querySelectorAll('[role="gridcell"]')].map((each) => each.textContent);
      expect(said('4763')[1]).toBe('Pull request 4763#4763Left 5 h ago');
      expect(said('4763')[2]).toBe('Left');
      expect(said('4764')[1]).toBe('Pull request 4764#4764Left 5 h ago · conflict');
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
    expect(host.textContent).toContain('120 more pull requests');
    const link = [...host.querySelectorAll('button')].find(
      (each) => each.textContent === 'Open on GitHub',
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
    expect(host.textContent).toContain('No pull requests in the queue');
    expect(rows(host)).toHaveLength(0);
  });

  it('says nothing of an empty queue when told to, where what’s above it says why', () => {
    const host = render(<QueueTable label="Merge queue for main" items={[]} empty={null} />);
    expect(host.textContent).not.toContain('No pull requests in the queue');
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(1);
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
    // Focus is not selection: no row says it is selected, or not, so none reads "not selected".
    expect(host.querySelector('[aria-selected]')).toBeNull();
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

  it('opens a row on a double click, but not one on a control in it', () => {
    const onRowOpen = vi.fn<(key: string) => void>();
    const host = render(
      <QueueTable label="Merge queue for main" items={items} onRowOpen={onRowOpen} />,
    );
    twice(row(host, '4797').querySelector('[role="gridcell"]')!);
    expect(onRowOpen).toHaveBeenCalledExactlyOnceWith('4797');
    twice(row(host, '4810').querySelector('button')!);
    expect(onRowOpen).toHaveBeenCalledOnce();
  });

  it('draws a line under a row, across it, as a row of the grid', () => {
    const host = render(
      <QueueTable
        label="Merge queue for main"
        items={[{ kind: 'entry', entry: { ...first, note: <span>Couldn’t remove #4806</span> } }]}
      />,
    );
    const under = row(host, '4806').nextElementSibling;
    expect(under?.getAttribute('role')).toBe('row');
    expect(under?.hasAttribute('data-key')).toBe(false);
    expect(under?.querySelector('[role="gridcell"]')?.getAttribute('aria-colspan')).toBe('6');
    expect(under?.textContent).toBe('Couldn’t remove #4806');
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
        items={[...items, { kind: 'entry', entry: { ...removal, key: 'n', note: 'Note' } }]}
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
