// @vitest-environment jsdom
// How the stack's tree draws each row main sends: text from pull requests without what would turn
// its direction around, the layer on screen's overview and viewed count from its tab, and the
// others' from what main read.

import { describe, expect, it } from 'vitest';

import type { Row } from '../contract.ts';
import { layerOf, type OnScreen } from './Stack.tsx';

const ROW: Row = {
  number: 83,
  title: 'Stack B: rate limit GraphQL queries by cost',
  author: 'rozed-bot',
  state: 'open',
  current: false,
  branch: false,
  on: null,
  review: 'changesRequested',
  checks: 'failing',
  queue: 2,
  needsRebase: false,
  overview: true,
  viewed: { source: 'layers', viewed: 41, files: 214, complete: false },
};

const ON_SCREEN: OnScreen = {
  count: { viewed: 1, total: 3 },
  files: { id: 't1', files: [], total: 3 },
  overview: 'stale',
};

describe('a row', () => {
  it("shows another layer's review, checks, queue, overview and viewed count as main read them", () => {
    expect(layerOf(ROW, ON_SCREEN)).toEqual({
      key: '83',
      number: 83,
      title: 'Stack B: rate limit GraphQL queries by cost',
      state: 'open',
      author: 'rozed-bot',
      review: 'changes',
      checks: 'failing',
      queue: 2,
      needsRebase: false,
      overview: 'current',
      // GitHub's marks were read for the first 100 files only: "41+/214".
      viewed: { viewed: 41, total: 214, partial: true },
      branch: false,
      sitsOn: undefined,
    });
    expect(layerOf({ ...ROW, overview: false }, ON_SCREEN).overview).toBe('none');
    // From a fork, or before the repository's overviews are read.
    expect(layerOf({ ...ROW, overview: null }, ON_SCREEN).overview).toBeUndefined();
    expect(layerOf({ ...ROW, viewed: null }, ON_SCREEN).viewed).toBeUndefined();
  });

  it("shows the layer on screen's overview and viewed count from its tab", () => {
    const current = { ...ROW, current: true, viewed: { source: 'tab' as const } };
    expect(layerOf(current, ON_SCREEN)).toMatchObject({
      overview: 'stale',
      // GitHub listed fewer files than the pull request changes.
      viewed: { viewed: 1, total: 3, partial: true },
    });
    const listed = {
      ...ON_SCREEN,
      files: {
        id: 't1',
        files: ['a', 'b', 'c'].map((path) => ({ path, viewed: 'unviewed' as const })),
        total: 3,
      },
    };
    expect(layerOf(current, listed).viewed).toEqual({ viewed: 1, total: 3, partial: false });
    expect(layerOf(current, { ...ON_SCREEN, count: undefined }).viewed).toBeUndefined();
  });

  it('draws the text of a pull request without what turns its direction around', () => {
    const drawn = layerOf(
      { ...ROW, title: 'Fix ‮gnp.exe‬', author: 'mira⁦-chen', on: 82 },
      ON_SCREEN,
    );
    expect(drawn).toMatchObject({ title: 'Fix gnp.exe', author: 'mira-chen', sitsOn: 82 });
  });
});
