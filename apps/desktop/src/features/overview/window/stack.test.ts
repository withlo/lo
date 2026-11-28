// @vitest-environment jsdom
// The stack's overview in the window: which stack's overview a layer's view shows, the one its own
// overview names, if it's the repository's own, else the lowest layer's that names one; what's read
// of the layers' overviews and descriptions, in requests of at most 100 layers, again on a timer and
// as anything changes when none could be read; its tree, with Lo's Layers after the tl;dr under an
// anchor of its own; what a layer's overview's tl;dr says on one line; and what each layer's row in
// Layers says under its title.

import { parseArtifact, type OverviewTree } from '@lo/artifact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { Row, StackView } from '../../stacks/contract.ts';
import type { LayerOverview, OverviewCommit, OverviewSource, OverviewState } from '../contract.ts';
import type { CheckedOverview } from './checking.ts';
import type * as Main from './main.ts';
import { standingOf, type Standing } from './facts.ts';
import {
  layersBlockOf,
  layersSaid,
  namedBy,
  readLayers,
  readLayersAgain,
  readLines,
  stackOf,
  tldrOf,
  withLayers,
  type LayerSaid,
} from './stack.ts';
import { summaryOf } from './StackParts.tsx';

// Layers' overviews are parsed here, not in the background process.
vi.mock('./main.ts', async (original) => ({
  ...(await original<typeof Main>()),
  overviewJobs: () => ({
    parse: async ({ artifact }: { artifact: Uint8Array }) => ({
      parsed: parseArtifact(new TextDecoder().decode(artifact)),
    }),
  }),
}));

/** What main answers for each layer's overview, and for each description's first line. */
const answers = vi.hoisted(() => ({
  overviews: (_layers: readonly number[]): LayerOverview[] => [],
  lines: (layers: readonly number[]): (string | null)[] => layers.map(() => null),
}));
/** The layers a request asks for. */
function layersIn(input: unknown): number[] {
  if (typeof input !== 'object' || input === null || !('layers' in input)) return [];
  const { layers } = input;
  return Array.isArray(layers) ? layers.filter((each) => typeof each === 'number') : [];
}

const bridge = installBridge({
  'overview.layerOverviews': (input) => answers.overviews(layersIn(input)),
  'overview.layerLines': (input) => answers.lines(layersIn(input)),
});

/** How many layers each request on `channel` asked for, in order. */
const asked = (channel: string) =>
  bridge.calls
    .filter(([name]) => name === `overview.${channel}`)
    .map(([, input]) => layersIn(input).length);

/** Lets the window hear main's answers, and parse what they hold. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const COMMIT = 'c'.repeat(40);

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

/** A stack of `rows`. */
const stackOfRows = (rows: Row[]): StackView => ({ ...STACK, rows });

/**
 * Layer `number`'s overview, read, naming stack `stack` if given, its tl;dr `tldr`: the `push`th
 * pushed to its ref.
 */
function overviewOf(
  number: number,
  stack: number | undefined,
  tldr: string,
  push = 1,
): LayerOverview {
  const named = stack === undefined ? '' : `stack: ${stack}\n`;
  return {
    kind: 'read',
    commit: `${push}`.padStart(20, '0') + String(number).padStart(20, '0'),
    artifact: new TextEncoder().encode(
      `---\nformat: 1\npr: ${number}\n${named}commit: ${COMMIT}\n---\n\n## tl;dr\n\n${tldr}\n`,
    ),
  };
}

describe("what's read of the layers", () => {
  beforeEach(() => {
    bridge.calls.length = 0;
  });

  it("is read again on the timer, and a layer that can't be read now keeps what it said", async () => {
    const view = stackOfRows([row(82, true), row(83, true)]);
    answers.overviews = (layers) =>
      layers.map((number) => overviewOf(number, 9, `Layer ${number}.`));
    readLayers('timer', view);
    await settled();
    expect(layersSaid.get('timer').get(82)).toMatchObject({ stack: 9, tldr: 'Layer 82.' });
    // The same stack isn't read again as something else changes.
    readLayers('timer', view);
    await settled();
    expect(asked('layerOverviews')).toEqual([2]);
    // On the timer it is: #83's pushed again, and #82's can't be read now.
    answers.overviews = (layers) =>
      layers.map((number) =>
        number === 82 ? { kind: 'unread' } : overviewOf(number, 5, 'Pushed again.', 2),
      );
    readLayersAgain('timer', view);
    await settled();
    expect(asked('layerOverviews')).toEqual([2, 2]);
    expect(layersSaid.get('timer').get(82)).toMatchObject({ stack: 9, tldr: 'Layer 82.' });
    expect(layersSaid.get('timer').get(83)).toMatchObject({ stack: 5, tldr: 'Pushed again.' });
  });

  it('is read again as anything changes while none of them could be read, and no more once one is', async () => {
    const view = stackOfRows([row(82, true), row(83, true)]);
    answers.overviews = (layers) => layers.map(() => ({ kind: 'unread' }));
    readLayers('unread', view);
    await settled();
    expect(layersSaid.get('unread').get(82)).toMatchObject({ stack: undefined, tldr: undefined });
    // Nothing more is asked of itself: what it said didn't change.
    expect(asked('layerOverviews')).toEqual([2]);
    readLayers('unread', view);
    await settled();
    expect(asked('layerOverviews')).toEqual([2, 2]);
    answers.overviews = (layers) => layers.map((number) => overviewOf(number, 9, 'Read.'));
    readLayers('unread', view);
    await settled();
    expect(layersSaid.get('unread').get(83)).toMatchObject({ stack: 9 });
    readLayers('unread', view);
    await settled();
    expect(asked('layerOverviews')).toEqual([2, 2, 2]);
  });

  it('asks for at most 100 layers at once, overviews and descriptions', async () => {
    const view = stackOfRows(Array.from({ length: 150 }, (_, at) => row(at + 1, true)));
    answers.overviews = (layers) => layers.map(() => ({ kind: 'none' }));
    answers.lines = (layers) => layers.map((number) => `Layer ${number}.`);
    readLayers('many', view);
    await settled();
    expect(asked('layerOverviews')).toEqual([100, 50]);
    expect(layersSaid.get('many').size).toBe(150);
    readLines('many', view);
    await settled();
    expect(asked('layerLines')).toEqual([100, 50]);
    expect(layersSaid.get('many').get(150)).toMatchObject({ line: 'Layer 150.' });
  });
});

/** Layer #83's own overview, naming stack `stack`, as read from `source`. */
function ownNaming(stack: number, source: OverviewSource): Standing {
  const commit: OverviewCommit = {
    id: 'd'.repeat(40),
    source,
    repository: { owner: 'rozed-dev', name: 'e2e' },
    byline: null,
    entries: [],
    truncated: false,
    read: true,
  };
  const state: OverviewState = {
    id: 'own',
    ref: 'refs/lo/pr/83',
    watching: true,
    found: 'commit',
    overview: commit,
    newer: null,
    saved: false,
    problem: null,
    code: 'ready',
  };
  const header = { format: 1, pr: 83, stack, commit: COMMIT };
  const checked: CheckedOverview = {
    kind: 'checked',
    key: commit.id,
    commit,
    parsed: parseArtifact(
      `---\nformat: 1\npr: 83\nstack: ${stack}\ncommit: ${COMMIT}\n---\n\n## tl;dr\n\nIt.\n`,
    ),
    checked: { outcome: { kind: 'shown', header, code: [], figures: [] }, findings: [] },
    figures: new Map(),
    coming: [],
    code: { kind: 'none' },
  };
  return standingOf(state, checked);
}

describe('the stack a layer’s own overview names', () => {
  it('is the one the repository’s own names; a fork’s names none, whatever it says', () => {
    expect(namedBy(ownNaming(9, 'base'))).toBe(9);
    expect(namedBy(ownNaming(9, 'fork'))).toBe(null);
    expect(namedBy(ownNaming(9, 'kept'))).toBe(null);
  });
});
