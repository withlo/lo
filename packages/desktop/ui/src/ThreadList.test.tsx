// @vitest-environment jsdom
// The threads panel's rows and its filter: groups by file, each row's where, replies and state,
// the thread on screen and the one the keyboard is on, and the filter's counts.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import {
  ThreadFilter,
  ThreadList,
  type ThreadsFilter,
  type ThreadListGroup,
  type ThreadListRow,
} from './ThreadList.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

function row(key: string, more: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    key,
    author: 'tess-okafor',
    where: 'new 41',
    replies: 0,
    resolved: false,
    excerpt: 'This throws with retryAfter: 0.',
    ...more,
  };
}

const GROUPS: ThreadListGroup[] = [
  {
    key: 'rate-limit',
    label: 'plugins/rate-limit.ts',
    file: true,
    rows: [
      row('a', { where: 'old 30', replies: 1 }),
      row('b', { author: 'jun-park', replies: 2, where: 'new 36' }),
      row('c', { pending: true }),
      row('d', { author: 'mira-chen', resolved: true, replies: 1, where: 'new 12' }),
    ],
  },
  {
    key: 'schema',
    label: 'graphql/schema.graphql',
    file: true,
    rows: [row('e', { author: 'jun-park', outdated: true, where: 'r2 · line 22' })],
  },
  { key: 'drafts', label: 'Drafts on other revisions', rows: [row('f', { where: 'r3 · line 8' })] },
  { key: 'none', label: 'config/limits.yaml', file: true, rows: [] },
];

function rows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
}

describe('ThreadList', () => {
  it('groups the threads by file, a file with none leaving no group', () => {
    const host = render(<ThreadList groups={GROUPS} />);
    const groups = [...host.querySelectorAll('[role="group"]')];
    expect(groups.map((each) => each.getAttribute('aria-label'))).toEqual([
      'plugins/rate-limit.ts',
      'graphql/schema.graphql',
      'Drafts on other revisions',
    ]);
    expect(rows(host).map((each) => each.dataset['key'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // The file's name stands out from the folders before it.
    const name = groups[0]?.querySelector('[role="presentation"] span span');
    expect(name?.textContent).toBe('rate-limit.ts');
    expect(groups[2]?.querySelector('[role="presentation"] span span')).toBeNull();
  });

  it('says each thread where it is, its replies and its state in the one word GitHub uses', () => {
    const host = render(<ThreadList groups={GROUPS} />);
    const [a, b, c, d, e, f] = rows(host);
    expect(a?.textContent).toContain('old 30');
    expect(a?.textContent).toContain('1 reply');
    expect(a?.textContent).toContain('Unresolved');
    expect(a?.textContent).toContain('tess-okafor This throws with retryAfter: 0.');
    expect(b?.textContent).toContain('2 replies');
    // Yours and not sent: Pending, never Unresolved too.
    expect(c?.textContent).toContain('Pending');
    expect(c?.textContent).not.toContain('Unresolved');
    expect(c?.textContent).not.toContain('repl');
    expect(d?.textContent).toContain('Resolved');
    expect(e?.textContent).toContain('r2 · line 22');
    expect(e?.textContent).toContain('Outdated');
    expect(e?.textContent).toContain('Unresolved');
    expect(f?.textContent).toContain('r3 · line 8');
    // The rows say Unresolved, never Open.
    expect(host.textContent).not.toMatch(/\bOpen\b/);
  });

  it('marks the thread on screen and the one the keyboard is on, apart', () => {
    const host = render(<ThreadList groups={GROUPS} current="a" focused="b" />);
    const [a, b] = rows(host);
    expect(a?.getAttribute('aria-current')).toBe('true');
    expect(b?.getAttribute('aria-current')).toBeNull();
    expect(b?.getAttribute('aria-selected')).toBe('true');
    const list = host.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-activedescendant')).toBe(b?.id);
    expect(b?.className).toContain('group-focus-visible/list:shadow-ring-inset');
    expect(a?.className).not.toContain('shadow-ring-inset');
  });

  it('shows a thread when its row is clicked', () => {
    const onShow = vi.fn<(key: string) => void>();
    const host = render(<ThreadList groups={GROUPS} onShow={onShow} />);
    click(rows(host)[4]!);
    expect(onShow).toHaveBeenCalledWith('e');
  });

  it('says why there are none when it has nothing to list', () => {
    const host = render(<ThreadList groups={[]} empty="No unresolved threads." />);
    expect(host.textContent).toBe('No unresolved threads.');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('counts each choice of the filter, marks the one on, and changes it', () => {
    const onChange = vi.fn<(value: ThreadsFilter) => void>();
    const host = render(
      <ThreadFilter
        value="unresolved"
        counts={{ unresolved: 6, all: 9, yours: 3 }}
        keys={['f']}
        onChange={onChange}
      />,
    );
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((each) => each.textContent)).toEqual(['Unresolved 6', 'All 9', 'Yours 3']);
    expect(tabs.map((each) => each.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(host.textContent).toContain('f');
    click(tabs[1]!);
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <ThreadList groups={GROUPS} current="a" focused="b" />
        <ThreadFilter
          value="all"
          counts={{ unresolved: 1, all: 2, yours: 0 }}
          keys={['f']}
          onChange={vi.fn<(value: ThreadsFilter) => void>()}
        />
      </>,
    );
    expect(await missingRules(host, ['group-focus-visible/list:shadow-ring-inset'])).toEqual([]);
  });
});
