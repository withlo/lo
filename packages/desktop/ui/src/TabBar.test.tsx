import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { foldTabs, TabBar, tabsThatFit, type Tab } from './TabBar.tsx';

const tabs: Tab[] = [
  {
    kind: 'pull',
    id: 'a',
    repo: 'atlas-api',
    number: 4821,
    title: 'Rate limit GraphQL queries by cost',
    state: 'open',
    stack: 4,
  },
  {
    kind: 'pull',
    id: 'b',
    repo: 'atlas-web',
    number: 2290,
    title: 'Move billing settings to the new layout',
    state: 'draft',
  },
  {
    kind: 'pull',
    id: 'c',
    repo: 'atlas-web',
    number: 2291,
    title: 'Fix the footer',
    state: 'merged',
  },
  {
    kind: 'pull',
    id: 'd',
    repo: 'atlas-web',
    number: 2292,
    title: 'Drop the old API',
    state: 'closed',
  },
  { kind: 'settings', id: 'e' },
];

/** The markup of each tab, in order. */
function tabsIn(markup: string): string[] {
  return markup.split('role="tab"').slice(1);
}

describe('TabBar', () => {
  it('draws an empty strip with only the button that opens a pull request', () => {
    const markup = renderToStaticMarkup(<TabBar tabs={[]} />);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Pull requests"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).toContain('aria-label="Review a pull request"');
    // Inert until there's a way to open one.
    expect(markup).toContain('aria-disabled="true"');
  });

  it('draws a tab per pull request, with the selected one marked', () => {
    const markup = renderToStaticMarkup(<TabBar tabs={tabs} selected="a" onNew={() => {}} />);
    expect(markup.match(/role="tab"/g)).toHaveLength(5);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('#4821');
    expect(markup).toContain('title="Stack of 4"');
    expect(markup).not.toContain('aria-disabled');
    // Each carries its id, for a right-click on it.
    expect(tabsIn(markup).map((each) => /data-tab="([^"]*)"/.exec(each)?.[1])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('shows a pull request by its repository and number until its title and state arrive', () => {
    const markup = renderToStaticMarkup(
      <TabBar tabs={[{ kind: 'pull', id: 'a', repo: 'fd', number: 2212 }]} selected="a" />,
    );
    expect(markup).toMatch(/>fd <\/span><span[^>]*>#2212<\/span>/);
    expect(markup).not.toContain('title="open"');
    expect(markup).toContain('aria-label="Close tab"');
    // Not opening: nothing says it's busy.
    expect(markup).not.toContain('aria-busy');
    expect(markup).not.toContain('spinner');
  });

  it('shows a spinner and a placeholder on a tab still opening, until its title arrives', () => {
    const opening = renderToStaticMarkup(
      <TabBar tabs={[{ kind: 'pull', id: 'a', repo: 'fd', number: 2212, loading: true }]} />,
    );
    expect(opening).toContain('aria-busy="true"');
    expect(opening).toContain('spinner');
    expect(opening).toContain('skeleton');
    expect(opening).toMatch(/>fd <\/span><span[^>]*>#2212<\/span>/);
    const arrived = renderToStaticMarkup(
      <TabBar
        tabs={[{ kind: 'pull', id: 'a', repo: 'fd', number: 2212, loading: true, title: 'Done' }]}
      />,
    );
    expect(arrived).not.toContain('aria-busy');
    expect(arrived).not.toContain('skeleton');
    expect(arrived).toContain('Done</span>');
  });

  it("keeps a narrow tab's repository, cut short, and gives a long one half the tab at most", () => {
    const markup = renderToStaticMarkup(
      <TabBar
        tabs={[{ kind: 'pull', id: 'a', repo: 'r'.repeat(100), number: 123456, title: 'T' }]}
      />,
    );
    const repository = /<span class="([^"]*)">r{100} <\/span>/.exec(markup)?.[1] ?? '';
    expect(repository.split(' ')).toEqual(
      expect.arrayContaining(['min-w-16', 'max-w-1/2', 'truncate', 'shrink']),
    );
    expect(markup).toMatch(/<span class="[^"]*flex-none[^"]*">#123456<\/span>/);
  });

  it("takes no room for another tab's close button until it's hovered", () => {
    const [selected, other] = tabsIn(renderToStaticMarkup(<TabBar tabs={tabs} selected="a" />));
    expect(selected).toMatch(/aria-label="Close tab"[^>]*class="[^"]* grid"/);
    expect(other).toMatch(/aria-label="Close tab"[^>]*class="[^"]* hidden group-hover:grid"/);
  });

  it('names Recent pull requests and Settings, and gives Recent no close button', () => {
    const markup = renderToStaticMarkup(
      <TabBar
        tabs={[
          { kind: 'recent', id: 'recent' },
          { kind: 'settings', id: 's' },
        ]}
        selected="recent"
      />,
    );
    const [recent, settings] = tabsIn(markup);
    expect(recent).toContain('Recent pull requests');
    expect(recent).not.toContain('Close tab');
    expect(settings).toContain('Settings');
    expect(settings).toContain('aria-label="Close tab"');
  });
});

/** The ids of `list`, in order. */
function ids(list: readonly { id: string }[]): string[] {
  return list.map(({ id }) => id);
}

describe('tabs that don’t fit', () => {
  const ten = Array.from({ length: 10 }, (_, index) => ({ id: `t${index + 1}` }));

  it('fold after the first that fit, in order', () => {
    const { shown, folded } = foldTabs(ten, 't2', 4);
    expect(ids(shown)).toEqual(['t1', 't2', 't3', 't4']);
    expect(ids(folded)).toEqual(['t5', 't6', 't7', 't8', 't9', 't10']);
  });

  it('never fold the tab on screen, which takes the last place that fits', () => {
    const { shown, folded } = foldTabs(ten, 't9', 4);
    expect(ids(shown)).toEqual(['t1', 't2', 't3', 't9']);
    expect(ids(folded)).toEqual(['t4', 't5', 't6', 't7', 't8', 't10']);
    // With room for one, it's the one.
    expect(ids(foldTabs(ten, 't7', 1).shown)).toEqual(['t7']);
    expect(ids(foldTabs(ten, 't7', 0).shown)).toEqual(['t7']);
  });

  it('don’t exist while every tab fits, or while the room isn’t known', () => {
    expect(foldTabs(ten, 't9', 10).folded).toEqual([]);
    expect(foldTabs(ten, 't9', undefined).folded).toEqual([]);
  });

  it('are counted against the strip’s room: all beside +, or as many as fit beside "N more" too', () => {
    const room = { width: 1010, tab: 120, gap: 2, plus: 28, more: 80 };
    // Eight at 122 px and + fit in 1,010 px.
    expect(tabsThatFit(room, 8)).toBe(8);
    // Nine don't, so seven fit beside both buttons.
    expect(tabsThatFit(room, 9)).toBe(7);
    expect(tabsThatFit(room, 40)).toBe(7);
    // However narrow the strip, the tab on screen shows.
    expect(tabsThatFit({ ...room, width: 100 }, 3)).toBe(1);
  });
});

describe('TabBar styles', () => {
  it("only uses utilities that Lo's stylesheet has, so no spacing is silently dropped", async () => {
    const markup = renderToStaticMarkup(
      <TabBar tabs={[...tabs, { kind: 'recent', id: 'r' }]} selected="a" onNew={() => {}} />,
    );
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ]
      // The design system's own classes (lo-i, lo-num) and `group`, which marks a parent.
      .filter((name) => name !== '' && name !== 'group' && !name.startsWith('lo-'));
    expect(classes.length).toBeGreaterThan(30);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
