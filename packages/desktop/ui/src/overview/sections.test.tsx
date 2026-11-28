// @vitest-environment jsdom
// An overview's sections: what they are, and the article drawn with them folding, each heading but
// the tl;dr's with its chevron, a collapsed one standing for its section among the block stops,
// and anything that goes into a collapsed one expanding it first, at once.

import { readFileSync } from 'node:fs';

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseArtifact, type OverviewTree } from '@lo/artifact';

import { sections as sectionCommands, testCommands, type Ran } from '../../test/commands.ts';
import { cleanUp, click, render } from '../../test/dom.ts';
import { holdRegistry } from '../commands/control.ts';
import { Registry } from '../commands/registry.ts';
import {
  articleBlocks,
  blockNumber,
  blockOf,
  blockStops,
  focusTargetOf,
  OverviewDocument,
  sectionAt,
  sectionsOf,
  type OverviewFolds,
} from './index.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let release: (() => void) | undefined;
afterEach(() => {
  cleanUp();
  release?.();
  release = undefined;
});

// Through a name, so the bundler doesn't take the fixtures for an asset of the page.
const here = import.meta.url;
const ARTIFACTS = new URL('../../../../../testing/fixtures/artifacts/', here);

function example(): OverviewTree {
  return parseArtifact(readFileSync(new URL('valid/example/artifact.md', ARTIFACTS))).tree;
}

const article = (page: HTMLElement) => page.querySelector<HTMLElement>('.lo-ov__article')!;

/** The block number of the heading whose words are `name`. */
function headingOf(tree: OverviewTree, name: string): number {
  const found = sectionsOf(tree.blocks).find((section) => section.name === name);
  if (!found) throw new Error(`No section called ${name}.`);
  return found.heading;
}

/** The article, folding as a reader's state would, with what's expanded at once told to `expanded`. */
function Folding({
  tree,
  shut,
  expanded,
}: {
  tree: OverviewTree;
  shut: readonly number[];
  expanded: (headings: readonly number[]) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set(shut));
  const [opened, setOpened] = useState<ReadonlyMap<number, number>>(() => new Map());
  const folds: OverviewFolds = {
    collapsed,
    fold: (heading) => ({
      command: 'sections.fold',
      target: { kind: 'block', block: `1.${heading}` },
    }),
    expand: (headings) => {
      expanded(headings);
      setCollapsed((was) => new Set([...was].filter((heading) => !headings.includes(heading))));
      setOpened((was) => {
        const next = new Map(was);
        for (const heading of headings) next.set(heading, (next.get(heading) ?? 0) + 1);
        return next;
      });
    },
    opened,
  };
  return <OverviewDocument tree={tree} folds={folds} />;
}

function drawn(shut: (tree: OverviewTree) => readonly number[] = () => [], tree = example()) {
  release = holdRegistry(
    new Registry({ system: 'mac', commands: testCommands([], [sectionCommands]) }),
  );
  const expanded = vi.fn<(headings: readonly number[]) => void>();
  const page = render(<Folding tree={tree} shut={shut(tree)} expanded={expanded} />);
  return { tree, page, expanded };
}

describe('an overview’s sections', () => {
  it('are its own second-level headings, each with the blocks up to the next, all but the tl;dr folding', () => {
    const tree = example();
    const sections = sectionsOf(tree.blocks);
    expect(sections.map(({ name, folds }) => [name, folds])).toEqual([
      ['tl;dr', false],
      ['How it works', true],
      ['Where to look', true],
      ['How it was checked', true],
      ['Glossary', true],
    ]);
    for (const [at, section] of sections.entries()) {
      expect(section.from).toBe(section.heading + 1);
      expect(section.to).toBe(sections[at + 1]?.heading ?? tree.blocks.length);
      expect(sectionAt(sections, section.heading)).toBe(section);
      expect(sectionAt(sections, section.to - 1)).toBe(section);
    }
    // The same list for the same blocks.
    expect(sectionsOf(tree.blocks)).toBe(sections);
  });

  it('leave out the footnotes at the end, which stay drawn while the last section is collapsed', () => {
    const tree = parseArtifact(
      [
        `---\nformat: 1\npr: 4797\ncommit: ${'a'.repeat(40)}\n---\n`,
        '## tl;dr\n\nIt waits.[^1]\n',
        '## Testing\n\nIt was run.[^2]\n',
        '[^1]: As a queue does.\n',
        '[^2]: Twice.\n',
      ].join('\n'),
    ).tree;
    const footnotes = tree.blocks.length - 1;
    expect(tree.blocks[footnotes]?.kind).toBe('footnotes');
    const sections = sectionsOf(tree.blocks);
    expect(sections.at(-1)?.to).toBe(footnotes);
    expect(sectionAt(sections, footnotes)).toBeUndefined();
    const { page } = drawn((made) => [headingOf(made, 'Testing')], tree);
    expect(page.textContent).not.toContain('It was run.');
    expect(page.textContent).toContain('Twice.');
    expect(article(page).lastElementChild?.matches('.lo-section')).toBe(false);
  });
});

describe('the article, with its sections folding', () => {
  it('draws a chevron and a menu on each heading but the tl;dr’s, and the same blocks as without', () => {
    const { page, tree } = drawn();
    const heads = [...page.querySelectorAll('.lo-section-head')];
    expect(heads.map((head) => head.querySelector('h2')?.textContent)).toEqual([
      'tl;dr',
      'How it works',
      'Where to look',
      'How it was checked',
      'Glossary',
    ]);
    expect(heads.map((head) => head.querySelectorAll('button').length)).toEqual([0, 2, 2, 2, 2]);
    expect(heads[1]?.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    // The tl;dr's paragraph is drawn, and every block stop is where it was, in order.
    expect(article(page).textContent).toContain('Requests over a quota now wait');
    const plain = render(<OverviewDocument tree={tree} />);
    const numbers = (root: HTMLElement) => blockStops(article(root)).map(blockNumber);
    expect(numbers(page)).toEqual(numbers(plain));
    // Each block is known from inside it, in a section's body as in the article itself.
    const stop = blockStops(article(page)).find((block) => block.localName === 'details')!;
    expect(blockOf(article(page), stop.querySelector('summary'))).toBe(stop);
    expect(articleBlocks(article(page)).some((block) => block.matches('.lo-section'))).toBe(false);
  });

  it('keeps a collapsed section’s heading, a block the keys stop at, and draws nothing under it', () => {
    const { page, tree } = drawn((made) => [headingOf(made, 'Where to look')]);
    const heading = headingOf(tree, 'Where to look');
    const head = page.querySelector<HTMLElement>(`[data-lo-section="${heading}"]`)!;
    expect(head.hasAttribute('data-collapsed')).toBe(true);
    expect(page.textContent).not.toContain('A burst over the quota failed at once.');
    const stops = blockStops(article(page));
    expect(stops).toContain(head);
    expect(blockNumber(head)).toBe(heading);
    // Focus goes to its heading, which keeps it as the section opens.
    expect(focusTargetOf(head).localName).toBe('h2');
    // The blocks under it aren't stops, and the next stop after it is the next section's.
    const after = stops[stops.indexOf(head) + 1]!;
    expect(blockNumber(after)).toBeGreaterThan(sectionsOf(tree.blocks)[2]!.to - 1);
    // Its outline row is marked.
    const rows = [...page.querySelectorAll('.lo-toc__item')];
    expect(
      rows.filter((row) => row.hasAttribute('data-collapsed')).map((row) => row.textContent),
    ).toEqual(['Where to look']);
  });

  it('expands a collapsed section at once as its outline row goes to it', () => {
    const { page, tree, expanded } = drawn((made) => [headingOf(made, 'Where to look')]);
    const row = [...page.querySelectorAll<HTMLElement>('.lo-toc__item')].find(
      (each) => each.textContent === 'Where to look',
    )!;
    click(row);
    expect(expanded).toHaveBeenCalledWith([headingOf(tree, 'Where to look')]);
    // In the same frame: drawn by the time the click is done, open from the start.
    expect(page.textContent).toContain('A burst over the quota failed at once.');
    expect(page.querySelector('.lo-section[data-appear]')).toBeNull();
  });

  it('expands a collapsed section at once as a link goes into it, and only then', () => {
    const { page, tree, expanded } = drawn((made) => [headingOf(made, 'How it works')]);
    const link = [...page.querySelectorAll<HTMLElement>('a, [role="link"]')].find(
      (each) => each.textContent === 'the rest',
    )!;
    act(() => link.click());
    expect(expanded).toHaveBeenCalledWith([headingOf(tree, 'How it works')]);
    expect(page.querySelector('.lo-walk')).not.toBeNull();
    // An open section has nothing to expand.
    click(link);
    expect(expanded).toHaveBeenCalledOnce();
  });

  it('runs the section’s fold from its chevron, and from a collapsed heading’s words', () => {
    const ran: Ran[] = [];
    release = holdRegistry(
      new Registry({ system: 'mac', commands: testCommands(ran, [sectionCommands]) }),
    );
    const tree = example();
    const heading = headingOf(tree, 'Glossary');
    const page = render(<Folding tree={tree} shut={[heading]} expanded={() => undefined} />);
    const head = page.querySelector<HTMLElement>(`[data-lo-section="${heading}"]`)!;
    click(head.querySelector('h2')!);
    const open = page.querySelector<HTMLElement>(
      `[data-lo-section="${headingOf(tree, 'How it works')}"]`,
    )!;
    click(open.querySelector('button')!);
    expect(ran).toEqual([
      ['sections.fold', { kind: 'block', block: `1.${heading}` }],
      ['sections.fold', { kind: 'block', block: `1.${headingOf(tree, 'How it works')}` }],
    ]);
  });
});
