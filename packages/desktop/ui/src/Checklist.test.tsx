// @vitest-environment jsdom
// The checklist: a row for each reason, in the color of how it stands, with the checks it holds as
// sub-rows linked to their runs, and what's at its end.

import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, press, render, rerender, tipOf } from '../test/dom.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { Checklist, checkRowId, type CheckItem, type CheckKind } from './Checklist.tsx';
import { Key } from './Key.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

/** The rows for a pull request that can't merge yet. */
function blockers(open = vi.fn<(name: string) => void>()): CheckItem[] {
  return [
    {
      key: 'review',
      kind: 'fail',
      glyph: 'review',
      title: 'Review required',
      detail: (
        <>
          1 more approval, and one from a code owner of src/graphql/:{' '}
          <strong className="font-semibold text-fg">@fieldwork/api-platform</strong>.
        </>
      ),
      end: (
        <>
          <Avatar login="tess-okafor" size="sm" />
          <Avatar login="jun-park" size="sm" />
        </>
      ),
    },
    {
      key: 'failed',
      kind: 'fail',
      glyph: 'failed',
      title: '1 required check failed',
      subs: [
        {
          key: 'test',
          name: 'test (node 20)',
          note: '3 failed of 412',
          tone: 'fail',
          link: { label: 'Open the run ↗', onOpen: () => open('test (node 20)') },
        },
      ],
    },
    {
      key: 'running',
      kind: 'wait',
      glyph: 'running',
      title: '2 checks running',
      subs: [
        {
          key: 'e2e',
          name: 'e2e (chromium)',
          note: '6 min',
          link: { label: 'Run ↗', onOpen: () => open('e2e (chromium)') },
        },
        {
          key: 'typecheck',
          name: 'typecheck',
          note: '1 min',
          link: { label: 'Run ↗', onOpen: () => open('typecheck') },
        },
      ],
    },
    {
      key: 'pending',
      kind: 'todo',
      glyph: 'pending',
      title: "1 check hasn't reported",
      detail: "security/scan is required by the branch rules but hasn't started.",
    },
    {
      key: 'threads',
      kind: 'fail',
      glyph: 'conversation',
      title: '5 unresolved conversations',
      detail: 'The branch rules ask for every conversation to be resolved.',
      end: (
        <Button variant="ghost" size="sm">
          Next <Key keys={[']', 't']} quiet decorative />
        </Button>
      ),
    },
    {
      key: 'behind',
      kind: 'wait',
      glyph: 'behind',
      title: 'Out of date with ravi/plan-limits',
      detail: "2 commits behind. The author updates the branch; Lo doesn't add commits to a PR.",
    },
  ];
}

describe('Checklist', () => {
  it('draws a row for each reason, in order, titled and detailed', () => {
    const host = render(<Checklist id="reasons" label="Why it can't merge" rows={blockers()} />);
    const list = host.querySelector('ul[aria-label="Why it can\'t merge"]');
    expect(list).not.toBeNull();
    const rows = [...host.querySelectorAll<HTMLElement>('ul > li[data-key]')];
    expect(rows.map((each) => each.dataset.key)).toEqual([
      'review',
      'failed',
      'running',
      'pending',
      'threads',
      'behind',
    ]);
    expect(rows[0]?.textContent).toContain('Review required');
    expect(rows[0]?.textContent).toContain('@fieldwork/api-platform');
    expect(rows[5]?.textContent).toContain("Lo doesn't add commits to a PR.");
    // The row that has only a title has no detail line.
    expect(rows[1]?.textContent).not.toContain('Review');
  });

  it('tints each row for how it stands, and draws every icon aria-hidden', () => {
    const kinds: readonly (readonly [CheckKind, string])[] = [
      ['fail', 'text-danger'],
      ['wait', 'text-warning'],
      ['ok', 'text-success'],
      ['todo', 'text-fg-dim'],
      ['info', 'text-fg-muted'],
    ];
    const rows: CheckItem[] = kinds.map(([kind]) => ({
      key: kind,
      kind,
      glyph: kind === 'ok' ? 'ok' : 'unknown',
      title: kind,
    }));
    const host = render(<Checklist id="reasons" label="Kinds" rows={rows} />);
    for (const [kind, tint] of kinds) {
      const row = host.querySelector(`li[data-kind="${kind}"]`);
      expect(row?.querySelector('span')?.className).toContain(tint);
      expect(row?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(host.querySelectorAll('li[data-kind]')).toHaveLength(kinds.length);
  });

  it('draws a running check as a ring turning, and one that has not reported as a hollow ball', () => {
    const host = render(<Checklist id="reasons" label="Checks" rows={blockers()} />);
    const running = host.querySelector('li[data-key="running"]');
    expect(running?.querySelector('.spinner')).not.toBeNull();
    expect(running?.querySelector('svg')).toBeNull();
    const pending = host.querySelector('li[data-key="pending"]');
    expect(pending?.querySelector('.hollow')).not.toBeNull();
    expect(pending?.querySelector('.spinner')).toBeNull();
  });

  it('lists the checks a row holds as sub-rows, each with how it stands and a link to its run', () => {
    const open = vi.fn<(name: string) => void>();
    const host = render(<Checklist id="reasons" label="Checks" rows={blockers(open)} />);
    const subs = [...host.querySelectorAll('li[data-key="running"] ul > li')];
    expect(subs.map((each) => each.textContent)).toEqual([
      'e2e (chromium)6 minRun ↗',
      'typecheck1 minRun ↗',
    ]);
    const failed = host.querySelector('li[data-key="failed"] ul > li');
    // A failing note is in the failing color; a waiting one is quiet.
    expect(failed?.querySelector('.text-danger')?.textContent).toBe('3 failed of 412');
    expect(subs[0]?.querySelector('.text-danger')).toBeNull();
    // Each link names its check, so links that read the same are told apart.
    const links = [...host.querySelectorAll<HTMLElement>('li ul button')];
    expect(links.map((each) => each.getAttribute('aria-label'))).toEqual([
      'Open the run: test (node 20)',
      'Run: e2e (chromium)',
      'Run: typecheck',
    ]);
    click(links[1]!);
    expect(open).toHaveBeenCalledWith('e2e (chromium)');
    // A sub-row's name is in code type, and cut short with its whole name as its tooltip.
    const name = failed?.querySelector('.code-small');
    expect(name?.className).toContain('truncate');
    expect(tipOf(name!)).toBeUndefined();
    expect(tipOf(name!, { cut: true })).toBe('test (node 20)');
  });

  it('puts what is at a row’s end, such as people or a button, in a column of its own', () => {
    const host = render(<Checklist id="reasons" label="Checks" rows={blockers()} />);
    const review = host.querySelector('li[data-key="review"]');
    const end = [...(review?.children ?? [])].at(-1);
    expect(end?.className).toContain('col-start-3');
    expect(end?.querySelectorAll('.rounded-pill')).toHaveLength(2);
    const next = host.querySelector('li[data-key="threads"] button');
    expect(next?.textContent).toContain('Next');
    expect(next?.textContent).toContain(']');
  });

  it('names each row by an id of its own, for whatever holds focus to point at', () => {
    const host = render(<Checklist id="reasons" label="Checks" rows={blockers()} />);
    const ids = [...host.querySelectorAll('ul > li[data-key]')].map((each) => each.id);
    expect(ids).toEqual(
      ['review', 'failed', 'running', 'pending', 'threads', 'behind'].map((key) =>
        checkRowId('reasons', key),
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    // Two lists with other ids draw rows with other ids.
    expect(checkRowId('reasons', 'review')).not.toBe(checkRowId('other', 'review'));
  });

  it('is a listbox of options that can hold focus, as the other lists are', () => {
    const list = createRef<HTMLUListElement>();
    const host = render(
      <Checklist id="reasons" label="Checks" rows={blockers()} listRef={list} focused="review" />,
    );
    const box = host.querySelector<HTMLElement>('[role="listbox"]');
    expect(list.current).toBe(box);
    expect(box?.getAttribute('aria-label')).toBe('Checks');
    // It can hold focus, so what names the row the keyboard is on means something.
    expect(box?.tabIndex).toBe(0);
    focus(box!);
    expect(document.activeElement).toBe(box);
    const options = [...host.querySelectorAll('[role="listbox"] > li')];
    expect(options).toHaveLength(6);
    expect(options.every((each) => each.getAttribute('role') === 'option')).toBe(true);
    // Focus is not selection: none says it is selected, or not.
    expect(host.querySelector('[aria-selected]')).toBeNull();
  });

  it('names the row the keyboard is on as its active descendant, and rings only that row', () => {
    const host = render(
      <Checklist id="reasons" label="Checks" rows={blockers()} focused="threads" />,
    );
    const box = host.querySelector('[role="listbox"]');
    const on = host.querySelector('li[data-key="threads"]');
    expect(box?.getAttribute('aria-activedescendant')).toBe(on?.id);
    expect(on?.hasAttribute('data-focused')).toBe(true);
    // The ring shows only inside a `group/list` that has keyboard focus, as a list's rows' do.
    expect(box?.className).toContain('group/list');
    expect(on?.className).toContain('group-focus-visible/list:shadow-ring-inset');
    expect(host.querySelectorAll('[data-focused]')).toHaveLength(1);
    expect(host.querySelector('li[data-key="review"]')?.className).not.toContain('ring');
    // Focus is where the keyboard is; current is what's on screen: nothing here is current.
    expect(host.querySelector('[aria-current]')).toBeNull();
  });

  it('names no row when the keyboard is on none, or on one that is not in the list', () => {
    const host = render(<Checklist id="reasons" label="Checks" rows={blockers()} />);
    const box = () => host.querySelector('[role="listbox"]');
    expect(box()?.hasAttribute('aria-activedescendant')).toBe(false);
    rerender(host, <Checklist id="reasons" label="Checks" rows={blockers()} focused="gone" />);
    expect(box()?.hasAttribute('aria-activedescendant')).toBe(false);
    expect(host.querySelector('[data-focused]')).toBeNull();
    // A row that was on, and has gone, leaves nothing for the list to point at.
    rerender(host, <Checklist id="reasons" label="Checks" rows={blockers()} focused="behind" />);
    expect(box()?.getAttribute('aria-activedescendant')).toBe(checkRowId('reasons', 'behind'));
    rerender(
      host,
      <Checklist id="reasons" label="Checks" rows={blockers().slice(0, 2)} focused="behind" />,
    );
    expect(box()?.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('takes its keys and key scope as attributes, for the feature that drives it', () => {
    const onKeyDown = vi.fn<(event: { key: string }) => void>();
    const host = render(
      <Checklist
        id="reasons"
        label="Checks"
        rows={blockers()}
        data-lo-scope="merge"
        onKeyDown={onKeyDown}
      />,
    );
    const box = host.querySelector('[role="listbox"]');
    expect(box?.getAttribute('data-lo-scope')).toBe('merge');
    press(box!, 'j');
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('j');
  });

  it('is a group, not a listbox without options, when it has no rows', () => {
    const host = render(<Checklist id="reasons" label="Checks" rows={[]} />);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Checks');
  });

  it('gives a row a link of its own, named for the row', () => {
    const open = vi.fn<() => void>();
    const rows: CheckItem[] = [
      {
        key: 'unknown',
        kind: 'wait',
        glyph: 'unknown',
        title: 'GitHub says no, and not why',
        detail: 'Lo checked reviews, checks, conversations and rules.',
        link: { label: 'See it on GitHub ↗', onOpen: open },
      },
      { key: 'plain', kind: 'info', glyph: 'draft', title: 'This is a draft' },
    ];
    const host = render(<Checklist id="reasons" label="Why" rows={rows} />);
    const links = host.querySelectorAll('li > span > button');
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link?.textContent).toBe('See it on GitHub ↗');
    expect(link?.getAttribute('aria-label')).toBe('See it on GitHub: GitHub says no, and not why');
    click(link!);
    expect(open).toHaveBeenCalledOnce();
    // It sits under the row's detail, in the column of the text.
    expect(link?.parentElement?.className).toContain('col-start-2');
    expect(host.querySelectorAll('li[data-key="plain"] button')).toHaveLength(0);
  });

  it('draws a row’s title and detail, when they are text, without the characters that turn text around', () => {
    const rows: CheckItem[] = [
      {
        key: 'x',
        kind: 'fail',
        glyph: 'rule',
        title: 'main requires \u202Esigned commits',
        detail: 'A rule on \u2066main\u2069.',
      },
    ];
    const host = render(<Checklist id="reasons" label="Why" rows={rows} />);
    expect(host.innerHTML).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(host.textContent).toContain('main requires signed commits');
    expect(host.textContent).toContain('A rule on main.');
  });

  it('draws the names of checks without the characters that turn text around', () => {
    const rows: CheckItem[] = [
      {
        key: 'x',
        kind: 'fail',
        glyph: 'failed',
        title: 'A check failed',
        subs: [{ key: 's', name: 'tes\u202Et (node 20)\u2066', note: 'failed' }],
      },
    ];
    const host = render(<Checklist id="reasons" label="Checks" rows={rows} />);
    expect(host.innerHTML).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(host.textContent).toContain('test (node 20)');
  });

  it('draws text as text, never as markup', () => {
    const rows: CheckItem[] = [
      {
        key: 'x',
        kind: 'fail',
        glyph: 'failed',
        title: 'A check failed',
        subs: [{ key: 's', name: '<img src=x onerror=alert(1)>', note: '<b>no</b>' }],
      },
    ];
    const host = render(<Checklist id="reasons" label="Checks" rows={rows} />);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <Checklist id="reasons" label="Checks" rows={blockers()} focused="review" />,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
