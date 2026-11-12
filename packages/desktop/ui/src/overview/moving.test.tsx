// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  parseArtifact,
  type OverviewTree,
  type Walkthrough as WalkthroughNode,
} from '@lo/artifact';

import { cleanUp, focus, render } from '../../test/dom.ts';
import { MarkdownProvider, Anchors, type Rendering } from '../markdown/index.ts';
import {
  blockNumber,
  blockOf,
  blockStops,
  focusTargetOf,
  hasSteps,
  linksIn,
  OverviewDocument,
  stepIn,
  Walkthrough,
} from './index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const here = import.meta.url;
const ARTIFACTS = new URL('../../../../../testing/fixtures/artifacts/', here);

function example(): OverviewTree {
  return parseArtifact(readFileSync(new URL('valid/example/artifact.md', ARTIFACTS))).tree;
}

const article = (page: HTMLElement) => page.querySelector<HTMLElement>('.lo-ov__article')!;

/** What each of an element's links says, or its own text. */
const named = (element: Element) =>
  element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';

describe('the blocks the block keys stop at', () => {
  it('are the article’s numbered blocks, in order, each known from anything inside it', () => {
    const tree = example();
    const page = render(<OverviewDocument tree={tree} />);
    const stops = blockStops(article(page));
    expect(stops.map((stop) => tree.blocks[blockNumber(stop)!]?.kind)).toEqual([
      'paragraph',
      'excerpt',
      'figure',
      'walkthrough',
      'tabs',
      'details',
      'paragraph',
    ]);
    const link = stops[0]!.querySelector('.lo-term')!;
    expect(blockOf(article(page), link)).toBe(stops[0]);
    expect(blockOf(article(page), stops[1]!)).toBe(stops[1]);
    // A heading isn't in one.
    expect(blockOf(article(page), page.querySelector('h2'))).toBeUndefined();
    expect(blockOf(article(page), null)).toBeUndefined();
  });

  it('take focus on themselves, or for a fold on its title', () => {
    const page = render(<OverviewDocument tree={example()} />);
    const stops = blockStops(article(page));
    const fold = stops.find((stop) => stop.localName === 'details')!;
    expect(focusTargetOf(fold).localName).toBe('summary');
    expect(focusTargetOf(stops[1]!)).toBe(stops[1]);
  });

  it('hold the links and controls Tab goes between, as shown now', () => {
    const page = render(<OverviewDocument tree={example()} />);
    const stops = blockStops(article(page));
    const last = stops.at(-1)!;
    expect(linksIn(last).map(named)).toEqual(['limiter.test.ts', 'the rest']);
    expect(linksIn(stops[0]!).map(named)).toEqual(['bucket']);

    // A closed fold's body is hidden; its own title is the block's focus, not a link in it.
    const fold = stops.find((stop) => stop.localName === 'details')!;
    expect(linksIn(fold)).toEqual([]);

    // Only the tab chosen takes focus, and a panel not shown hides what's in it.
    const tabs = stops.find((stop) => stop.querySelector('.lo-tabs'))!;
    expect(linksIn(tabs).map(named)).toEqual(['Before']);
  });
});

describe('stepping a block', () => {
  it('switches tabs round the end, focus staying on the block unless it was on a tab', () => {
    const page = render(<OverviewDocument tree={example()} />);
    const tabs = blockStops(article(page)).find((stop) => stop.querySelector('.lo-tabs'))!;
    const chosen = () =>
      [...tabs.querySelectorAll('[role="tab"]')].findIndex(
        (tab) => tab.getAttribute('aria-selected') === 'true',
      );
    expect(hasSteps(tabs)).toBe(true);
    focus(tabs);
    act(() => expect(stepIn(tabs, 1)).toBe(true));
    expect(chosen()).toBe(1);
    expect(document.activeElement).toBe(tabs);
    act(() => expect(stepIn(tabs, 1)).toBe(true));
    expect(chosen()).toBe(0);
    act(() => expect(stepIn(tabs, -1)).toBe(true));
    expect(chosen()).toBe(1);

    const buttons = [...tabs.querySelectorAll<HTMLElement>('[role="tab"]')];
    focus(buttons[1]!);
    act(() => expect(stepIn(tabs, -1)).toBe(true));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('steps a walkthrough, stopping at its first and last steps', () => {
    const tree = example();
    const node = tree.blocks.find(
      (block): block is WalkthroughNode => block.kind === 'walkthrough',
    )!;
    const rendering: Rendering = {
      anchors: new Anchors('t', []),
      follow: () => undefined,
      extension: {},
      interactive: true,
    };
    function Stepped() {
      const [current, setCurrent] = useState(0);
      return (
        <MarkdownProvider rendering={rendering}>
          <Walkthrough node={node} current={current} step={setCurrent} code={null} />
        </MarkdownProvider>
      );
    }
    const page = render(<Stepped />);
    const walk = page.querySelector<HTMLElement>('.lo-walk')!;
    const current = () =>
      [...walk.querySelectorAll('.lo-walk__step')].findIndex(
        (step) => step.getAttribute('aria-current') === 'step',
      );
    expect(hasSteps(page)).toBe(true);
    act(() => expect(stepIn(page, -1)).toBe(false));
    expect(current()).toBe(0);
    act(() => expect(stepIn(page, 1)).toBe(true));
    act(() => expect(stepIn(page, 1)).toBe(true));
    expect(current()).toBe(2);
    act(() => expect(stepIn(page, 1)).toBe(false));
    expect(current()).toBe(2);
    act(() => expect(stepIn(walk, -1)).toBe(true));
    expect(current()).toBe(1);
  });

  it('does nothing in a block with neither', () => {
    const page = render(<OverviewDocument tree={example()} />);
    const code = blockStops(article(page))[1]!;
    expect(hasSteps(code)).toBe(false);
    expect(stepIn(code, 1)).toBe(false);
  });
});
