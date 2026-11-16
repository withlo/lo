// @vitest-environment jsdom
// What code features reach of a tab's code views: the file and commit at a place on either side,
// as the code port names them; whether the comparison shows a file on a side; and a jump to a
// place, recorded in the tab's history first.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffState, FileVersions } from '../contract.ts';
import { codeViewsOf, hintsShown } from './code.ts';
import { keyOf, Loader } from './loader.ts';
import type * as Tabs from './tabs.ts';

const seen = vi.hoisted(() => ({
  loader: undefined as unknown,
  recorded: [] as unknown[],
  revealed: [] as unknown[],
  compared: undefined as { from: string | null; to: string } | undefined,
}));

vi.mock('../../../window/commands/registry.ts', () => ({
  here: () => ({ view: 'diff', at: { kind: 'none' } }),
  registry: () => ({
    history: {
      record: (entry: unknown) => {
        seen.recorded.push(entry);
      },
    },
  }),
}));

vi.mock('../../revisions/window/shared.ts', () => ({
  revisionsOf: () => undefined,
  comparedIn: () => seen.compared,
}));

vi.mock('./tabs.ts', async (original) => ({
  ...(await original<typeof Tabs>()),
  loaderOf: () => seen.loader,
  keysDiff: () => ({
    loader: seen.loader,
    view: {
      reveal: (at: unknown) => {
        seen.revealed.push(at);
        return true;
      },
      focus: () => undefined,
    },
  }),
}));

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OLDER = 'c'.repeat(40);

function changed(path: string, change: Partial<FileVersions> = {}): FileVersions {
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
    ...change,
  };
}

function state(files: FileVersions[], change: Partial<DiffState> = {}): DiffState {
  return {
    id: 't1',
    at: HEAD,
    comparison: null,
    compareFrom: null,
    since: null,
    waiting: null,
    from: 'local',
    files,
    start: BASE,
    partial: false,
    uncompared: false,
    problem: null,
    ...change,
  };
}

const never = () => new Promise<never>(() => undefined);

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

const renamed = changed('src/parser.ts', { change: 'renamed', previous: { text: 'src/parse.ts' } });
const added = changed('src/text/wrap.ts', { change: 'added' });
const deleted = changed('src/legacy.ts', { change: 'deleted' });

beforeEach(() => {
  seen.recorded.length = 0;
  seen.revealed.length = 0;
  seen.compared = undefined;
});

describe('codeViewsOf', () => {
  it('names a place’s file by its path on that side, and the commit that side shows', () => {
    const diff = loader();
    diff.take(state([renamed]));
    const file = diff.ids.of(keyOf(renamed));
    const views = codeViewsOf('t1');
    expect(views.fileAt({ file, side: 'new', line: 2 })).toEqual({
      path: 'src/parser.ts',
      commit: HEAD,
      change: 'renamed',
    });
    expect(views.fileAt({ file, side: 'old', line: 2 })).toEqual({
      path: 'src/parse.ts',
      commit: BASE,
      change: 'renamed',
    });
  });

  it('knows no commit on the base’s side before the local copy has worked out where it starts', () => {
    const diff = loader();
    diff.take(state([renamed], { start: null, from: 'github' }));
    const file = diff.ids.of(keyOf(renamed));
    expect(codeViewsOf('t1').fileAt({ file, side: 'old', line: 1 })?.commit).toBeUndefined();
  });

  it('takes the older revision’s head for the base’s side of two revisions compared', () => {
    const diff = loader();
    diff.take(state([renamed], { comparison: 'r1..r2', start: null }));
    const file = diff.ids.of(keyOf(renamed));
    seen.compared = { from: OLDER, to: HEAD };
    expect(codeViewsOf('t1').fileAt({ file, side: 'old', line: 1 })?.commit).toBe(OLDER);
    // From the base, which revision's start that is isn't the window's to know.
    seen.compared = { from: null, to: HEAD };
    expect(codeViewsOf('t1').fileAt({ file, side: 'old', line: 1 })?.commit).toBeUndefined();
  });

  it('says where the comparison shows a file: a renamed one by either path, on its own sides', () => {
    loader().take(state([renamed, added, deleted]));
    const views = codeViewsOf('t1');
    expect(views.inDiff('src/parser.ts', 'new')).toBe(true);
    expect(views.inDiff('src/parse.ts', 'old')).toBe(true);
    expect(views.inDiff('src/parse.ts', 'new')).toBe(false);
    expect(views.inDiff('src/text/wrap.ts', 'old')).toBe(false);
    expect(views.inDiff('src/legacy.ts', 'new')).toBe(false);
    expect(views.inDiff('src/legacy.ts', 'old')).toBe(true);
    expect(views.inDiff('README.md', 'new')).toBe(false);
  });

  it('goes to a place in the diff as a jump, recording where the tab was first', () => {
    const diff = loader();
    diff.take(state([renamed]));
    const file = diff.ids.of(keyOf(renamed));
    expect(codeViewsOf('t1').go('diff', { file, side: 'new', line: 9 })).toBe(true);
    expect(seen.recorded).toEqual([{ view: 'diff', at: { kind: 'none' } }]);
    expect(seen.revealed).toEqual([{ kind: 'line', at: { file, side: 'new', line: 9 } }]);
  });

  it('keeps each view’s hints apart', () => {
    const views = codeViewsOf('t2');
    const hint = {
      kind: 'hint',
      at: { file: 'f', side: 'new', line: 1 },
      label: ': number',
    } as const;
    views.setHints('diff', [hint]);
    expect(hintsShown.get('t2')).toEqual({ diff: [hint], file: [] });
    views.setHints('diff', []);
    expect(hintsShown.get('t2')).toEqual({ diff: [], file: [] });
  });
});
