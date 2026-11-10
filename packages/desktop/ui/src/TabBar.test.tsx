import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TabBar, type Tab } from './TabBar.tsx';

const tabs: Tab[] = [
  {
    id: 'a',
    repo: 'atlas-api',
    number: 4821,
    title: 'Rate limit GraphQL queries by cost',
    state: 'open',
    stack: 4,
  },
  {
    id: 'b',
    repo: 'atlas-web',
    number: 2290,
    title: 'Move billing settings to the new layout',
    state: 'draft',
  },
];

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
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain('#4821');
    expect(markup).toContain('title="Stack of 4"');
    expect(markup).not.toContain('aria-disabled');
  });
});
