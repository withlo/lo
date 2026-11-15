// The syntax index across views: a tree shown by two views is built once, the new side before the
// old, each view says how far it has got, and a view back online builds what it left for want of
// the network. Clearing the cache reads it all again.

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type { IndexState } from '../contract.ts';
import { CodeIndex, type ViewInput } from './indexer.ts';
import { commitOf, fakeBackground, fakeRepo, memoryStore, type FakeRepo } from './test/fake.ts';

const PARSE = 'export function parse(input: string) { return input }\n';
const FORMAT =
  "import { parse } from './parse.ts'\nexport function format() { return parse('') }\n";

function setUp() {
  const background = fakeBackground();
  const published: { view: string; state: IndexState }[] = [];
  const index = new CodeIndex({
    store: memoryStore(),
    read: (files) => background.symbols(files),
    publish: (view, state) => published.push({ view, state }),
    log: () => undefined,
  });
  onTestFinished(() => index.stop());
  return { background, published, index };
}

function ready(repo: FakeRepo, offline = false): ViewInput {
  return {
    kind: 'ready',
    clone: () => Promise.resolve(repo),
    new: commitOf('head'),
    old: commitOf('base'),
    offline,
  };
}

const commits = {
  base: { 'src/parse.ts': PARSE },
  head: { 'src/parse.ts': PARSE, 'src/format.ts': FORMAT },
};

describe('the syntax index', () => {
  it('builds each tree once for every view that shows it, and says how far each view has got', async () => {
    const repo = fakeRepo({ commits });
    const { background, published, index } = setUp();
    index.follow('t1', { kind: 'waiting' });
    index.follow('t1', ready(repo));
    index.follow('t1:2', ready(repo));
    await vi.waitFor(() => {
      expect(index.state('t1')).toEqual({ kind: 'ready', partial: null });
      expect(index.state('t1:2')).toEqual({ kind: 'ready', partial: null });
    });
    expect(background.read.toSorted()).toEqual([FORMAT, PARSE].toSorted());
    const states = published.filter(({ view }) => view === 't1').map(({ state }) => state);
    expect(states[0]).toEqual({ kind: 'waiting' });
    expect(states).toContainEqual({ kind: 'building', done: 0, total: 2 });
    expect(states.at(-1)).toEqual({ kind: 'ready', partial: null });
    // Both sides' trees, known by ID, for the answers.
    expect(index.sides('t1')?.new.tree).toBeDefined();
    expect(index.sides('t1')?.old?.tree).toBeDefined();
  });

  it('says what’s left for want of the network, and builds it once the view is back online', async () => {
    const repo = fakeRepo({ commits, lacking: ['src/format.ts'], offline: true });
    const { background, index } = setUp();
    index.follow('t1', ready(repo, true));
    await vi.waitFor(() =>
      expect(index.state('t1')).toEqual({
        kind: 'ready',
        partial: { indexed: 1, total: 2, why: ['offline'] },
      }),
    );
    // Online again, as the clone fetches once more.
    Reflect.set(repo, 'offline', false);
    index.follow('t1', ready(repo, false));
    await vi.waitFor(() => expect(index.state('t1')).toEqual({ kind: 'ready', partial: null }));
    expect(background.read.toSorted()).toEqual([FORMAT, PARSE].toSorted());
  });

  it('lets go of a closed view, and reads it all again once the cache is cleared', async () => {
    const repo = fakeRepo({ commits });
    const { background, index } = setUp();
    index.follow('t1', ready(repo));
    await vi.waitFor(() => expect(index.state('t1')).toEqual({ kind: 'ready', partial: null }));
    await index.clear();
    await vi.waitFor(() => expect(background.read).toHaveLength(4));
    await vi.waitFor(() => expect(index.state('t1')).toEqual({ kind: 'ready', partial: null }));
    index.follow('t1', undefined);
    expect(index.state('t1')).toBe(undefined);
    expect(index.sides('t1')).toBe(undefined);
  });
});
