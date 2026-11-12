// @vitest-environment jsdom
// Moving through a drawn overview by its blocks, and what following one does, without a layout:
// from the block that has focus, which is all the keys go by when one has.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { parseArtifact, type OverviewTree } from '@lo/artifact';
import { generationOf } from '@lo/ui/markdown';
import { OverviewDocument, blockNumber, blockStops } from '@lo/ui/overview';

import { blockId } from './blocks.ts';
import {
  besideFor,
  blockAt,
  followOf,
  focusedBlock,
  looseControl,
  nextBlock,
  nextLink,
  targetOf,
  type DrawnOverview,
} from './follow.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** An overview with a block of each kind the keys stop at. */
const EXAMPLE = [
  `---\nformat: 1\npr: 4797\ncommit: ${'a'.repeat(40)}\n---\n`,
  '## tl;dr\n',
  'Requests over a quota now wait for a token instead of failing.\n',
  '## How it works\n',
  "The limiter takes a token from the tenant's [bucket](term:bucket) before it forwards a request:\n",
  ':::code src/limiter.ts#L46-L61',
  ':::\n',
  ':::walkthrough One request, start to finish',
  ':::step src/limiter.ts#L16-L24',
  "The limiter finds the tenant's bucket.",
  ':::',
  ':::step src/limiter.ts#L47-L60',
  'With no token free, the request waits.',
  ':::',
  ':::\n',
  '## Where to look\n',
  ':::tabs',
  ':::tab Before',
  'A burst over the quota failed at once.',
  ':::',
  ':::tab After',
  'A burst over the quota waits.',
  ':::',
  ':::\n',
  ':::fold Why not a queue per request',
  'A queue per request would keep a timer for each one.',
  ':::\n',
  'The new test in [limiter.test.ts](code:src/limiter.test.ts) passes, as does [the rest](#how-it-works).\n',
  '## Glossary\n',
  '- **Bucket**: the tokens a tenant has to spend.',
  '',
].join('\n');

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

/** The example overview, drawn, as the keys find it. */
function drawn(): { overview: DrawnOverview; stops: HTMLElement[]; tree: OverviewTree } {
  const { tree } = parseArtifact(EXAMPLE);
  const page = document.createElement('div');
  page.className = 'lo-app';
  document.body.append(page);
  host = page;
  const made = createRoot(page);
  root = made;
  act(() => made.render(<OverviewDocument tree={tree} />));
  const scroller = page.querySelector<HTMLElement>('.lo-ov')!;
  const overview: DrawnOverview = {
    tab: 'tab',
    tree,
    generation: generationOf(tree),
    root: page,
    scroller: () => scroller,
  };
  const stops = blockStops(page.querySelector('.lo-ov__article')!);
  return { overview, stops, tree };
}

const kindOf = (tree: OverviewTree, block: HTMLElement | string) =>
  typeof block === 'string' ? block : tree.blocks[blockNumber(block)!]?.kind;

describe('the block keys', () => {
  it('go from the block with focus to the next and previous, and say so at the ends', () => {
    const { overview, stops, tree } = drawn();
    stops[0]!.focus();
    expect(focusedBlock(overview)).toBe(stops[0]);
    expect(kindOf(tree, nextBlock(overview, 1))).toBe('excerpt');
    expect(nextBlock(overview, -1)).toBe('This is the first block.');
    stops.at(-1)!.focus();
    expect(nextBlock(overview, 1)).toBe('This is the last block.');
    expect(kindOf(tree, nextBlock(overview, -1))).toBe('details');
  });

  it('name a block by the tree it’s in, so one from another tree finds none', () => {
    const { overview, stops } = drawn();
    const target = targetOf(overview, stops[2]!);
    expect(target).toEqual({
      kind: 'block',
      block: blockId(overview.generation, blockNumber(stops[2]!)!),
    });
    expect(blockAt(overview, target!)).toBe(stops[2]);
    const older = { ...overview, generation: overview.generation + 1 };
    expect(blockAt(older, target!)).toBeUndefined();
  });
});

describe('a control outside the blocks', () => {
  it('is one with focus, such as a section in the outline, and none in a block', () => {
    const { overview, stops } = drawn();
    const section = overview.root.querySelector<HTMLElement>('.lo-toc__item')!;
    section.focus();
    expect(looseControl(overview)).toBe(section);
    stops.at(-1)!.querySelector<HTMLElement>('[role="link"]')!.focus();
    expect(looseControl(overview)).toBeUndefined();
    stops[0]!.focus();
    expect(looseControl(overview)).toBeUndefined();
  });

  it('is the view’s own with no overview drawn, such as its Retry now', () => {
    const view = document.createElement('div');
    view.dataset.loScope = 'overview';
    const retry = document.createElement('button');
    retry.textContent = 'Retry now';
    view.append(retry);
    const elsewhere = document.createElement('button');
    document.body.append(view, elsewhere);
    try {
      retry.focus();
      expect(looseControl(undefined)).toBe(retry);
      elsewhere.focus();
      expect(looseControl(undefined)).toBeUndefined();
    } finally {
      view.remove();
      elsewhere.remove();
    }
  });
});

describe('Tab', () => {
  it('goes through a block’s links, then on to the next block, as they’re written', () => {
    const { overview, stops, tree } = drawn();
    const last = stops.at(-1)!;
    last.focus();
    const first = nextLink(overview, 1);
    if (typeof first === 'string') throw new Error(first);
    expect(first.textContent).toBe('limiter.test.ts');
    first.focus();
    const second = nextLink(overview, 1);
    if (typeof second === 'string') throw new Error(second);
    expect(second.textContent).toBe('the rest');
    second.focus();
    expect(nextLink(overview, 1)).toBe('There’s nothing after this in the overview.');
    expect(nextLink(overview, -1)).toBe(first);
    // A block with nothing in it to go to: on to the next.
    const code = stops.find((stop) => kindOf(tree, stop) === 'excerpt')!;
    code.focus();
    expect(nextLink(overview, 1)).toBe(stops[stops.indexOf(code) + 1]);
  });

  it('goes back from the first block through the outline, and on from it to the first block', () => {
    const { overview, stops } = drawn();
    const sections = [...overview.root.querySelectorAll<HTMLElement>('.lo-toc__item')];
    expect(sections.length).toBeGreaterThan(1);
    stops[0]!.focus();
    expect(nextLink(overview, -1)).toBe(sections.at(-1));
    sections[1]!.focus();
    expect(nextLink(overview, -1)).toBe(sections[0]);
    sections[0]!.focus();
    expect(nextLink(overview, -1)).toBe('There’s nothing before this in the overview.');
    sections.at(-1)!.focus();
    expect(nextLink(overview, 1)).toBe(stops[0]);
  });
});

describe('following a block', () => {
  it('goes to a code block’s code, or the first code prose links to', () => {
    const { overview, stops, tree } = drawn();
    const code = stops.find((stop) => kindOf(tree, stop) === 'excerpt')!;
    expect(followOf(overview, code)).toEqual({
      kind: 'code',
      block: code,
      code: { path: 'src/limiter.ts', lines: { start: 46, end: 61 } },
    });
    const last = stops.at(-1)!;
    expect(followOf(overview, last)).toMatchObject({
      kind: 'code',
      code: { path: 'src/limiter.test.ts' },
    });
  });

  it('follows the link in it that has focus, and opens or closes a fold', () => {
    const { overview, stops, tree } = drawn();
    const last = stops.at(-1)!;
    const link = nextLink(overview, 1);
    last.focus();
    const rest = [...last.querySelectorAll<HTMLElement>('[role="link"]')].at(-1)!;
    rest.focus();
    expect(link).not.toBe(rest);
    expect(followOf(overview, last)).toEqual({ kind: 'activate', element: rest });
    const fold = stops.find((stop) => kindOf(tree, stop) === 'details')!;
    expect(followOf(overview, fold)).toEqual({
      kind: 'activate',
      element: fold.querySelector('summary'),
    });
  });

  it('says so for tabs, which point at no code and have nothing to follow', () => {
    const { overview, stops, tree } = drawn();
    const tabs = stops.find((stop) => kindOf(tree, stop) === 'tabs')!;
    expect(followOf(overview, tabs)).toBe('This block has nothing to follow.');
    expect(besideFor(overview, tabs)).toBe('This block shows no code.');
    const code = stops.find((stop) => kindOf(tree, stop) === 'excerpt')!;
    expect(besideFor(overview, code)).toBe(blockNumber(code));
  });
});
