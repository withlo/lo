// @vitest-environment jsdom
// The bar over a run of layers on screen as one diff: what it says of the run, and the way back.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import { RunBar, type RunBarProps } from './RunBar.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const PROPS: RunBarProps = {
  layers: [
    { number: 4819, title: 'Load per-plan limits' },
    { number: 4821, title: 'Rate limit GraphQL queries by cost' },
  ],
  branches: { from: 'ravi/token-bucket', to: 'ravi/graphql-cost' },
  files: { count: 245 },
  back: 4821,
  backKeys: ['Esc'],
  onBack: () => undefined,
};

function said(host: HTMLElement): string {
  return host.querySelector('[role="region"]')?.textContent ?? '';
}

describe('RunBar', () => {
  it('says how many layers and which, the branches, the file count and the way back', () => {
    const host = render(<RunBar {...PROPS} />);
    expect(host.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Run of layers');
    expect(said(host)).toBe(
      '2 layers as one diff · #4819 Load per-plan limits and #4821 Rate limit GraphQL queries by cost' +
        'ravi/token-bucket → ravi/graphql-cost · 245 files' +
        'Back to #4821Esc',
    );
  });

  it('says what shows instead when the run couldn’t be compared, and no longer the branches or the files', () => {
    const host = render(
      <RunBar
        {...PROPS}
        instead="Showing only #4821’s pull request: GitHub couldn’t compare the run as one diff"
      />,
    );
    expect(said(host)).toBe(
      'Showing only #4821’s pull request: GitHub couldn’t compare the run as one diff · #4819 Load per-plan limits and #4821 Rate limit GraphQL queries by cost' +
        'Back to #4821Esc',
    );
    // The line may be cut, so its title says all of it.
    expect(host.querySelector('p')?.getAttribute('title')).toBe(
      'Showing only #4821’s pull request: GitHub couldn’t compare the run as one diff · #4819 Load per-plan limits and #4821 Rate limit GraphQL queries by cost',
    );
    // Neither how many layers it holds, nor where its diff goes between, nor how many files.
    expect(said(host)).not.toContain('layers as one diff');
    expect(said(host)).not.toContain('→');
    expect(said(host)).not.toContain('245');
  });

  it('keeps the file count whole, and leaves the branches out first, when the bar is narrow', async () => {
    const host = render(<RunBar {...PROPS} />);
    const count = [...host.querySelectorAll('span')].find(
      (each) => each.textContent === '245 files',
    );
    const branches = host.querySelector('span.truncate');
    expect(count?.className).toContain('whitespace-nowrap');
    expect(count?.className).not.toContain('truncate');
    // The bar is the container the branches are measured against, and a narrow one hides them.
    expect(host.querySelector('[role="region"]')?.className).toContain('@container');
    expect(branches?.className).toContain('run-branches');
    const css = await buildCss(['run-branches']);
    expect(css).toMatch(/@container \(width < 1000px\) \{\s*\.run-branches \{\s*display: none;/);
    // No width of its own: the bar's width decides, not a number.
    expect(css).not.toMatch(/\.run-branches \{[^}]*max-width/);
  });

  it('lists three layers or more with commas, and names a layer by number until its title is known', () => {
    const host = render(
      <RunBar
        {...PROPS}
        layers={[{ number: 82, title: 'Root' }, { number: 83 }, { number: 84, title: 'Top' }]}
        branches={undefined}
        files={{ count: 300, partial: true }}
        backKeys={undefined}
      />,
    );
    expect(said(host)).toBe(
      '3 layers as one diff · #82 Root, #83 and #84 Top300+ filesBack to #4821',
    );
    const one = render(<RunBar {...PROPS} files={{ count: 1 }} branches={undefined} />);
    expect(said(one)).toContain('1 file');
    expect(said(one)).not.toContain('1 files');
  });

  it('goes back with its button', () => {
    const onBack = vi.fn<() => void>();
    const host = render(<RunBar {...PROPS} onBack={onBack} />);
    const button = host.querySelector('button');
    if (!button) throw new Error('No button.');
    click(button);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('draws a pull request’s text as text', () => {
    const host = render(
      <RunBar
        {...PROPS}
        layers={[{ number: 1, title: '<img src=x onerror=alert(1)>' }, { number: 2 }]}
      />,
    );
    expect(host.querySelector('img')).toBeNull();
    expect(said(host)).toContain('<img src=x onerror=alert(1)>');
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    const host = render(<RunBar {...PROPS} />);
    const classes = [
      ...new Set(
        [...host.querySelectorAll('[class]')].flatMap(
          (element) => element.getAttribute('class')?.split(/\s+/) ?? [],
        ),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-') && !name.startsWith('group/'));
    expect(classes.length).toBeGreaterThan(10);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
