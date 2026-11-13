// @vitest-environment jsdom
// The timeline's rows: the description card, comments and reviews as cards, pushes, force-pushes,
// checks, one-line events and the note about older items. Labels take their color from the style
// property, and only when it is six hex digits.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render } from '../test/dom.ts';
import { Label, labelColor } from './Label.tsx';
import {
  Timeline,
  TimelineChecks,
  TimelineComment,
  TimelineDescription,
  TimelineEvent,
  TimelineForcePush,
  TimelineName,
  TimelineOlder,
  TimelinePush,
  TimelineReview,
  TimelineRow,
} from './Timeline.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

function row(host: HTMLElement, at = 0): HTMLElement {
  const found = host.querySelectorAll<HTMLElement>('li.tl-row')[at];
  if (found === undefined) throw new Error(`No row ${at}.`);
  return found;
}

function button(within: Element, label: string): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find((each) =>
    each.textContent.startsWith(label),
  );
  if (found === undefined) throw new Error(`No button ${label}.`);
  return found;
}

describe('Label', () => {
  it('takes only six hex digits as its color', () => {
    expect(labelColor('4a8fdc')).toBe('#4a8fdc');
    expect(labelColor('#D9A03F')).toBe('#d9a03f');
    for (const bad of ['', 'fff', 'red', 'zzzzzz', '4a8fdc; x', 'url(https://example.com/a.png)']) {
      expect(labelColor(bad)).toBeUndefined();
    }
  });

  it("sets the dot's color through the style property, and builds no class from it", () => {
    const host = render(<Label color="4a8fdc">api</Label>);
    const dot = host.querySelector<HTMLElement>('span > span');
    expect(dot?.style.backgroundColor).toBe('rgb(74, 143, 220)');
    expect(
      [...host.querySelectorAll('[class]')].some((each) =>
        /4a8fdc/i.test(each.getAttribute('class') ?? ''),
      ),
    ).toBe(false);
    expect(host.textContent).toBe('api');
  });

  it('draws a color it does not take as no color at all, with the name still there', () => {
    const host = render(<Label color="url(https://example.com/a.png)">needs-load-test</Label>);
    const dot = host.querySelector<HTMLElement>('span > span');
    expect(dot?.getAttribute('style')).toBeNull();
    expect(dot?.className).toContain('bg-fg-muted');
    expect(host.textContent).toBe('needs-load-test');
  });
});

describe('Timeline', () => {
  it('is one list of rows, each with its marker on the rail', () => {
    const host = render(
      <Timeline>
        <TimelineEvent glyph="tag" when="3 days ago">
          <TimelineName>ravi-k</TimelineName> added <Label color="8b6fd6">needs-load-test</Label>
        </TimelineEvent>
        <TimelineRow marker={{ login: 'tess-okafor' }}>a box</TimelineRow>
      </Timeline>,
    );
    expect(host.querySelector('ol')?.getAttribute('aria-label')).toBe('Timeline');
    expect(host.querySelectorAll('li.tl-row')).toHaveLength(2);
    expect(row(host, 0).textContent).toBe('ravi-k added needs-load-test3 days ago');
    // A glyph's disc is decoration; a person's avatar is too, beside their login.
    expect(row(host, 0).querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(row(host, 1).textContent).toBe('TOa box');
  });

  it('draws the description as a card: who opened it, the text, labels in color and the reviewers', () => {
    const host = render(
      <Timeline>
        <TimelineDescription
          author="ravi-k"
          when="3 days ago"
          draft
          body={<p>GraphQL requests are now limited by what they cost.</p>}
          labels={[
            { name: 'api', color: '4a8fdc' },
            { name: 'rate-limiting', color: 'd9a03f' },
          ]}
          reviewers={[
            { login: 'tess-okafor', state: 'changes' },
            { login: 'jun-park', state: 'requested' },
            { login: 'mira-chen', state: 'approved' },
          ]}
        />
      </Timeline>,
    );
    const card = row(host);
    const head = card.querySelector('.border-b');
    expect(head?.textContent).toContain('ravi-k opened this 3 days ago');
    expect(head?.textContent).toContain('Author');
    expect(head?.textContent).toContain('Draft');
    expect(head?.textContent).toContain('Read-only in Lo');
    expect(card.textContent).toContain('GraphQL requests are now limited by what they cost.');
    const dots = [...card.querySelectorAll<HTMLElement>('[style]')].map(
      (each) => each.style.backgroundColor,
    );
    expect(dots).toEqual(['rgb(74, 143, 220)', 'rgb(217, 160, 63)']);
    // Each reviewer's login and where they stand, in words as well as a mark.
    const reviewers = [...card.querySelectorAll('ul li')].map((each) => each.getAttribute('title'));
    expect(reviewers).toEqual([
      'tess-okafor: Requested changes',
      'jun-park: Review requested',
      'mira-chen: Approved',
    ]);
  });

  it('says a pull request with no description has none, and no Draft tag unless it is one', () => {
    const host = render(
      <Timeline>
        <TimelineDescription author="ravi-k" when="now" />
      </Timeline>,
    );
    expect(host.textContent).toContain('No description.');
    expect(host.textContent).not.toContain('Draft');
    expect(host.textContent).not.toContain('Reviewers');
  });

  it('draws a comment as a card, and holds a hidden one back until it is shown', () => {
    const onShow = vi.fn<() => void>();
    const body = <p data-testid="body">The 429s flatten out once the ceiling kicks in.</p>;
    const open = render(
      <Timeline>
        <TimelineComment author="jun-park" when="2 days ago" byAuthor body={body} />
      </Timeline>,
    );
    expect(row(open).textContent).toContain('jun-park commented');
    expect(row(open).textContent).toContain('Author');
    expect(open.querySelector('[data-testid="body"]')).not.toBeNull();

    const hidden = render(
      <Timeline>
        <TimelineComment
          author="jun-park"
          when="2 days ago"
          body={body}
          hidden={{ reason: 'outdated', onShow }}
        />
      </Timeline>,
    );
    // Its text isn't drawn, so nothing in it loads.
    expect(hidden.querySelector('[data-testid="body"]')).toBeNull();
    expect(row(hidden).textContent).toContain('Hidden as outdated');
    click(button(row(hidden), 'Show comment'));
    expect(onShow).toHaveBeenCalledOnce();
  });

  it('draws a review as a card: what was said on which revision, the comments and the way to the diff', () => {
    const onShowInDiff = vi.fn<() => void>();
    const host = render(
      <Timeline>
        <TimelineReview
          author="tess-okafor"
          when="2 days ago"
          verdict="changes"
          revision="r2"
          body={<p>Close. Two things before I'm happy.</p>}
          comments={{ count: 2, on: 'rate-limit.ts' }}
          onShowInDiff={onShowInDiff}
        />
        <TimelineReview author="jun-park" when="1 day ago" verdict="approved" />
        <TimelineReview
          author="mira-chen"
          when="1 day ago"
          verdict="dismissed"
          comments={{ count: 0 }}
        />
      </Timeline>,
    );
    const [changes, approved, dismissed] = [row(host, 0), row(host, 1), row(host, 2)];
    expect(changes.textContent).toContain('tess-okafor requested changes on r2');
    expect(changes.textContent).toContain('Close. Two things before I');
    expect(changes.textContent).toContain('2 comments on rate-limit.ts');
    click(button(changes, 'Show in the diff'));
    expect(onShowInDiff).toHaveBeenCalledOnce();
    expect(approved.textContent).toContain('jun-park approved these changes');
    // No comments, no footer.
    expect(approved.textContent).not.toContain('Show in the diff');
    expect(dismissed.textContent).toContain('Dismissed');
    expect(dismissed.textContent).not.toContain('Show in the diff');
  });

  it('draws consecutive commits as one push with their revision, and a lone one in the singular', () => {
    const host = render(
      <Timeline>
        <TimelinePush
          actor="ravi-k"
          when="2 days ago"
          revision="r2"
          commits={[
            { oid: '3e0b7c1aaaaaaaa', headline: 'Weight list fields by their page size' },
            { oid: 'b2f19d4bbbbbbbb', headline: 'Refuse queries over the plan ceiling' },
            { oid: '9c1d2aacccccccc', headline: 'Skip introspection' },
          ]}
        />
        <TimelinePush
          actor="ravi-k"
          when="40 min ago"
          commits={[{ oid: 'a91c4e2dddddddd', headline: 'Rebase' }]}
        />
      </Timeline>,
    );
    expect(row(host, 0).textContent).toContain('ravi-k pushed 3 commits');
    expect(row(host, 0).textContent).toContain('r2');
    const commits = [...row(host, 0).querySelectorAll('ul li')].map((each) => each.textContent);
    expect(commits).toEqual([
      '3e0b7c1Weight list fields by their page size',
      'b2f19d4Refuse queries over the plan ceiling',
      '9c1d2aaSkip introspection',
    ]);
    expect(row(host, 1).textContent).toContain('pushed 1 commit');
    expect(row(host, 1).textContent).not.toContain('pushed 1 commits');
  });

  it('draws a force-push apart, with the commits it moved between and a button to compare', () => {
    const onCompare = vi.fn<() => void>();
    const host = render(
      <Timeline>
        <TimelineForcePush
          actor="ravi-k"
          when="1 day ago"
          before="9c1d2aaffffffff"
          after="a91c4e2eeeeeeee"
          revision="r3"
          compare={{ from: 'r2', to: 'r3', onCompare }}
        />
        <TimelineForcePush actor="ravi-k" when="1 day ago" branch="base" />
      </Timeline>,
    );
    expect(row(host, 0).textContent).toContain('ravi-k force-pushed 9c1d2aa→a91c4e2');
    expect(row(host, 0).textContent).toContain('r3');
    click(button(row(host, 0), 'Compare r2 → r3'));
    expect(onCompare).toHaveBeenCalledOnce();
    expect(row(host, 1).textContent).toContain('force-pushed the base branch');
    expect(row(host, 1).textContent).not.toContain('Compare');
  });

  it("says a commit's checks by their state and revision", () => {
    const host = render(
      <Timeline>
        <TimelineChecks state="failed" revision="r2" when="2 days ago" />
        <TimelineChecks state="running" revision="r5" when="now" />
        <TimelineChecks state="passed" />
      </Timeline>,
    );
    expect([0, 1, 2].map((at) => row(host, at).textContent)).toEqual([
      'Checks failed on r22 days ago',
      'Checks running on r5now',
      'Checks passed',
    ]);
  });

  it('says how many older items are left out, in the singular too', () => {
    const onSee = vi.fn<() => void>();
    const host = render(
      <Timeline>
        <TimelineOlder count={120} onSee={onSee} />
        <TimelineOlder count={1} />
      </Timeline>,
    );
    const [many, one] = [...host.querySelectorAll('li')];
    expect(many?.textContent).toBe("120 older items aren't shown.See them on GitHub.");
    expect(one?.textContent).toBe("1 older item isn't shown.See it on GitHub.");
    click(button(many!, 'See them'));
    expect(onSee).toHaveBeenCalledOnce();
  });

  it('rings the row the keyboard is on and passes on what finds it', () => {
    const host = render(
      <Timeline>
        <TimelineEvent glyph="queue" focused data-key="queue-1">
          queued
        </TimelineEvent>
        <TimelineEvent glyph="queue">other</TimelineEvent>
      </Timeline>,
    );
    expect(row(host, 0).dataset['key']).toBe('queue-1');
    expect(row(host, 0).className).toContain('shadow-ring-inset');
    expect(row(host, 1).className).not.toContain('shadow-ring-inset');
  });

  it("only uses utilities that Lo's stylesheet has, and runs the rail marker to marker", async () => {
    const host = render(
      <Timeline>
        <TimelineDescription
          author="ravi-k"
          when="3 days ago"
          draft
          labels={[{ name: 'api', color: '4a8fdc' }]}
          reviewers={[{ login: 'jun-park', state: 'approved' }]}
        />
        <TimelineComment author="jun-park" when="now" byAuthor body="text" hidden={{}} />
        <TimelineReview
          author="tess-okafor"
          when="now"
          verdict="dismissed"
          body="x"
          comments={{ count: 1 }}
        />
        <TimelinePush actor="a" when="now" commits={[{ oid: 'abcdef0', headline: 'h' }]} />
        <TimelineForcePush actor="a" when="now" compare={{ from: 'r1', to: 'r2' }} />
        <TimelineChecks state="passed" />
        <TimelineEvent glyph="merged" tone="merged" when="now" focused>
          merged
        </TimelineEvent>
        <TimelineOlder count={3} />
      </Timeline>,
    );
    expect(await missingRules(host)).toEqual([]);
    const css = await buildCss(['tl-row']);
    expect(css).toMatch(/&:first-child::before\s*\{\s*top: calc\(/);
    expect(css).toMatch(/&:last-child::before\s*\{\s*bottom: calc\(/);
  });
});
