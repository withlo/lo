// @vitest-environment jsdom
// The checklist: a row for each reason, in the color of how it stands, with the checks it holds as
// sub-rows linked to their runs, and what's at its end.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { Checklist, type CheckItem, type CheckKind } from './Checklist.tsx';
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
    const host = render(<Checklist label="Why it can't merge" rows={blockers()} />);
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
    const host = render(<Checklist label="Kinds" rows={rows} />);
    for (const [kind, tint] of kinds) {
      const row = host.querySelector(`li[data-kind="${kind}"]`);
      expect(row?.querySelector('span')?.className).toContain(tint);
      expect(row?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(host.querySelectorAll('li[data-kind]')).toHaveLength(kinds.length);
  });

  it('draws a running check as a ring turning, and one that has not reported as a hollow ball', () => {
    const host = render(<Checklist label="Checks" rows={blockers()} />);
    const running = host.querySelector('li[data-key="running"]');
    expect(running?.querySelector('.spinner')).not.toBeNull();
    expect(running?.querySelector('svg')).toBeNull();
    const pending = host.querySelector('li[data-key="pending"]');
    expect(pending?.querySelector('.hollow')).not.toBeNull();
    expect(pending?.querySelector('.spinner')).toBeNull();
  });

  it('lists the checks a row holds as sub-rows, each with how it stands and a link to its run', () => {
    const open = vi.fn<(name: string) => void>();
    const host = render(<Checklist label="Checks" rows={blockers(open)} />);
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
    // A sub-row's name is in code type and cut short with its whole name on hover.
    const name = failed?.querySelector('.code-small');
    expect(name?.getAttribute('title')).toBe('test (node 20)');
    expect(name?.className).toContain('truncate');
  });

  it('puts what is at a row’s end, such as people or a button, in a column of its own', () => {
    const host = render(<Checklist label="Checks" rows={blockers()} />);
    const review = host.querySelector('li[data-key="review"]');
    const end = [...(review?.children ?? [])].at(-1);
    expect(end?.className).toContain('col-start-3');
    expect(end?.querySelectorAll('.rounded-pill')).toHaveLength(2);
    const next = host.querySelector('li[data-key="threads"] button');
    expect(next?.textContent).toContain('Next');
    expect(next?.textContent).toContain(']');
  });

  it('rings the row the keyboard is on', () => {
    const host = render(<Checklist label="Checks" rows={blockers()} focused="threads" />);
    const rows = [...host.querySelectorAll('ul > li[data-key]')];
    expect(rows.filter((each) => each.getAttribute('aria-current') === 'true')).toHaveLength(1);
    const on = host.querySelector('li[data-key="threads"]');
    expect(on?.getAttribute('aria-current')).toBe('true');
    expect(on?.className).toContain('shadow-ring-inset');
    expect(host.querySelector('li[data-key="review"]')?.className).not.toContain('ring');
  });

  it('draws the names of checks without the characters that turn text around', () => {
    const rows: CheckItem[] = [
      {
        key: 'x',
        kind: 'fail',
        glyph: 'failed',
        title: 'A check failed',
        subs: [{ key: 's', name: 'tes‮t (node 20)⁦', note: 'failed' }],
      },
    ];
    const host = render(<Checklist label="Checks" rows={rows} />);
    expect(host.innerHTML).not.toMatch(/[‪-‮⁦-⁩]/);
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
    const host = render(<Checklist label="Checks" rows={rows} />);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(<Checklist label="Checks" rows={blockers()} focused="review" />);
    expect(await missingRules(host)).toEqual([]);
  });
});
