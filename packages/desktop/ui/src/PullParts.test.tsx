// The parts of a pull request's tab: the header, a banner, the status bar, the state pill and the
// spinner, drawn as the window draws them.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { Banner, BannerPlaceProvider } from './Banner.tsx';
import { PRHeader } from './PRHeader.tsx';
import { Skeleton, Spinner } from './Spinner.tsx';
import { StatePill } from './StatePill.tsx';
import { StatusBar, StatusItem, type StatusBallState } from './StatusBar.tsx';

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
    connection={{
      kind: 'offline',
      tone: 'warn',
      label: 'Offline',
      details: <p>Checked 5 min ago</p>,
    }}
  >
    <span>Comparing</span>
  </PRHeader>
);

/** A status item with a ball in `state`, as markup. */
const ball = (state: StatusBallState) =>
  renderToStaticMarkup(<StatusItem ball={state}>a</StatusItem>);

describe('PRHeader', () => {
  it('shows the state, title and number, who acts, the connection and the branches', () => {
    const markup = renderToStaticMarkup(header);
    expect(markup).toContain('Open</span>');
    expect(markup).toContain('<h1');
    expect(markup).toContain('Read empty input as no lines</h1>');
    expect(markup).toContain('#78</span>');
    expect(markup).toContain('Offline');
    // The chip is a word or two, and a button that opens what's behind it.
    expect(markup).not.toContain('Checked 5 min ago');
    expect(markup).toMatch(/<button type="button"[^>]*chip-warn[^>]*>.*Offline<\/button>/);
    expect(markup).toMatch(/as<\/span> rozed-bot/);
    expect(markup).not.toContain('Acting as');
    expect(markup).toContain('wants to merge');
    expect(markup).toContain('someone/e2e:app/head');
    expect(markup).toContain('app/base');
    expect(markup).toContain('Comparing');
  });

  it('says the author merged the branches once it has merged, and wanted to once it closed', () => {
    expect(headerOf('merged')).toContain('> merged</span>');
    expect(headerOf('merged')).not.toContain('wants to merge');
    expect(headerOf('closed')).toContain('> wanted to merge</span>');
    expect(headerOf('draft')).toContain('> wants to merge</span>');
    // A branch is given up whole where it can't show a few letters, never cut to one.
    expect(headerOf('draft')).toMatch(/data-gives="branches" class="flex min-w-48 shrink"/);
  });

  it('holds the places of what hasn’t arrived, and shows no chip while all is well', () => {
    const markup = renderToStaticMarkup(<PRHeader number={78} />);
    expect(markup).not.toContain('<h1');
    expect(markup.match(/skeleton/g)).toHaveLength(3);
    expect(markup).not.toContain('Offline');
    expect(markup).not.toContain('rozed-bot');
  });

  it('holds no places for a pull request it can’t show, and names it by its repo and number', () => {
    const markup = renderToStaticMarkup(
      <PRHeader number={9999} missing={{ repo: 'rozed-dev/e2e' }} />,
    );
    expect(markup).not.toContain('skeleton');
    expect(markup).toMatch(/<h1[^>]*>rozed-dev\/e2e<\/h1>/);
    expect(markup).toContain('#9999');
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
    expect(markup).toContain('Deleted account');
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

/** A banner whose action can be busy, and is now or isn't. */
const showing = (busy: boolean) =>
  renderToStaticMarkup(
    <Banner
      tone="info"
      title="ravi-k pushed r5"
      action={{ label: 'Show r5', busy, working: 'Showing…', onClick: () => {} }}
    />,
  );

describe('Banner', () => {
  it('leads with what changed, then its one button and Dismiss', () => {
    const show = vi.fn<() => void>();
    const markup = renderToStaticMarkup(
      <Banner
        tone="info"
        title="ravi-k pushed r5"
        action={{ label: 'Show r5', onClick: show }}
        onDismiss={() => {}}
      />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('banner-info');
    expect(markup).toContain('<strong class="font-semibold">ravi-k pushed r5</strong>');
    expect(markup).toMatch(/<button type="button" class="[^"]*"[^>]*>Show r5<\/button>/);
    expect(markup).toContain('aria-label="Dismiss"');
  });

  it('offers the next of those that wait behind it, with how many there are', () => {
    const next = vi.fn<() => void>();
    const markup = renderToStaticMarkup(
      <BannerPlaceProvider value={{ more: { count: 2, next }, row: { current: null } }}>
        <Banner tone="info" title="ravi-k pushed r5" />
      </BannerPlaceProvider>,
    );
    expect(markup).toContain('aria-label="Next, 2 more"');
    expect(markup).toContain('+2');
    expect(renderToStaticMarkup(<Banner tone="info" title="a" />)).not.toContain('more');
  });

  it('holds room for an action’s wait while it rests, and says the wait while busy', () => {
    // Both faces are there at rest, so the button is as wide then as while it works.
    expect(showing(false)).toContain('Showing…');
    expect(showing(false)).not.toContain('aria-busy="true"');
    expect(showing(true)).toContain('aria-busy="true"');
  });

  it('is an alert when it’s about danger, and has no buttons when it offers nothing', () => {
    const markup = renderToStaticMarkup(<Banner tone="danger" title="Merge refused" />);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('<button');
  });
});

describe('StatusBar', () => {
  it('puts background work at the start, and where you are at the end', () => {
    const markup = renderToStaticMarkup(
      <StatusBar
        start={<StatusItem ball="ready">Local copy</StatusItem>}
        end={<span>NORMAL</span>}
      />,
    );
    expect(markup).toContain('aria-label="Status bar"');
    expect(markup.indexOf('Local copy')).toBeLessThan(markup.indexOf('NORMAL'));
    expect(markup).toContain('bg-success');
    // Text with nothing behind it has no tooltip.
    expect(markup).not.toContain('title=');
  });

  it('draws each state as its own ball: a ring off, a spinner at work, filled, amber and red', () => {
    expect(ball('off')).toContain('data-ball="off"');
    expect(ball('off')).toContain('hollow');
    expect(ball('working')).toContain('spinner');
    expect(ball('working')).not.toContain('data-ball');
    expect(ball('ready')).toContain('bg-success');
    expect(ball('warn')).toContain('bg-warning');
    expect(ball('failed')).toContain('bg-danger');
  });

  it('makes an item with details a button that opens them, and one that does something a button', () => {
    const detailed = renderToStaticMarkup(
      <StatusItem ball="ready" details={<p>At a1b2c3d</p>}>
        Local copy
      </StatusItem>,
    );
    expect(detailed).toMatch(/^<button type="button"[^>]*>.*Local copy<\/span><\/button>$/);
    expect(detailed).not.toContain('a1b2c3d');
    const markup = renderToStaticMarkup(
      <StatusItem onClick={() => {}}>2 pending comments</StatusItem>,
    );
    expect(markup).toMatch(/^<button type="button"[^>]*>.*2 pending comments<\/span><\/button>$/);
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
          connection={{ kind: 'signedOut', tone: 'danger', label: 'Signed out' }}
        />
        <BannerPlaceProvider value={{ more: { count: 1, next: () => {} }, row: { current: null } }}>
          <Banner
            tone="info"
            title="a"
            action={{ label: 'b', onClick: () => {} }}
            onDismiss={() => {}}
          />
        </BannerPlaceProvider>
        <Banner tone="danger" title="a" />
        <StatusBar start={<StatusItem ball="working">a</StatusItem>} />
        <StatusItem ball="warn" onClick={() => {}}>
          a
        </StatusItem>
        <StatusItem ball="failed" details={<p>a</p>}>
          a
        </StatusItem>
        <StatusItem ball="off">a</StatusItem>
        <StatusItem ball="ready">a</StatusItem>
        <StatePill state="draft" />
        <StatePill state="merged" />
        <StatePill state="closed" />
        <Spinner />
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

/** The header of a pull request in `state`, as markup. */
function headerOf(state: 'merged' | 'closed' | 'draft'): string {
  return renderToStaticMarkup(
    <PRHeader
      number={78}
      state={state}
      author="rozed-bot"
      head={{ branch: 'app/head' }}
      base={{ branch: 'app/base' }}
    />,
  );
}
