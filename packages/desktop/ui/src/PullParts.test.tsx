// The parts of a pull request's tab: the header, a banner, the status bar, the state pill and the
// spinner, drawn as the window draws them.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { Banner } from './Banner.tsx';
import { PRHeader } from './PRHeader.tsx';
import { Skeleton, Spinner } from './Spinner.tsx';
import { StatePill } from './StatePill.tsx';
import { StatusBar, StatusItem } from './StatusBar.tsx';

/** Every class in `markup` but the design system's own and `group`. */
function classesIn(markup: string): string[] {
  return [
    ...new Set(
      [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
    ),
  ].filter((name) => name !== '' && name !== 'group' && !name.startsWith('lo-'));
}

const header = (
  <PRHeader
    number={78}
    title="Read empty input as no lines"
    state="open"
    author="rozed-bot"
    head={{ branch: 'app/head', fork: 'someone/e2e' }}
    base={{ branch: 'app/base' }}
    acting={{ login: 'rozed-bot' }}
    connection={{ tone: 'warn', label: 'Offline', detail: 'saved 14:02' }}
  >
    <span>Comparing</span>
  </PRHeader>
);

describe('PRHeader', () => {
  it('shows the state, title and number, who acts, the connection and the branches', () => {
    const markup = renderToStaticMarkup(header);
    expect(markup).toContain('Open</span>');
    expect(markup).toContain('<h1');
    expect(markup).toContain('Read empty input as no lines</h1>');
    expect(markup).toContain('#78</span>');
    expect(markup).toContain('Offline');
    expect(markup).toContain('· saved 14:02');
    expect(markup).toContain('Acting as rozed-bot');
    expect(markup).toContain('wants to merge');
    expect(markup).toContain('someone/e2e:app/head');
    expect(markup).toContain('app/base');
    expect(markup).toContain('Comparing');
  });

  it('holds the places of what hasn’t arrived, and shows no chip while all is well', () => {
    const markup = renderToStaticMarkup(<PRHeader number={78} />);
    expect(markup).not.toContain('<h1');
    expect(markup.match(/skeleton/g)).toHaveLength(3);
    expect(markup).not.toContain('Offline');
    expect(markup).not.toContain('Acting as');
  });

  it('says when it reads without signing in, and names a deleted author', () => {
    const markup = renderToStaticMarkup(
      <PRHeader
        number={1}
        title="A"
        state="merged"
        author={null}
        head={{ branch: 'a' }}
        base={{ branch: 'b' }}
        acting="anonymous"
      />,
    );
    expect(markup).toContain('Not signed in');
    expect(markup).toContain('A deleted account');
    expect(markup).toContain('Merged');
  });
});

describe('StatePill', () => {
  it('pairs each state’s color with its icon and word', () => {
    for (const [state, word] of [
      ['open', 'Open'],
      ['draft', 'Draft'],
      ['merged', 'Merged'],
      ['closed', 'Closed'],
    ] as const) {
      const markup = renderToStaticMarkup(<StatePill state={state} />);
      expect(markup).toContain(`state-${state}`);
      expect(markup).toContain('<svg');
      expect(markup).toContain(`${word}</span>`);
    }
  });
});

describe('Banner', () => {
  it('leads with what happened, then what to do, with its buttons', () => {
    const retry = vi.fn();
    const markup = renderToStaticMarkup(
      <Banner
        tone="warn"
        title="You're offline."
        detail="Showing what Lo saved 2 hours ago."
        actions={[{ label: 'Try again', onClick: retry }]}
        onDismiss={() => {}}
      />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('banner-warn');
    expect(markup).toContain('<strong class="font-semibold">You&#x27;re offline.</strong>');
    expect(markup).toContain('Showing what Lo saved 2 hours ago.');
    expect(markup).toMatch(/<button type="button" class="[^"]*">Try again<\/button>/);
    expect(markup).toContain('aria-label="Dismiss"');
  });

  it('is an alert when it’s about danger, and has no buttons when it offers nothing', () => {
    const markup = renderToStaticMarkup(<Banner tone="danger" title="The disk is full." />);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('<button');
  });
});

describe('StatusBar', () => {
  it('puts background work at the start, and where you are at the end', () => {
    const markup = renderToStaticMarkup(
      <StatusBar
        start={
          <StatusItem dot="ok" title="At 5530830">
            Local copy
          </StatusItem>
        }
        end={<span>NORMAL</span>}
      />,
    );
    expect(markup).toContain('aria-label="Status"');
    expect(markup.indexOf('Local copy')).toBeLessThan(markup.indexOf('NORMAL'));
    expect(markup).toContain('bg-success');
  });
});

describe('the parts’ styles', () => {
  it("only use utilities that Lo's stylesheet has", async () => {
    const markup = renderToStaticMarkup(
      <>
        {header}
        <PRHeader
          number={1}
          acting="anonymous"
          connection={{ tone: 'danger', label: 'Signed out' }}
        />
        <Banner
          tone="info"
          title="a"
          actions={[{ label: 'b', onClick: () => {} }]}
          onDismiss={() => {}}
        />
        <Banner tone="danger" title="a" />
        <StatusBar start={<StatusItem dot="busy">a</StatusItem>} />
        <StatusItem dot="warn">a</StatusItem>
        <StatusItem dot="fail">a</StatusItem>
        <StatusItem dot="idle">a</StatusItem>
        <StatePill state="draft" />
        <StatePill state="merged" />
        <StatePill state="closed" />
        <Spinner size="xs" />
        <Spinner />
        <Skeleton className="w-48" />
      </>,
    );
    const classes = classesIn(markup);
    expect(classes.length).toBeGreaterThan(40);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
