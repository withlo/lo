// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Changed, TreeState } from '../contract.ts';
import { closeRow, move, openRow, setAll, show, showable } from './actions.ts';
import { Files } from './Files.tsx';
import feature from './index.ts';
import { fileOrder, followFile, onShowFile } from './shared.ts';
import { choices, focus, onScreen, showState, shown, states } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
});

const TAB: PullTab = { id: 't1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 };

const change = (text: string, how: Changed['change'], previous?: string): Changed => ({
  path: { text },
  change: how,
  previous: previous === undefined ? null : { text: previous },
  generated: text === 'pnpm-lock.yaml' ? 'lockfile' : null,
});

/** #80's tree, as the local copy has it. */
const LOCAL: TreeState = {
  id: TAB.id,
  at: '57cc4a6dadfa23849df45e1084fd4869401bec53',
  listing: {
    kind: 'whole',
    entries: [
      'README.md',
      'assets/mark.png',
      'data/numbers.txt',
      'pnpm-lock.yaml',
      'src/format.ts',
      'src/parser.ts',
      'src/text/wrap.ts',
      'docs/guide/intro.md',
    ].map((text) => ({ path: { text }, kind: 'file' })),
  },
  from: 'local',
  changes: [
    change('assets/mark.png', 'modified'),
    change('data/numbers.txt', 'added'),
    change('pnpm-lock.yaml', 'modified'),
    change('src/format.ts', 'modified'),
    change('src/legacy.ts', 'deleted'),
    change('src/parser.ts', 'renamed', 'src/parse.ts'),
    change('src/text/wrap.ts', 'added'),
  ],
  changesFrom: 'local',
  partial: false,
  problem: null,
  omitted: 0,
  compared: null,
  start: null,
};

afterEach(() => {
  for (const store of [states, focus, onScreen]) store.set(TAB.id, undefined);
  choices.set(TAB.id, { mode: 'tree', changedOnly: false, opened: new Set(), closed: new Set() });
});

/** The panel for #80's tab, showing `state`. */
function render(state: TreeState = LOCAL) {
  act(() => showState(state));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onRow = vi.fn<(tab: string, key: string, twisty: boolean) => void>();
  act(() => root.render(<Files tab={TAB} onRow={onRow} />));
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  const row = (key: string) => container.querySelector(`[data-key="${CSS.escape(key)}"]`);
  return { container, row, onRow };
}

describe('the files panel', () => {
  it('draws the tree with its marks: changes, a rename’s old name, a closed folder’s count, generated files', () => {
    const { container, row } = render();
    expect(container.querySelector('[role="tree"]')?.getAttribute('data-lo-scope')).toBe('tree');
    expect(row('src')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('docs/guide')?.textContent).toBe('docs/guide');
    expect(row('docs/guide')?.getAttribute('aria-expanded')).toBe('false');
    expect(row('src/parser.ts')?.textContent).toContain('← parse.ts');
    expect(row('src/parser.ts')?.textContent).toContain('R');
    expect(row('src/legacy.ts')?.textContent).toContain('D');
    expect(row('pnpm-lock.yaml')?.textContent).toContain('gen');
    // README.md doesn't change: it's dimmed, with no mark.
    expect(row('README.md')?.className).toContain('text-fg-dim');
    act(() => setAll(TAB.id, false));
    expect(row('src')?.textContent).toContain('4');
  });

  it('says why only the changed files show', () => {
    const { container } = render({
      ...LOCAL,
      listing: { kind: 'changed', why: 'GitHub lists only part of this repository’s files.' },
      partial: true,
    });
    expect(container.querySelector('[role="note"]')?.textContent).toBe(
      'GitHub lists only part of this repository’s files.GitHub lists only some of the changed files, so the rest show once the local copy is ready.',
    );
    expect(container.querySelector('[data-key="README.md"]')).toBeNull();
  });
});

describe('a click', () => {
  it('makes the row clicked the keyboard’s, in the tree, a file’s or a folder’s', () => {
    const { container, row, onRow } = render();
    const tree = container.querySelector<HTMLElement>('[role="tree"]');
    const elsewhere = document.body.appendChild(document.createElement('button'));
    onTestFinished(() => elsewhere.remove());
    for (const key of ['src/format.ts', 'src']) {
      elsewhere.focus();
      // A click with no press before it, as a screen reader's, which focuses nothing itself.
      act(() => {
        row(key)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(focus.get(TAB.id)).toBe(key);
      expect(document.activeElement).toBe(tree);
      expect(tree?.getAttribute('aria-activedescendant')).toBe(row(key)?.id);
      expect(onRow).toHaveBeenLastCalledWith(TAB.id, key, false);
    }
  });
});

describe('following the diff', () => {
  it('marks the file the diff says is on screen, through the stand-in the diff will be', () => {
    const { row } = render();
    act(() => followFile(TAB.id, 'src/parser.ts'));
    expect(row('src/parser.ts')?.getAttribute('aria-current')).toBe('true');
    act(() => followFile(TAB.id, 'data/numbers.txt'));
    expect(row('src/parser.ts')?.getAttribute('aria-current')).toBeNull();
    expect(row('data/numbers.txt')?.getAttribute('aria-current')).toBe('true');
  });

  it('asks the diff to show a changed file, and refuses while no diff can', () => {
    render();
    expect(showable(TAB.id, 'src/format.ts')).toBe('There’s no diff on screen to show it in.');
    expect(showable(TAB.id, 'README.md')).toBe('Lo has no whole-file view to open it in.');
    const diff = vi.fn<(tab: string, file: string) => void>();
    const stop = onShowFile('diff', diff);
    onTestFinished(stop);
    expect(showable(TAB.id, 'src/format.ts')).toBe(true);
    act(() => show(TAB.id, 'src/format.ts'));
    expect(diff).toHaveBeenCalledWith(TAB.id, 'src/format.ts', { text: 'src/format.ts' });
    expect(focus.get(TAB.id)).toBe('src/format.ts');
  });

  it('gives the diff the changed files in the panel’s order, which the mode changes', () => {
    render();
    expect(fileOrder(TAB.id)).toEqual([
      'assets/mark.png',
      'data/numbers.txt',
      'src/text/wrap.ts',
      'src/format.ts',
      'src/legacy.ts',
      'src/parser.ts',
      'pnpm-lock.yaml',
    ]);
    act(() => choices.update(TAB.id, (current) => ({ ...current, mode: 'review' })));
    expect(fileOrder(TAB.id).at(-1)).toBe('pnpm-lock.yaml');
    expect(fileOrder(TAB.id)[0]).toBe('assets/mark.png');
  });
});

describe('the tree’s keys', () => {
  it('move down and up past the ends’ edges, open and close folders, and go to a row’s folder', () => {
    render();
    act(() => move(TAB.id, 1));
    expect(focus.get(TAB.id)).toBe('assets');
    act(() => closeRow(TAB.id));
    expect(choices.get(TAB.id).closed.has('assets')).toBe(true);
    act(() => openRow(TAB.id));
    expect(choices.get(TAB.id).opened.has('assets')).toBe(true);
    // On an open folder, `l` goes into it, and `h` back out.
    act(() => openRow(TAB.id));
    expect(focus.get(TAB.id)).toBe('assets/mark.png');
    act(() => closeRow(TAB.id));
    expect(focus.get(TAB.id)).toBe('assets');
    act(() => move(TAB.id, -1));
    expect(focus.get(TAB.id)).toBe('assets');
  });

  it('open and close every folder, the keyboard going to the outermost one', () => {
    const { row } = render();
    act(() => focus.set(TAB.id, 'src/text/wrap.ts'));
    act(() => setAll(TAB.id, false));
    expect(row('src')?.getAttribute('aria-expanded')).toBe('false');
    expect(focus.get(TAB.id)).toBe('src');
    act(() => setAll(TAB.id, true));
    expect(row('docs/guide')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('src/text')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('the file list keeps its selection when the local copy reorders it', () => {
    // GitHub's list, before .gitattributes marked a.pb.go generated.
    const github: TreeState = {
      ...LOCAL,
      listing: { kind: 'changed', why: 'Only the changed files.' },
      from: 'github',
      changes: [change('a.pb.go', 'modified'), change('b.rs', 'modified')],
      changesFrom: 'github',
    };
    render(github);
    act(() => choices.update(TAB.id, (current) => ({ ...current, mode: 'review' })));
    act(() => move(TAB.id, 1));
    expect(focus.get(TAB.id)).toBe('a.pb.go');
    expect(shown.get(TAB.id)?.rows.findIndex((row) => row.key === 'a.pb.go')).toBe(1);
    act(() =>
      showState({
        ...github,
        from: 'local',
        changesFrom: 'local',
        changes: [
          { ...change('a.pb.go', 'modified'), generated: 'attribute' },
          change('b.rs', 'modified'),
        ],
      }),
    );
    // It lists last, in Generated, still the keyboard's.
    expect(focus.get(TAB.id)).toBe('a.pb.go');
    expect(shown.get(TAB.id)?.rows.findIndex((row) => row.key === 'a.pb.go')).toBe(3);
  });
});
