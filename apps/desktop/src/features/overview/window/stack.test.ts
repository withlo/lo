// The stack's overview in the window: which stack's overview a layer's view shows, the one its own
// overview names, else the lowest layer's that names one; its tree, with Lo's Layers after the
// tl;dr under an anchor of its own; what a layer's overview's tl;dr says on one line; and what each
// layer's row in Layers says under its title.

import { parseArtifact, type OverviewTree } from '@lo/artifact';
import { describe, expect, it } from 'vitest';

import type { Row, StackView } from '../../stacks/contract.ts';
import { layersBlockOf, namedBy, stackOf, tldrOf, withLayers, type LayerSaid } from './stack.ts';
import { summaryOf } from './StackParts.tsx';

/** A tree of an overview of pull request `pr`, naming stack `stack` if given, with `body`. */
function treeOf(body: string, pr = 83, stack?: number): OverviewTree {
  const named = stack === undefined ? '' : `stack: ${stack}\n`;
  return parseArtifact(
    `---\nformat: 1\npr: ${pr}\n${named}commit: ${'c'.repeat(40)}\n---\n\n${body}`,
  ).tree;
}

function row(number: number, overview: boolean | null): Row {
  return {
    number,
    title: `Layer ${number}`,
    author: 'rozed-bot',
    head: `stack/${number}`,
    state: 'open',
    current: number === 83,
    branch: false,
    on: null,
    path: [number],
    review: null,
    checks: null,
    queue: null,
    needsRebase: false,
    overview,
    viewed: null,
    threads: null,
  };
}

const STACK: StackView = {
  kind: 'stack',
  root: 'main',
  start: null,
  githubStack: false,
  rows: [row(82, true), row(83, true), row(84, false)],
  notes: [],
  offered: false,
  callout: null,
};

const said = (stack?: number): LayerSaid => ({ stack, tldr: undefined, line: undefined });

describe('which stack overview a layer shows', () => {
  it("is the one its own overview names, else the lowest layer's that names one", () => {
    const others = new Map([
      [82, said()],
      [84, said(9)],
    ]);
    expect(stackOf(STACK, 7, others)).toBe(7);
    expect(stackOf(STACK, null, others)).toBe(9);
    const both = new Map([
      [82, said(5)],
      [84, said(9)],
    ]);
    expect(stackOf(STACK, null, both)).toBe(5);
    expect(stackOf(STACK, null, new Map())).toBe(null);
  });

  it("waits for the layer's own overview, and is none outside a stack", () => {
    expect(stackOf(STACK, undefined, new Map([[82, said(5)]]))).toBe(undefined);
    expect(stackOf({ kind: 'none' }, 7, new Map())).toBe(null);
    expect(stackOf(undefined, 7, new Map())).toBe(null);
    // A layer's own overview names one once it's shown; one Lo can't show names none.
    expect(namedBy({ kind: 'reading' })).toBe(undefined);
    expect(namedBy({ kind: 'none', notCommit: false })).toBe(null);
  });
});

describe("a stack overview's tree", () => {
  it('has Layers after its tl;dr, the same each time, under an anchor of its own', () => {
    const tree = treeOf(
      '## tl;dr\n\nThe stack.\n\nMore of it.\n\n## Layers\n\nThe writer’s.\n\n## After\n\nEnd.\n',
      83,
      9,
    );
    const drawn = withLayers(tree);
    expect(withLayers(tree)).toBe(drawn);
    const headings = drawn.blocks.flatMap((block) =>
      block.kind === 'heading' ? [block.anchor] : [],
    );
    expect(headings).toEqual(['tldr', 'layers-1', 'layers', 'after']);
    const list = layersBlockOf(drawn);
    expect(list).toBeDefined();
    expect(drawn.blocks.indexOf(list!)).toBe(
      drawn.blocks.findIndex((block) => block.kind === 'heading' && block.anchor === 'layers-1') +
        1,
    );
    expect(layersBlockOf(tree)).toBeUndefined();
  });

  it('ends with Layers when the tl;dr is all it has', () => {
    const drawn = withLayers(treeOf('## tl;dr\n\nThe stack.\n'));
    expect(drawn.blocks.at(-1)).toBe(layersBlockOf(drawn));
  });
});

describe("a layer's tl;dr", () => {
  it('is its text on one line, up to the next section', () => {
    expect(
      tldrOf(
        treeOf(
          '## tl;dr\n\nIt **reads** `code`.\n\n- And lists.\n\n### Deeper\n\nStill.\n\n## Next\n\nNot this.\n',
        ).blocks,
      ),
    ).toBe('It reads code. And lists. Deeper Still.');
    expect(tldrOf(treeOf('## How\n\nNo tl;dr first.\n').blocks)).toBe(undefined);
  });
});

describe("a layer's row in Layers", () => {
  it('says its tl;dr, else its description, else that it has none, and waits for either', () => {
    expect(summaryOf(undefined)).toEqual({ kind: 'reading' });
    expect(summaryOf({ stack: 9, tldr: 'It reads.', line: undefined })).toEqual({
      kind: 'tldr',
      text: 'It reads.',
    });
    expect(summaryOf({ stack: undefined, tldr: undefined, line: undefined })).toEqual({
      kind: 'reading',
    });
    expect(summaryOf({ stack: undefined, tldr: undefined, line: 'Counts nodes.' })).toEqual({
      kind: 'description',
      text: 'Counts nodes.',
    });
    expect(summaryOf({ stack: undefined, tldr: undefined, line: null })).toEqual({ kind: 'none' });
  });
});
