// @vitest-environment jsdom
import { diffText, type FileDiff } from '@lo/diff';
import type { DiffView, Probe, ThreadView } from '@lo/ui/code';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';
import type { DiffState, FileVersions, Source, Start } from '../contract.ts';
import { draw, type Drawing, Pacer, samePlace } from './drawing.ts';
import { setThreader, threadsChanged } from './shared.ts';
import type { DrawnDiff, ThreadCounts } from './threads.ts';
import { Loader, type LoaderWork } from './loader.ts';
import { drawnFor, revealWhenDrawn } from './tabs.ts';

/** What the stand-in view was told, in order, and the files it says are on screen. */
const told: string[] = [];
let onScreen: string[] = [];
/** Where the stand-in view's cursor went and what it scrolled to, and its headers, in order. */
const moved: string[] = [];
const headers: string[] = [];
/** The threads the stand-in view was given, and what each header counts of them, in order. */
const threadsTold: string[] = [];
const counted: string[] = [];
/** How far down the page each file's header is drawn, by its id. */
const tops = new Map<string, number>();
/** How tall the stand-in's headers are, in pixels. */
const HEADER = 38;
/** What a file taking its lines does to the page, as one that grows moves the headers below it. */
let tookLines: ((id: string) => void) | undefined;
/** Whether a file's new lines draw in the rows it has, which swaps a file on screen in place. */
let keeps = false;
/** Each diff's name, to say which one the view was given. */
const names = new WeakMap<FileDiff, string>();

vi.mock('@lo/ui/code', () => ({
  createDiffView: (): Partial<Omit<DiffView, 'probe'>> & {
    probe: Pick<Probe, 'spotTop' | 'spotBottom'>;
  } => ({
    viewport: () => ({ at: { kind: 'header', file: 'd0', side: 'new' }, offset: 0 }),
    scrollTo: (viewport) => {
      const { at } = viewport;
      moved.push(`scroll ${at.kind === 'header' ? at.file : at.at.file} ${viewport.offset}`);
      return true;
    },
    // What's at the top kept through a change, which moves nothing.
    holdTop: () => true,
    probe: {
      spotTop: (spot) => (spot.kind === 'header' ? tops.get(spot.file) : undefined),
      spotBottom: (spot) => {
        const top = spot.kind === 'header' ? tops.get(spot.file) : undefined;
        return top === undefined ? undefined : top + HEADER;
      },
    },
    fold: () => undefined,
    filesOnScreen: () => onScreen,
    // As a swap that adds a row would, unless the test says otherwise.
    keepsShape: () => keeps,
    keyState: () => ({ mode: 'normal', pending: false, target: { kind: 'none' } }),
    setLines: (id, lines, diff) => {
      told.push(`lines ${id} ${lines.new.join(' ')} ${diff ? (names.get(diff) ?? '') : ''}`);
      tookLines?.(id);
    },
    setDiff: (id, diff) => void told.push(`diff ${id} ${names.get(diff) ?? ''}`),
    setTokens: (id, side) => void told.push(`tokens ${id} ${side}`),
    setCollapsed: (id, collapsed) => void told.push(`collapsed ${id} ${String(collapsed)}`),
    setHeader: (id, header) => {
      headers.push(`${id} ${header.viewed ?? 'none'}`);
      const threads = header.threads;
      counted.push(`${id} ${threads ? `${threads.unresolved} of ${threads.total}` : 'none'}`);
    },
    setThreads: (threads, _render, options) => {
      const at = threads.map(({ id, at: { file, side, line } }) => `${id} ${file} ${side} ${line}`);
      threadsTold.push(`${at.join(', ')}${options?.now ? ' now' : ''}`);
    },
    setMoves: () => undefined,
    loadFailed: (id) => void told.push(`failed ${id}`),
    focus: () => undefined,
    reveal: (target) => {
      moved.push(`reveal ${target.kind === 'file' ? target.file : target.kind}`);
      return true;
    },
    revealAtTop: (target) => {
      moved.push(`top ${target.kind === 'file' ? target.file : target.kind}`);
      return true;
    },
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

function versions(start: Start, path = 'src/a.ts'): FileVersions {
  return {
    path: { text: path },
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
    conflicted: false,
    since: null,
  };
}

function state(start: Start, from: Source, paths = ['src/a.ts']): DiffState {
  return {
    id: TAB.id,
    at: HEAD,
    comparison: null,
    compareFrom: null,
    since: null,
    waiting: null,
    from,
    files: paths.map((path) => versions(start, path)),
    start: null,
    partial: false,
    uncompared: false,
    problem: null,
  };
}

/** Five files, the first on screen as the tests that use them start. */
const FIVE = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];

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

/** `work`, whose files come with their highlighting once the view is drawn, as Lo's do. */
const colored: LoaderWork = {
  ...work,
  files: (input) =>
    Promise.resolve(
      input.files.map((file) => {
        const diff = diffText('x\n', file.kind === 'texts' ? (file.new ?? '') : '');
        names.set(diff, input.whitespace ? 'shown' : 'hidden');
        const tokens = input.highlight ? { new: Uint32Array.from([0, 1, 1]) } : {};
        return { ok: true, diff, tokens, changes: { deleted: [], added: [] } };
      }),
    ),
};

/** Lets the loader's and the drawing's work run, a frame at a time. */
async function frames(count = 8): Promise<void> {
  for (let at = 0; at < count; at++) await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Lets the loader's and the drawing's work run until `done`, a frame at a time, 2 s at most. */
async function waitFor(done: () => boolean): Promise<void> {
  for (let at = 0; at < 100 && !done(); at++) await frames(1);
}

let drawing: Drawing | undefined;
/** Whether highlighting answers: off, as when it's dropped before it comes. */
let highlighting = true;

/**
 * Draws GitHub's diff of the tab's one file, and has the local copy's list follow, in which it
 * starts out closed, as generated: its lines come while the reader is on it.
 */
async function swapUnderReader(): Promise<Loader> {
  const loader = await drawnGithub(work, ['src/a.ts']);
  told.length = 0;
  loader.take(state('collapsed', 'local'));
  await frames();
  return loader;
}

/** Draws GitHub's diff of files at `paths`, with `work`, as the diff's component does. */
async function drawnGithub(given: LoaderWork, paths: readonly string[]): Promise<Loader> {
  const loader = new Loader(given);
  loader.setWhitespace(true);
  loader.take(state('shown', 'github', [...paths]));
  await frames();
  const ready = loader.snapshot().ready;
  if (!ready) throw new Error('GitHub’s diff isn’t ready');
  drawing = draw({
    parent: document.body.appendChild(document.createElement('div')),
    tab: TAB,
    loader,
    entries: ready.entries,
    at: HEAD,
    comparison: null,
    compareFrom: null,
    layout: 'split',
    nonce: '',
    packaged: true,
    shown: true,
    before: undefined,
    marks: { byPath: new Map(), count: undefined },
  });
  // As the diff's component does: each new list goes to the drawing.
  loader.subscribe(() => drawing?.update(loader.snapshot().ready?.entries ?? []));
  return loader;
}

/**
 * What the stand-in view was told in each frame from here on, its headers too, until `stop`: a
 * frame's share of the drawing's work each, as each share runs just after a frame.
 */
function byFrame(): { stop: () => Promise<string[][]> } {
  const seen: string[][] = [];
  let toldAt = told.length;
  let headersAt = headers.length;
  const each = () => {
    seen.push([...told.slice(toldAt), ...headers.slice(headersAt).map((one) => `header ${one}`)]);
    toldAt = told.length;
    headersAt = headers.length;
    frame = requestAnimationFrame(each);
  };
  let frame = requestAnimationFrame(each);
  return {
    // Once the frame after the last share, which says what it did.
    stop: async () => {
      await frames(2);
      cancelAnimationFrame(frame);
      return seen;
    },
  };
}

beforeEach(() => {
  told.length = 0;
  moved.length = 0;
  headers.length = 0;
  tops.clear();
  tookLines = undefined;
  keeps = false;
  onScreen = ['d0'];
  highlighting = true;
});

afterEach(() => {
  drawing?.stop();
  drawing = undefined;
  document.body.replaceChildren();
});

describe('the pacer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a task that changes a lot of what’s drawn with a frame’s share to itself', async () => {
    vi.useFakeTimers();
    const pacer = new Pacer();
    /** The tasks each frame's share ran, by when it ran. */
    const shares = new Map<number, string[]>();
    const task = (name: string) => () => {
      const now = performance.now();
      shares.set(now, [...(shares.get(now) ?? []), name]);
    };
    pacer.run(task('colors'));
    pacer.alone(task('lines'));
    pacer.run(task('diff'));
    pacer.run(task('moves'));
    pacer.alone(task('more lines'));
    await vi.advanceTimersByTimeAsync(200);
    expect([...shares.values()]).toEqual([
      ['colors'],
      ['lines'],
      ['diff', 'moves'],
      ['more lines'],
    ]);
  });

  it('runs a task asked for first in the next share, before the tasks waiting', async () => {
    vi.useFakeTimers();
    const pacer = new Pacer();
    const shares = new Map<number, string[]>();
    const task = (name: string) => () => {
      const now = performance.now();
      shares.set(now, [...(shares.get(now) ?? []), name]);
    };
    pacer.alone(() => {
      task('lines')();
      pacer.first(task('its colors'));
    });
    pacer.alone(task('more lines'));
    pacer.run(task('other colors'));
    await vi.advanceTimersByTimeAsync(200);
    expect([...shares.values()]).toEqual([
      ['lines'],
      ['its colors'],
      ['more lines'],
      ['other colors'],
    ]);
  });
});

describe('the local copy’s files swapped in place', () => {
  it('each take a frame’s share to themselves, and one on screen its colors in the next', async () => {
    // The file on screen draws its new lines in the rows it has, so it isn't held.
    keeps = true;
    const loader = await drawnGithub(colored, FIVE);
    await frames();
    told.length = 0;
    const watched = byFrame();
    loader.take(state('shown', 'local', FIVE));
    await waitFor(() => told.filter((each) => each.startsWith('tokens ')).length >= FIVE.length);
    const seen = await watched.stop();
    const swapping = seen.filter((share) => share.some((each) => each.startsWith('lines ')));
    // A file's lines, first in a share, and the only lines in it.
    expect(swapping.map((share) => share[0]?.split(' ').slice(0, 2).join(' '))).toEqual([
      'lines d0',
      'lines d1',
      'lines d2',
      'lines d3',
      'lines d4',
    ]);
    expect(swapping.map((share) => share.filter((each) => each.startsWith('lines ')))).toEqual(
      swapping.map((share) => [share[0]]),
    );
    // The file on screen goes without its colors for one frame, not until the others are in.
    const frameOf = (prefix: string) =>
      seen.findIndex((share) => share.some((each) => each.startsWith(prefix)));
    expect(frameOf('tokens d0') - frameOf('lines d0')).toBe(1);
  });

  it('come in a frame’s share each once they’re off screen, after the work queued before', async () => {
    const loader = await drawnGithub(work, FIVE);
    await frames();
    const ready = loader.snapshot().ready;
    if (!ready) throw new Error('GitHub’s diff isn’t ready');
    onScreen = [];
    told.length = 0;
    const watched = byFrame();
    // Every file now starts out closed, as generated, which changes its header too: the headers
    // are queued first, then the files closed a file a share.
    drawing?.update(
      ready.entries.map((entry) => ({
        ...entry,
        versions: versions('collapsed', entry.versions.path.text),
      })),
    );
    await waitFor(() => told.filter((each) => each.startsWith('collapsed ')).length >= 5);
    const seen = await watched.stop();
    const closing = seen.filter((share) => share.some((each) => each.startsWith('collapsed ')));
    expect(closing.map((share) => share.join(', '))).toEqual(
      ['d0', 'd1', 'd2', 'd3', 'd4'].map((id) => `collapsed ${id} true`),
    );
  });
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

describe('a file the reader acts on', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes its new lines waiting their turn at once, so the key acts on them', async () => {
    const loader = await drawnGithub(work, FIVE);
    await frames();
    // Frames come only as the test runs them: until then, each file's turn waits.
    const waiting: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      waiting.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    // The reader is on the last file, whose new lines don't draw in the rows it has.
    onScreen = ['d4'];
    told.length = 0;
    loader.take(state('shown', 'local', FIVE));
    await waitFor(() => loader.shown('d4')?.from === 'local');
    expect(told).toEqual([]);

    // A key on it, as `zR`: its lines come in first.
    drawnFor(TAB.id)?.acted('d4');
    expect(told).toEqual(['lines d4 local shown']);

    // The other files take their turns, and its own has nothing left to do.
    while (waiting.length > 0) {
      waiting.shift()?.(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(told.filter((each) => each.startsWith('lines '))).toEqual([
      'lines d4 local shown',
      'lines d0 local shown',
      'lines d1 local shown',
      'lines d2 local shown',
      'lines d3 local shown',
    ]);
  });
});

/** A line of file `d5`, and a column on it if given. */
const at = (line: number, column?: number, side: 'old' | 'new' = 'new') => ({
  kind: 'line' as const,
  at: { file: 'd5', side, line, ...(column === undefined ? {} : { column }) },
});

describe('a file the tree shows', () => {
  it('comes to the top of the screen, with the cursor on its header, wherever it is', async () => {
    await drawTwo();
    tops.set('d1', 300);
    expect(drawnFor(TAB.id)?.toTop('d1')).toBe(true);
    expect(moved).toEqual(['top d1']);
  });

  it('asked for before the diff is drawn, comes to the top as it’s drawn, where a place only shows', async () => {
    revealWhenDrawn(TAB.id, { target: { kind: 'file', file: 'd1' }, focus: false, top: true });
    await drawnGithub(work, ['src/a.ts', 'src/b.ts']);
    expect(moved).toEqual(['top d1']);
    drawing?.stop();
    moved.length = 0;
    // A place `⌃o` goes back to is shown as it was, not brought to the top.
    revealWhenDrawn(TAB.id, { target: { kind: 'file', file: 'd1' }, focus: false });
    await drawnGithub(work, ['src/a.ts', 'src/b.ts']);
    expect(moved).toEqual(['reveal d1']);
  });
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

/** Marks as the revisions feature shows them, by path. */
function marksOf(entries: [string, 'viewed' | 'unviewed' | 'dismissed'][]) {
  return { byPath: new Map(entries), count: undefined };
}

/**
 * Draws two files from the local copy, `src/a.ts` and `src/b.ts`, both showing their lines, in a
 * box 800 pixels tall, with the stand-in's own record cleared once they're drawn. From GitHub's
 * first, `swapped`, the local copy's lines come while both are on screen, so the view holds them
 * back: what the stand-in was told as they came stays in its record.
 */
async function drawTwo(swapped = false): Promise<Drawing> {
  const loader = new Loader(work);
  loader.setWhitespace(true);
  const files = [versions('shown', 'src/a.ts'), versions('shown', 'src/b.ts')];
  loader.take({ ...state('shown', swapped ? 'github' : 'local'), files });
  await frames();
  const ready = loader.snapshot().ready;
  if (!ready) throw new Error('the diff isn’t ready');
  const parent = document.body.appendChild(document.createElement('div'));
  parent.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 800 });
  const made = draw({
    parent,
    tab: TAB,
    loader,
    entries: ready.entries,
    at: HEAD,
    comparison: null,
    compareFrom: null,
    layout: 'split',
    nonce: '',
    packaged: true,
    before: undefined,
    shown: true,
    marks: marksOf([
      ['src/a.ts', 'unviewed'],
      ['src/b.ts', 'unviewed'],
    ]),
  });
  drawing = made;
  await frames(2);
  told.length = 0;
  moved.length = 0;
  headers.length = 0;
  if (swapped) {
    onScreen = ['d0', 'd1'];
    loader.subscribe(() => drawing?.update(loader.snapshot().ready?.entries ?? []));
    loader.take({ ...state('shown', 'local'), files });
    await frames();
  }
  return made;
}

describe('viewed files', () => {
  it('a file marked viewed elsewhere closes once it’s off screen, its header’s ball at once', async () => {
    const made = await drawTwo();
    onScreen = ['d0', 'd1'];
    made.setMarks(
      marksOf([
        ['src/a.ts', 'unviewed'],
        ['src/b.ts', 'viewed'],
      ]),
    );
    await frames();
    expect(headers).toEqual(['d1 viewed']);
    expect(told).toEqual([]);

    onScreen = ['d0'];
    document.body.firstElementChild?.dispatchEvent(new Event('scroll'));
    await frames(15);
    expect(told).toContain('collapsed d1 true');
    expect(told).not.toContain('collapsed d0 true');
  });

  it('e closes the file at once, and the next file’s header stays where it is on screen', async () => {
    await drawTwo();
    tops.set('d1', 300);
    drawnFor(TAB.id)?.viewedHere('d0', true, 'd1');
    expect(told).toEqual(['collapsed d0 true']);
    expect(moved).toEqual(['reveal d1', 'scroll d1 -300']);
  });

  it('e keeps the next file’s header where the reader saw it, though the file closed takes its held lines', async () => {
    await drawTwo(true);
    expect(told).toEqual([]);
    tops.set('d1', 300);
    // The local copy's lines of src/a.ts, held back while the reader looked at it, are taller.
    tookLines = (id) => {
      if (id === 'd0') tops.set('d1', 328);
    };
    drawnFor(TAB.id)?.viewedHere('d0', true, 'd1');
    expect(told[0]).toBe('lines d0 local shown');
    expect(told).toContain('collapsed d0 true');
    expect(moved.slice(-2)).toEqual(['reveal d1', 'scroll d1 -300']);
  });

  it('e brings the next file’s header up to show whole when the foot of the screen cuts it off', async () => {
    await drawTwo();
    tops.set('d1', 790);
    drawnFor(TAB.id)?.viewedHere('d0', true, 'd1');
    expect(moved).toEqual(['reveal d1', `scroll d1 -${800 - HEADER}`]);
  });

  it('e brings the next file’s header to the top when it isn’t on screen', async () => {
    await drawTwo();
    tops.set('d1', 2400);
    drawnFor(TAB.id)?.viewedHere('d0', true, 'd1');
    expect(moved).toEqual(['reveal d1', 'scroll d1 0']);

    // With every other file viewed, the cursor goes to the file's own header.
    moved.length = 0;
    tops.set('d0', 100);
    drawnFor(TAB.id)?.viewedHere('d0', true, undefined);
    expect(moved).toEqual(['reveal d0', 'scroll d0 -100']);
  });

  it('a failed write takes the mark back, but not the closing, the cursor or the scroll', async () => {
    const made = await drawTwo();
    drawnFor(TAB.id)?.viewedHere('d0', true, 'd1');
    made.setMarks(
      marksOf([
        ['src/a.ts', 'viewed'],
        ['src/b.ts', 'unviewed'],
      ]),
    );
    told.length = 0;
    moved.length = 0;
    // GitHub didn't take it: the mark goes back.
    made.setMarks(
      marksOf([
        ['src/a.ts', 'unviewed'],
        ['src/b.ts', 'unviewed'],
      ]),
    );
    onScreen = ['d1'];
    document.body.firstElementChild?.dispatchEvent(new Event('scroll'));
    await frames(15);
    expect(headers.at(-1)).toBe('d0 unviewed');
    expect(told).not.toContain('collapsed d0 false');
    expect(moved.filter((each) => each.startsWith('reveal'))).toEqual([]);
  });

  it('clearing a mark opens the file again in place', async () => {
    await drawTwo();
    drawnFor(TAB.id)?.viewedHere('d0', false, undefined);
    expect(told).toEqual(['collapsed d0 false']);
    expect(moved.filter((each) => each.startsWith('reveal'))).toEqual([]);
  });
});

describe('review threads', () => {
  it('are placed as the threader says, those of a new view at once, and counted on headers', async () => {
    const asked: DrawnDiff[] = [];
    let placed: ThreadView[] = [
      { id: 'T1', at: { file: 'd0', side: 'new', line: 2 }, open: true, version: 1 },
    ];
    let counts = new Map<string, ThreadCounts>([
      ['d0', { threads: 1, unresolved: 1, comments: 2 }],
    ]);
    const stop = setThreader({
      threadsIn(tab, drawn) {
        expect(tab).toBe(TAB.id);
        asked.push(drawn);
        return { threads: placed, counts };
      },
      render: () => () => ({ update: () => undefined, destroy: () => undefined }),
      settled: () => true,
    });
    try {
      await drawnGithub(work, ['src/a.ts']);
      expect(asked[0]).toEqual({
        at: HEAD,
        comparison: null,
        compareFrom: null,
        files: [
          { id: 'd0', key: expect.any(String), path: 'src/a.ts', old: 'src/a.ts', since: false },
        ],
      });
      expect(threadsTold).toEqual(['T1 d0 new 2 now']);
      await frames();
      expect(counted.at(-1)).toBe('d0 1 of 1');

      // Threads that change after it's drawn wait, as the view decides, for their lines to leave.
      placed = [
        ...placed,
        { id: 'T2', at: { file: 'd0', side: 'old', line: 1 }, open: false, version: 1 },
      ];
      counts = new Map([['d0', { threads: 2, unresolved: 1, comments: 3 }]]);
      threadsChanged(TAB.id);
      expect(threadsTold.at(-1)).toBe('T1 d0 new 2, T2 d0 old 1');
      await frames();
      expect(counted.at(-1)).toBe('d0 1 of 2');
      // Asked again with nothing new, the view is told nothing.
      threadsChanged(TAB.id);
      expect(threadsTold).toHaveLength(2);
    } finally {
      stop();
      threadsTold.length = 0;
      counted.length = 0;
    }
  });
});
