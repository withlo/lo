import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { TabBar, type Tab } from './TabBar.tsx';

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
    expect(markup).toContain('aria-label="Open a pull request"');
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
    expect(markup).toContain('fd <span class="lo-num">#2212</span>');
    expect(markup).not.toContain('title="open"');
    expect(markup).toContain('aria-label="Close tab"');
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
