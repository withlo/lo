// @vitest-environment jsdom
import { NO_TARGET } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import { IpcError } from '../../../ipc/contract.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Changed, Found, TreeState } from '../contract.ts';
import { Finder } from './Finder.tsx';
import { closeFinder, finderClosed, finderStore } from './finding.ts';
import feature from './index.ts';
import { choices, focus, showState, states } from './store.ts';
import { onShowFile } from './shared.ts';

const TAB: PullTab = { id: 't1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 78 };

// The tab on screen is the pull request's; the tab feature isn't loaded.
const screen = vi.hoisted(() => ({ tab: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => screen.tab,
  useActiveTab: () => screen.tab,
}));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const change = (text: string, how: Changed['change'], previous?: string): Changed => ({
  path: { text },
  change: how,
  previous: previous === undefined ? null : { text: previous },
  generated: null,
});

const TREE: TreeState = {
  id: TAB.id,
  at: '5530830f535b2947f1b50a184dc58a9c7b2845ad',
  listing: {
    kind: 'whole',
    entries: [
      'README.md',
      'src/format.ts',
      'src/parser.ts',
      'src/text/wrap.ts',
      'docs/guide.md',
    ].map((text) => ({ path: { text }, kind: 'file' as const })),
  },
  from: 'local',
  changes: [
    change('src/format.ts', 'modified'),
    change('src/legacy.ts', 'deleted'),
    change('src/parser.ts', 'renamed', 'src/parse.ts'),
  ],
  changesFrom: 'local',
  partial: false,
  problem: null,
  omitted: 0,
};

const found = (text: string, changed: boolean, matched: number[] = []): Found => ({
  path: { text },
  changed,
  matched,
});

/** What main finds: every file for the empty query, the changed ones first. */
const EVERYTHING: Found[] = [
  found('src/format.ts', true),
  found('src/legacy.ts', true),
  found('src/parser.ts', true),
  found('README.md', false),
  found('docs/guide.md', false),
];

/** The query a `tree.find` asks for. */
function queryOf(input: unknown): string {
  return typeof input === 'object' &&
    input !== null &&
    'query' in input &&
    typeof input.query === 'string'
    ? input.query
    : '';
}

const answers: Record<string, (input: unknown) => unknown> = {};
const bridge = installBridge(answers);

/** Answers `tree.find` with `reply`'s files for each query. */
function finding(reply: (query: string) => Found[] = () => EVERYTHING): void {
  answers['tree.find'] = (input) => {
    const query = queryOf(input);
    const files = reply(query);
    return { query, at: TREE.at, found: files, total: files.length };
  };
}

let root: Root | undefined;

beforeEach(() => {
  screen.tab = TAB;
  createRegistry(feature.commands, 'mac');
  bridge.calls.length = 0;
  const page = document.createElement('div');
  page.id = 'root';
  page.className = 'lo-app';
  const middle = document.createElement('main');
  middle.tabIndex = -1;
  page.append(middle);
  document.body.append(page);
  middle.focus();
  root = createRoot(page.appendChild(document.createElement('div')));
  act(() => showState(TREE));
  act(() => root?.render(<Finder />));
  finding();
});

afterEach(async () => {
  act(() => closeFinder());
  act(() => finderClosed());
  act(() => root?.unmount());
  document.body.replaceChildren();
  states.set(TAB.id, undefined);
  focus.set(TAB.id, undefined);
  choices.set(TAB.id, { mode: 'tree', changedOnly: false, opened: new Set(), closed: new Set() });
  screen.tab = undefined;
});

const dialog = () => document.querySelector('[role="dialog"][aria-label="Go to a file"]');
const options = () => [...document.querySelectorAll('[role="option"]')];
const labels = () => options().map((option) => option.textContent);
const field = () => {
  const input = document.querySelector('input[aria-label="Go to a file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('The finder has no field.');
  return input;
};

/** Opens the finder as `⌘P` does, and waits for the first answer. */
async function open() {
  act(() => {
    registry().run('tree.find', NO_TARGET);
  });
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
}

/** Types into the field, as React hears it: through the setter React watches. */
function type(text: string): void {
  act(() => {
    Reflect.set(HTMLInputElement.prototype, 'value', text, field());
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('opening the finder', () => {
  it('lists the changed files first, with how each changed, and the others whole-file', async () => {
    await open();
    expect(dialog()).not.toBeNull();
    expect(bridge.calls).toContainEqual(['tree.find', { id: TAB.id, query: '' }]);
    expect(document.body.textContent).toContain('Changed in this pull request · 3');
    expect(document.body.textContent).toContain('Everywhere else in e2e · 2');
    expect(labels()).toEqual([
      'format.tssrcM',
      'legacy.tssrcD',
      'parser.tssrcR',
      'README.mdwhole file',
      'guide.mddocswhole file',
    ]);
    // An unchanged file is set back; a deleted one is struck through.
    expect(options()[3]?.querySelector('.text-fg-dim')).not.toBeNull();
    expect(options()[1]?.querySelector('.line-through')).not.toBeNull();
    expect(document.body.textContent).toContain('5 of 6 files');
  });

  it('says what ⏎ and the other keys do, in this system’s form', async () => {
    await open();
    const foot = [...document.querySelectorAll('kbd')].map((key) => key.parentElement?.textContent);
    expect(foot).toEqual(
      expect.arrayContaining(['⏎Show in the diff', '⌘⏎Whole file', 'TabChanged only']),
    );
    expect(document.querySelector('input[aria-label="Go to a file"]')).not.toBeNull();
  });

  it('is refused where there’s no pull request on screen', () => {
    screen.tab = undefined;
    expect(registry().enabled('tree.find', NO_TARGET)).toBe('There’s no pull request on screen.');
  });

  it('shows what a search of a long path found, shortened in the middle and not dropped', async () => {
    const long = `${'deep/'.repeat(200)}${'n'.repeat(500)}.ts`;
    finding(() => [found(long, true, [0, long.length - 1])]);
    act(() => {
      registry().run('tree.find', NO_TARGET);
    });
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    const row = options()[0];
    expect(row?.textContent?.length).toBeLessThan(150);
    expect(row?.textContent).toContain('…');
    // The whole path is a tooltip away.
    expect(row?.querySelector('[title]')?.getAttribute('title')).toBe(long);
    expect(row?.querySelectorAll('mark')).toHaveLength(2);
  });
});

describe('searching', () => {
  it('asks main as it’s typed and lists what it finds, marking the letters that matched', async () => {
    await open();
    finding((query) => (query === 'pa' ? [found('src/parser.ts', true, [4, 5])] : EVERYTHING));
    type('pa');
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    expect(bridge.calls.at(-1)).toEqual(['tree.find', { id: TAB.id, query: 'pa' }]);
    expect([...document.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['pa']);
  });

  it('keeps only the newest search’s answer', async () => {
    await open();
    const waiting: ((files: Found[]) => void)[] = [];
    answers['tree.find'] = (input) =>
      new Promise((resolve) => {
        const query = queryOf(input);
        waiting.push((files) => resolve({ query, at: TREE.at, found: files, total: files.length }));
      });
    type('a');
    type('ab');
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    // The newer answer arrives first; the older one, late, is not kept.
    await act(async () => {
      waiting[1]?.([found('src/format.ts', true)]);
      await Promise.resolve();
    });
    await act(async () => {
      waiting[0]?.([found('README.md', false)]);
      await Promise.resolve();
    });
    expect(labels()).toEqual(['format.tssrcM']);
  });

  it('says when nothing matches, and why a search failed', async () => {
    await open();
    finding(() => []);
    type('zzz');
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    await vi.waitFor(() => expect(document.body.textContent).toContain('No file matches "zzz".'));
    answers['tree.find'] = () => {
      throw new IpcError('internal', 'It broke.');
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => error.mockRestore());
    type('zzzz');
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Lo couldn't search the files."),
    );
  });

  it('searches again when the tree moves to another commit', async () => {
    await open();
    const before = bridge.calls.filter(([channel]) => channel === 'tree.find').length;
    act(() => showState({ ...TREE, at: 'a'.repeat(40) }));
    await vi.waitFor(() =>
      expect(bridge.calls.filter(([channel]) => channel === 'tree.find').length).toBe(before + 1),
    );
  });

  it('says it is reading the files before the tree has any', async () => {
    act(() => {
      closeFinder();
    });
    act(() => finderClosed());
    act(() => showState({ ...TREE, at: null, listing: { kind: 'loading' }, changes: null }));
    answers['tree.find'] = () => ({ query: '', at: null, found: [], total: 0 });
    act(() => {
      registry().run('tree.find', NO_TARGET);
    });
    expect(document.body.textContent).toContain('Reading the files…');
  });

  it('says which files it can’t find', async () => {
    act(() =>
      showState({
        ...TREE,
        listing: { kind: 'changed', why: 'GitHub lists only part of this repository’s files.' },
        omitted: 2,
      }),
    );
    await open();
    expect(document.body.textContent).toContain(
      'Only changed files can be found. GitHub lists only part of this repository’s files.',
    );
    expect(document.body.textContent).toContain(
      '2 unchanged files have paths longer than 1,024 bytes, which the finder leaves out.',
    );
  });
});

describe('Tab', () => {
  it('lists only the changed files, then all the matches again', async () => {
    await open();
    act(() => {
      registry().run('tree.findChanged', NO_TARGET);
    });
    expect(labels()).toEqual(['format.tssrcM', 'legacy.tssrcD', 'parser.tssrcR']);
    expect(document.body.textContent).toContain('3 of 3 changed files');
    expect(document.body.textContent).toContain('Changed only');
    const foot = [...document.querySelectorAll('kbd')].map((key) => key.parentElement?.textContent);
    expect(foot).toContain('TabAll files');
    act(() => {
      registry().run('tree.findChanged', NO_TARGET);
    });
    expect(options()).toHaveLength(5);
    // It didn't search again: the answer holds every changed match.
    expect(bridge.calls.filter(([channel]) => channel === 'tree.find')).toHaveLength(1);
  });

  it('says so when no changed file matches', async () => {
    await open();
    finding(() => [found('README.md', false)]);
    type('read');
    await vi.waitFor(() => expect(options()).toHaveLength(1));
    act(() => {
      registry().run('tree.findChanged', NO_TARGET);
    });
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain('No changed file matches "read".');
  });

  it('does nothing while the finder is shut, as in the other palettes', () => {
    expect(registry().run('tree.findChanged', NO_TARGET)).toBe(true);
    expect(registry().run('tree.findWhole', NO_TARGET)).toBe(true);
    expect(finderStore.getState().changedOnly).toBe(false);
    expect(notice()).toBeUndefined();
    expect(dialog()).toBeNull();
  });
});

/** Chooses the row for `text`, as a click or ⏎ on it does. */
function choose(text: string): void {
  const row = options().find((option) => option.textContent?.startsWith(text));
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${text}.`);
  act(() => row.click());
}

describe('going to a file', () => {
  it('reveals a changed file in the tree and asks the diff to show it, then closes', async () => {
    const diff = vi.fn<(tab: string, file: string) => void>();
    onTestFinished(onShowFile('diff', diff));
    await open();
    choose('parser.ts');
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(diff).toHaveBeenCalledWith(TAB.id, 'src/parser.ts');
    // The tree has its folder open and its keyboard on the file.
    expect(focus.get(TAB.id)).toBe('src/parser.ts');
    expect(choices.get(TAB.id).opened.has('src')).toBe(true);
    expect(notice()).toBeUndefined();
  });

  it('reveals a changed file in the tree even while no diff can show it, and says why', async () => {
    await open();
    choose('format.ts');
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(focus.get(TAB.id)).toBe('src/format.ts');
    expect(notice()).toEqual({
      title: 'Show the file',
      body: 'There’s no diff on screen to show it in.',
    });
  });

  it('asks the whole-file view for a file the pull request leaves alone', async () => {
    const whole = vi.fn<(tab: string, file: string) => void>();
    onTestFinished(onShowFile('whole', whole));
    await open();
    choose('README.md');
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(whole).toHaveBeenCalledWith(TAB.id, 'README.md');
  });

  it('refuses an unchanged file until the whole-file view exists, with a reason', async () => {
    await open();
    choose('README.md');
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(notice()).toEqual({
      title: 'Show the file',
      body: 'Lo has no whole-file view to open it in.',
    });
  });

  it('opens the highlighted file whole with ⌘⏎, changed or not', async () => {
    const whole = vi.fn<(tab: string, file: string) => void>();
    onTestFinished(onShowFile('whole', whole));
    await open();
    // The first row is highlighted, and it is a changed file.
    await vi.waitFor(() => expect(options()[0]?.hasAttribute('data-highlighted')).toBe(true));
    act(() => {
      registry().run('tree.findWhole', NO_TARGET);
    });
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(whole).toHaveBeenCalledWith(TAB.id, 'src/format.ts');
  });

  it('refuses ⌘⏎ with a reason while no whole-file view can show the file', async () => {
    await open();
    await vi.waitFor(() => expect(options()[0]?.hasAttribute('data-highlighted')).toBe(true));
    act(() => {
      registry().run('tree.findWhole', NO_TARGET);
    });
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(notice()).toEqual({
      title: 'Whole file',
      body: 'Lo has no whole-file view to open it in.',
    });
  });

  it('says no file is highlighted when nothing matches, and stays open', async () => {
    await open();
    finding(() => []);
    type('zzz');
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    expect(registry().enabled('tree.findWhole', NO_TARGET)).toBe('No file is highlighted.');
    act(() => {
      registry().run('tree.findWhole', NO_TARGET);
    });
    expect(dialog()).not.toBeNull();
  });
});

describe('closing', () => {
  it('gives focus back to where it was', async () => {
    const middle = document.querySelector('main');
    await open();
    expect(document.activeElement).toBe(field());
    act(() => closeFinder());
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(middle);
    expect(finderStore.getState().query).toBe('');
  });

  it('goes when the tab on screen is another, and forgets the query', async () => {
    await open();
    type('pa');
    screen.tab = { ...TAB, id: 't2' };
    act(() => root?.render(<Finder />));
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(finderStore.getState().query).toBe('');
  });
});
