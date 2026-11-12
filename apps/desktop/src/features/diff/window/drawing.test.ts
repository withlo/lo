// @vitest-environment jsdom
import { diffText, type FileDiff } from '@lo/diff';
import type { DiffView } from '@lo/ui/code';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';
import type { DiffState, FileVersions, Source, Start } from '../contract.ts';
import { draw, type Drawing, samePlace } from './drawing.ts';
import { Loader, type LoaderWork } from './loader.ts';
import { drawnFor } from './tabs.ts';

/** What the stand-in view was told, in order, and the files it says are on screen. */
const told: string[] = [];
let onScreen: string[] = [];
/** Each diff's name, to say which one the view was given. */
const names = new WeakMap<FileDiff, string>();

vi.mock('@lo/ui/code', () => ({
  createDiffView: (): Partial<DiffView> => ({
    viewport: () => ({ at: { kind: 'header', file: 'd0', side: 'new' }, offset: 0 }),
    scrollTo: () => true,
    fold: () => undefined,
    filesOnScreen: () => onScreen,
    // As a swap that adds a row would.
    keepsShape: () => false,
    keyState: () => ({ mode: 'normal', pending: false, target: { kind: 'none' } }),
    setLines: (id, lines, diff) =>
      void told.push(`lines ${id} ${lines.new.join(' ')} ${diff ? (names.get(diff) ?? '') : ''}`),
    setDiff: (id, diff) => void told.push(`diff ${id} ${names.get(diff) ?? ''}`),
    setTokens: (id, side) => void told.push(`tokens ${id} ${side}`),
    setCollapsed: (id, collapsed) => void told.push(`collapsed ${id} ${String(collapsed)}`),
    setHeader: () => undefined,
    setMoves: () => undefined,
    loadFailed: (id) => void told.push(`failed ${id}`),
    focus: () => undefined,
    reveal: () => true,
    setVimKeys: () => undefined,
    destroy: () => undefined,
  }),
}));

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({
    vimKeys: () => [],
    history: { record: () => undefined, register: () => () => undefined },
    subscribe: () => () => undefined,
  }),
  setMiddle: () => () => undefined,
}));

vi.mock('../../../window/commands/menus.tsx', () => ({ openMenu: () => undefined }));

vi.mock('./main.ts', () => ({
  main: () => ({ drawn: () => Promise.resolve() }),
  diffJobs: () => ({}),
}));

const HEAD = 'a'.repeat(40);
const TAB: PullTab = { kind: 'pull', id: 't1', owner: 'o', repo: 'r', number: 1 };

function versions(start: Start): FileVersions {
  return {
    path: { text: 'src/a.ts' },
    previous: null,
    change: 'modified',
    additions: 1,
    deletions: 1,
    old: { blob: 'c'.repeat(40), size: 10 },
    new: { blob: 'd'.repeat(40), size: 10 },
    start,
    generated: start === 'collapsed' ? 'attribute' : null,
    large: null,
    submodule: null,
    reach: 0,
  };
}

function state(start: Start, from: Source): DiffState {
  return { id: TAB.id, at: HEAD, from, files: [versions(start)], partial: false, problem: null };
}

/**
 * The work behind a loader: GitHub's lines say `github`, the local copy's `local`, and each diff
 * is named by whether whitespace showed.
 */
const work: LoaderWork = {
  texts: ({ from, files }) =>
    Promise.resolve(files.map(() => ({ kind: 'texts', old: 'x\n', new: `${from}\n` }))),
  files: (input) =>
    Promise.resolve(
      input.files.map((file) => {
        const diff = diffText('x\n', file.kind === 'texts' ? (file.new ?? '') : '');
        names.set(diff, input.whitespace ? 'shown' : 'hidden');
        return { ok: true, diff, tokens: {}, changes: { deleted: [], added: [] } };
      }),
    ),
  moves: () => Promise.resolve([]),
  highlight: ({ files }) =>
    Promise.resolve(highlighting ? files.map(() => ({ new: Uint32Array.from([0, 1, 1]) })) : []),
  order: () => [],
  log: () => undefined,
};

/** Lets the loader's and the drawing's work run, a frame at a time. */
async function frames(count = 8): Promise<void> {
  for (let at = 0; at < count; at++) await new Promise((resolve) => setTimeout(resolve, 20));
}

let drawing: Drawing | undefined;
/** Whether highlighting answers: off, as when it's dropped before it comes. */
let highlighting = true;

/**
 * Draws GitHub's diff of the tab's one file, and has the local copy's list follow, in which it
 * starts out closed, as generated: its lines come while the reader is on it.
 */
async function swapUnderReader(): Promise<Loader> {
  const loader = new Loader(work);
  loader.setWhitespace(true);
  loader.take(state('shown', 'github'));
  await frames();
  const ready = loader.snapshot().ready;
  if (!ready) throw new Error('GitHub’s diff isn’t ready');
  drawing = draw({
    parent: document.body.appendChild(document.createElement('div')),
    tab: TAB,
    loader,
    entries: ready.entries,
    at: HEAD,
    layout: 'split',
    nonce: '',
    packaged: true,
    shown: true,
    before: undefined,
  });
  // As the diff's component does: each new list goes to the drawing.
  loader.subscribe(() => drawing?.update(loader.snapshot().ready?.entries ?? []));
  told.length = 0;
  loader.take(state('collapsed', 'local'));
  await frames();
  return loader;
}

beforeEach(() => {
  told.length = 0;
  onScreen = ['d0'];
  highlighting = true;
});

afterEach(() => {
  drawing?.stop();
  drawing = undefined;
  document.body.replaceChildren();
});

describe('a file under the reader that starts out otherwise in the local copy', () => {
  it('keeps GitHub’s lines and diff while it’s held, and takes the latest once it’s let go', async () => {
    const loader = await swapUnderReader();
    expect(told).toEqual([]);

    // Whitespace hidden meanwhile: the local copy's new diff waits with its lines.
    loader.setWhitespace(false);
    await frames();
    expect(told).toEqual([]);

    // The reader opens or closes it: the latest comes in.
    drawnFor(TAB.id)?.acted('d0');
    await frames();
    expect(told[0]).toBe('lines d0 local hidden');
  });

  it('comes in once it’s off screen and the reader has stopped scrolling', async () => {
    await swapUnderReader();
    expect(told).toEqual([]);

    // Scrolled away, with no cursor or top file to say so.
    onScreen = [];
    document.body.firstElementChild?.dispatchEvent(new Event('scroll'));
    await frames(15);
    expect(told).toContain('lines d0 local shown');
    expect(told).toContain('collapsed d0 true');
  });

  it('asks for its colors again when it’s let go without them', async () => {
    highlighting = false;
    await swapUnderReader();
    expect(told).toEqual([]);

    highlighting = true;
    drawnFor(TAB.id)?.acted('d0');
    await frames();
    expect(told).toContain('tokens d0 new');
  });
});

/** A line of file `d5`, and a column on it if given. */
const at = (line: number, column?: number, side: 'old' | 'new' = 'new') => ({
  kind: 'line' as const,
  at: { file: 'd5', side, line, ...(column === undefined ? {} : { column }) },
});

describe('a place asked for as the diff comes back', () => {
  it('is the cursor’s own when it’s on the same line of the same side, whatever the column', () => {
    expect(samePlace(at(12, 4), at(12))).toBe(true);
    // A span is on the line its cursor is on, its end.
    expect(
      samePlace({ kind: 'line', at: { file: 'd5', side: 'new', from: 9, to: 12 } }, at(12)),
    ).toBe(true);
    expect(samePlace(at(12), at(13))).toBe(false);
    expect(samePlace(at(12, 0, 'old'), at(12))).toBe(false);
    const header = { kind: 'header', file: 'd5', side: 'new' } as const;
    expect(samePlace(header, { kind: 'header', side: 'new', file: 'd5' })).toBe(true);
    expect(samePlace(header, { kind: 'file', file: 'd5' })).toBe(false);
  });
});
