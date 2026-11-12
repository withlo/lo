// Following a reference to code before a tab's diff has its files: the place waits for them, then
// shows in the diff when it has the file, and whole when it doesn't.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { DiffState, FileVersions } from '../contract.ts';
import { keyOf, Loader } from './loader.ts';
import { keepPlaces, showPlace } from './places.ts';
import type * as Tabs from './tabs.ts';

const seen = vi.hoisted(() => ({
  loader: undefined as unknown,
  middles: [] as string[],
  reveals: [] as unknown[],
}));

vi.mock('../../../window/commands/registry.ts', () => ({
  here: () => undefined,
  registry: () => ({ history: { record: () => undefined, register: () => undefined } }),
}));

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  showMiddle: (_tab: string, view: string) => {
    seen.middles.push(view);
    return true;
  },
}));

vi.mock('./tabs.ts', async (original) => ({
  ...(await original<typeof Tabs>()),
  loaderOf: () => seen.loader,
  drawnFor: () => undefined,
  revealWhenDrawn: (_tab: string, reveal: unknown) => {
    seen.reveals.push(reveal);
  },
}));

const HEAD = 'a'.repeat(40);

function changed(path: string): FileVersions {
  return {
    path: { text: path },
    previous: null,
    change: 'modified',
    additions: 1,
    deletions: 1,
    old: null,
    new: null,
    start: 'shown',
    generated: null,
    large: null,
    submodule: null,
    reach: 0,
    conflicted: false,
    since: null,
  };
}

function state(files: FileVersions[] | null): DiffState {
  return {
    id: 't1',
    at: HEAD,
    comparison: null,
    since: null,
    waiting: null,
    from: 'github',
    files,
    partial: false,
    problem: null,
  };
}

/** Work that's never done. */
const never = () => new Promise<never>(() => undefined);

/** A loader that loads nothing: only what main says of the diff reaches it. */
function loader(): Loader {
  const made = new Loader({
    texts: never,
    files: never,
    moves: never,
    highlight: never,
    order: () => [],
    log: () => undefined,
  });
  seen.loader = made;
  return made;
}

/** The tab's id for the changed file at `path`. */
const idOf = (diff: Loader, path: string) => diff.ids.of(keyOf(changed(path)));

beforeEach(() => {
  seen.middles.length = 0;
  seen.reveals.length = 0;
  keepPlaces(new Set());
});

describe('showPlace', () => {
  it('waits for the diff’s files, then shows a file the diff has in the diff', () => {
    const diff = loader();
    showPlace('t1', 'src/parser.ts', 7);
    expect(seen.middles).toEqual([]);
    diff.take(state(null));
    expect(seen.middles).toEqual([]);
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual(['diff.view']);
    expect(seen.reveals).toEqual([
      {
        target: { kind: 'line', at: { file: idOf(diff, 'src/parser.ts'), side: 'new', line: 7 } },
        focus: true,
      },
    ]);
    // Once.
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual(['diff.view']);
  });

  it('shows a file the diff doesn’t have whole, once the files are known', () => {
    const diff = loader();
    showPlace('t1', 'README.md', 1, { from: 1, to: 4 });
    expect(seen.middles).toEqual([]);
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual(['diff.whole']);
  });

  it('shows only the last place asked for while the files load', () => {
    const diff = loader();
    showPlace('t1', 'README.md', 1);
    showPlace('t1', 'src/parser.ts', 3);
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual(['diff.view']);
  });

  it('shows the place at once when the files are known', () => {
    const diff = loader();
    diff.take(state([changed('src/parser.ts')]));
    showPlace('t1', 'src/parser.ts', undefined);
    expect(seen.middles).toEqual(['diff.view']);
    expect(seen.reveals).toEqual([
      { target: { kind: 'file', file: idOf(diff, 'src/parser.ts') }, focus: true },
    ]);
  });
});
