// @vitest-environment jsdom
// Following a reference to code before a tab's diff has its files: the place waits for them, for a
// while, saying so, then shows in the diff when it has the file, and whole when it doesn't; or
// it's dropped once it's waited too long, or, its note taken back, once the reader does anything
// else, a key Lo takes included. With code beside, a link's place shows where the diff is, its line
// Landing, and a follow records nothing, leaves focus be, and waits for a key that repeats; a thread
// the threads panel shows Lands, with focus left in the panel.

import { defineCommands, handlers, KEY_EVENT, listen, Registry } from '@lo/ui/commands';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { DiffState, FileVersions } from '../contract.ts';
import { keyOf, Loader } from './loader.ts';
import { keepPlaces, showPlace, showThread } from './places.ts';
import type * as Tabs from './tabs.ts';
import { opened } from './whole.ts';

const seen = vi.hoisted(() => ({
  loader: undefined as unknown,
  middles: [] as string[],
  reveals: [] as unknown[],
  notes: [] as string[],
  /** The diff drawn, if it is, and whether the code is beside a reading view. */
  drawn: undefined as unknown,
  beside: false,
  /** Whether focus is in one of the views, rather than a panel. */
  inView: false,
  /** What the tab's history recorded. */
  recorded: [] as unknown[],
}));

vi.mock('../../../window/commands/notices.tsx', () => ({
  refuse: (reason: string) => {
    seen.notes.push(reason);
  },
  withdraw: (title: string, body: string) => {
    seen.notes.push(`withdrawn: ${body === '' ? title : `${title} ${body}`}`);
  },
}));

vi.mock('../../../window/commands/registry.ts', () => ({
  here: () => ({ view: 'overview', at: { kind: 'none' } }),
  registry: () => ({
    history: { record: (entry: unknown) => seen.recorded.push(entry), register: () => undefined },
  }),
}));

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  showMiddle: (_tab: string, view: string) => {
    seen.middles.push(view);
    return true;
  },
  besideNow: () => seen.beside,
  focusInView: () => seen.inView,
}));

vi.mock('./tabs.ts', async (original) => ({
  ...(await original<typeof Tabs>()),
  loaderOf: () => seen.loader,
  drawnFor: () => seen.drawn,
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
    compareFrom: null,
    since: null,
    waiting: null,
    from: 'github',
    files,
    start: null,
    partial: false,
    uncompared: false,
    problem: null,
  };
}

/** Presses `key` with nothing focused, as the system would. */
function press(key: string): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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
  keepPlaces(new Set());
  seen.middles.length = 0;
  seen.reveals.length = 0;
  seen.notes.length = 0;
  seen.recorded.length = 0;
  seen.drawn = undefined;
  seen.beside = false;
  seen.inView = false;
});

afterEach(() => {
  vi.useRealTimers();
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
    // Once, and the note that it waited is taken back.
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual(['diff.view']);
    expect(seen.notes).toEqual(['Reading changed files…', 'withdrawn: Reading changed files…']);
  });

  it('drops the place once it has waited too long', () => {
    vi.useFakeTimers();
    const diff = loader();
    showPlace('t1', 'src/parser.ts', 7);
    vi.advanceTimersByTime(999);
    expect(seen.notes).toEqual(['Reading changed files…']);
    vi.advanceTimersByTime(1);
    // The first note said why; the place goes with nothing more.
    expect(seen.notes).toEqual(['Reading changed files…']);
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual([]);
  });

  it('drops the place, and takes its note back, once the reader does anything else', () => {
    for (const input of [
      new Event(KEY_EVENT),
      new PointerEvent('pointerdown'),
      new WheelEvent('wheel'),
    ]) {
      const diff = loader();
      seen.notes.length = 0;
      showPlace('t1', 'src/parser.ts', 7);
      window.dispatchEvent(input);
      // Moving on isn't a failure: nothing more is said.
      expect(seen.notes).toEqual(['Reading changed files…', 'withdrawn: Reading changed files…']);
      diff.take(state([changed('src/parser.ts')]));
      expect(seen.middles).toEqual([]);
    }
  });

  it('drops the place once a key Lo takes, such as `] b`, ends its sequence', () => {
    const declarations = defineCommands('overview', {
      nextBlock: { label: 'Next block', group: 'View', keys: ['] b'] },
    });
    const commands = handlers(declarations, { nextBlock: { run() {} } });
    onTestFinished(listen(window, new Registry({ system: 'mac', commands })));
    const diff = loader();
    showPlace('t1', 'src/parser.ts', 7);
    press(']');
    expect(seen.notes).toEqual(['Reading changed files…']);
    press('b');
    expect(seen.notes).toEqual(['Reading changed files…', 'withdrawn: Reading changed files…']);
    diff.take(state([changed('src/parser.ts')]));
    expect(seen.middles).toEqual([]);
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

  it('shows a place on the base’s side on the diff’s old side, by the file’s path there', () => {
    const diff = loader();
    const renamed = { ...changed('src/parser.ts'), previous: { text: 'src/parse.ts' } };
    diff.take(state([renamed]));
    showPlace('t1', 'src/parse.ts', 4, { from: 4, to: 4 }, 'old');
    expect(seen.middles).toEqual(['diff.view']);
    const file = diff.ids.of(keyOf(renamed));
    expect(seen.reveals).toEqual([
      { target: { kind: 'line', at: { file, side: 'old', line: 4 } }, focus: true },
    ]);
  });

  it('shows a place on the base’s side of a file the diff leaves alone whole, at the head', () => {
    const diff = loader();
    diff.take(state([changed('src/parser.ts')]));
    // The head's path is no base's: src/parser.ts was src/parse.ts nowhere here.
    showPlace('t1', 'src/format.ts', 2, undefined, 'old');
    expect(seen.middles).toEqual(['diff.whole']);
    expect(seen.reveals).toEqual([]);
    expect(opened.get('t1')).toMatchObject({
      path: { text: 'src/format.ts' },
      version: 'new',
      ask: { at: { kind: 'line', at: { side: 'new', line: 2 } } },
    });
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

/** The diff drawn beside a reading view, which says what was asked of it. */
function drawnDiff() {
  const asked: string[] = [];
  seen.drawn = {
    view: {
      reveal: (at: { kind: string }) => asked.push(`reveal ${at.kind}`),
      revealAtTop: (at: { kind: string }) => asked.push(`top ${at.kind}`),
      openThread: () => true,
      land: (at: { kind: string }) => asked.push(`land ${at.kind}`),
      focus: () => asked.push('focus'),
    },
  };
  seen.beside = true;
  return asked;
}

describe('with code beside', () => {
  it('shows a link’s place where the diff is, its line Landing, with focus in the code', () => {
    const diff = loader();
    diff.take(state([changed('src/parser.ts')]));
    const asked = drawnDiff();
    showPlace('t1', 'src/parser.ts', 7);
    expect(asked).toEqual(['reveal line', 'land line', 'focus']);
    // Nothing switched, and where the tab was is recorded, for ⌃o.
    expect(seen.middles).toEqual([]);
    expect(seen.recorded).toHaveLength(1);
  });

  it('follows with nothing recorded and focus left be, once a key that repeats comes up', () => {
    const diff = loader();
    diff.take(state([changed('src/parser.ts'), changed('src/format.ts')]));
    const asked = drawnDiff();
    showPlace('t1', 'src/parser.ts', 7, undefined, 'new', 'follow');
    expect(asked).toEqual(['reveal line', 'land line']);
    expect(seen.recorded).toEqual([]);
    // A held key: the code waits for its last press.
    asked.length = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', repeat: true }));
    showPlace('t1', 'src/parser.ts', 8, undefined, 'new', 'follow');
    showPlace('t1', 'src/format.ts', 2, undefined, 'new', 'follow');
    expect(asked).toEqual([]);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'j' }));
    expect(asked).toEqual(['reveal line', 'land line']);
    expect(seen.recorded).toEqual([]);
  });

  it('shows a thread the threads panel asks for, its line Landing, focus left in the panel', () => {
    const asked = drawnDiff();
    seen.inView = false;
    expect(showThread('t1', 'T1', 'now')).toBe(true);
    expect(asked).toEqual(['top thread', 'land thread']);
    // From a view, as from the palette there, the code takes focus.
    asked.length = 0;
    seen.inView = true;
    showThread('t1', 'T1', 'now');
    expect(asked).toEqual(['top thread', 'land thread', 'focus']);
  });
});
