import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import {
  bringIn,
  dragOffset,
  dragPlace,
  foldTabs,
  slideOf,
  TabBar,
  tabsThatFit,
  type Tab,
} from './TabBar.tsx';

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
    // And its place among them, for a screen reader.
    expect(tabsIn(markup).map((each) => /aria-posinset="(\d+)"/.exec(each)?.[1])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(markup.match(/aria-setsize="5"/g)).toHaveLength(5);
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

/** What the strip shows of `order`, four fitting, with F on screen. */
function strip(order: readonly { id: string }[]): string[] {
  return ids(foldTabs(bringIn(order, 'F', 4).tabs, 4).shown);
}

/** Ten tabs, `t1` to `t10`. */
function tenTabs(): { id: string }[] {
  return Array.from({ length: 10 }, (_, index) => ({ id: `t${index + 1}` }));
}

describe('tabs that don’t fit', () => {
  const ten = tenTabs();

  it('fold after the first that fit, in order', () => {
    const { shown, folded } = foldTabs(ten, 4);
    expect(ids(shown)).toEqual(['t1', 't2', 't3', 't4']);
    expect(ids(folded)).toEqual(['t5', 't6', 't7', 't8', 't9', 't10']);
    // With room for none, one shows.
    expect(ids(foldTabs(ten, 0).shown)).toEqual(['t1']);
  });

  it('never fold the tab on screen, which moves into the last place that fits', () => {
    const { tabs: order, moved } = bringIn(ten, 't9', 4);
    expect(moved).toEqual({ id: 't9', to: 3 });
    const { shown, folded } = foldTabs(order, 4);
    expect(ids(shown)).toEqual(['t1', 't2', 't3', 't9']);
    expect(ids(folded)).toEqual(['t4', 't5', 't6', 't7', 't8', 't10']);
    // With room for one, it's the one.
    expect(ids(foldTabs(bringIn(ten, 't7', 1).tabs, 1).shown)).toEqual(['t7']);
    expect(ids(foldTabs(bringIn(ten, 't7', 0).tabs, 0).shown)).toEqual(['t7']);
    // One that fits stays where it is.
    expect(bringIn(ten, 't4', 4)).toEqual({ tabs: ten });
  });

  it('don’t exist while every tab fits, or while the room isn’t known', () => {
    expect(foldTabs(ten, 10).folded).toEqual([]);
    expect(foldTabs(ten, undefined).folded).toEqual([]);
    expect(bringIn(ten, 't9', 10)).toEqual({ tabs: ten });
    expect(bringIn(ten, 't9', undefined)).toEqual({ tabs: ten });
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

describe('dragging a tab', () => {
  // Five tabs 100 px wide, 2 px apart.
  const slots = [0, 102, 204, 306, 408].map((left) => ({ left, width: 100 }));

  it('follows the pointer, but not past the first or the last tab shown', () => {
    expect(dragOffset(slots, 1, 30)).toBe(30);
    expect(dragOffset(slots, 1, -30)).toBe(-30);
    expect(dragOffset(slots, 1, -500)).toBe(-102);
    expect(dragOffset(slots, 1, 500)).toBe(306);
    expect(dragOffset(slots, 4, 1)).toBe(0);
  });

  it('lands after the tabs whose middle its own has passed', () => {
    expect(dragPlace(slots, 1, 0)).toBe(1);
    // Its middle, at 152, reaches the next tab's, at 254, once it's moved 102 px.
    expect(dragPlace(slots, 1, 101)).toBe(1);
    expect(dragPlace(slots, 1, 102)).toBe(2);
    expect(dragPlace(slots, 3, -205)).toBe(1);
    // As far as it goes either way, it passes them all.
    expect(dragPlace(slots, 1, 306)).toBe(4);
    expect(dragPlace(slots, 1, -102)).toBe(0);
    expect(dragPlace(slots, 3, -306)).toBe(0);
  });

  it('slides the tabs it passes aside, toward where it came from, by the room it leaves', () => {
    // Tab 1 dragged to land after three others: tabs 2 and 3 move back a place.
    expect([0, 2, 3, 4].map((index) => slideOf(index, 1, 3, 102))).toEqual([0, -102, -102, 0]);
    // Tab 3 dragged to land first: tabs 0 to 2 move on a place.
    expect([0, 1, 2, 4].map((index) => slideOf(index, 3, 0, 102))).toEqual([102, 102, 102, 0]);
    // Back where it was, nothing moves.
    expect([0, 1, 3, 4].map((index) => slideOf(index, 2, 2, 102))).toEqual([0, 0, 0, 0]);
  });

  it('lands where the strip showed it, with a tab brought in from "N more"', () => {
    // A to G, four fitting, and F chosen from "N more": the strip shows A B C F.
    const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => ({ id }));
    const { tabs: order } = bringIn(seven, 'F', 4);
    expect(strip(order)).toEqual(['A', 'B', 'C', 'F']);
    // B let go after the three others shown lands fourth of all: last in the strip, still shown.
    const dropped = order.filter(({ id }) => id !== 'B').toSpliced(3, 0, { id: 'B' });
    expect(strip(dropped)).toEqual(['A', 'C', 'F', 'B']);
    // F a place left, as ⌃⇧PgUp moves it, is a place left in the strip.
    const stepped = order.filter(({ id }) => id !== 'F').toSpliced(2, 0, { id: 'F' });
    expect(strip(stepped)).toEqual(['A', 'B', 'F', 'C']);
  });
});

describe('TabBar styles', () => {
  it("only uses utilities that Lo's stylesheet has, so no spacing is silently dropped", async () => {
    const markup = renderToStaticMarkup(
      <TabBar tabs={[...tabs, { kind: 'recent', id: 'r' }]} selected="a" onNew={() => {}} />,
    );
    // And those a tab takes only while one is dragged.
    const dragging = ['tab-dragged', 'tab-slide', 'bg-bg-raised', 'text-fg'];
    const classes = [
      ...new Set([
        ...[...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) =>
          (value ?? '').split(/\s+/),
        ),
        ...dragging,
      ]),
    ]
      // The design system's own classes (lo-i, lo-num) and `group`, which marks a parent.
      .filter((name) => name !== '' && name !== 'group' && !name.startsWith('lo-'));
    expect(classes.length).toBeGreaterThan(30);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
