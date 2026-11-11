import { describe, expect, it } from 'vitest';

import type { Change, Changed, Entry, TreeState } from '../contract.ts';
import {
  foldersOf,
  model,
  NO_CHOICES,
  panelOrder,
  parentRow,
  type Row,
  type Viewed,
} from './model.ts';

const file = (text: string): Entry => ({ path: { text }, kind: 'file' });

function changed(text: string, change: Change, previous?: string): Changed {
  return {
    path: { text },
    change,
    previous: previous === undefined ? null : { text: previous },
    generated: text.endsWith('.lock') || text.endsWith('-lock.yaml') ? 'lockfile' : null,
  };
}

/** A tree of every file in `files`, with `changes` marked. */
function whole(files: readonly string[], changes: readonly Changed[]): TreeState {
  return {
    id: 't1',
    at: 'a'.repeat(40),
    listing: { kind: 'whole', entries: files.map(file) },
    from: 'local',
    changes: [...changes],
    changesFrom: 'local',
    partial: false,
    problem: null,
    omitted: 0,
  };
}

/** Each row as a line: indented by depth, a folder's twisty, a file's marks. */
function lines(rows: readonly Row[]): string[] {
  return rows.map((row) => {
    const indent = '  '.repeat(row.kind === 'group' ? 0 : row.depth);
    switch (row.kind) {
      case 'group':
        return `# ${row.label}`;
      case 'folder':
        return `${indent}${row.open ? 'v' : '>'} ${row.names.join('/')}${row.open || row.changes === 0 ? '' : ` (${row.changes})`}${row.loading ? ' …' : ''}`;
      case 'file': {
        const marks = [
          row.change === undefined ? 'dim' : row.change[0]?.toUpperCase(),
          row.previous === undefined ? undefined : `← ${row.previous}`,
          row.generated === null ? undefined : 'gen',
          row.viewed,
          row.folder === undefined || row.folder === '' ? undefined : `in ${row.folder}`,
        ].filter((mark) => mark !== undefined);
        return `${indent}${row.name} [${marks.join(', ')}]`;
      }
      default:
        row satisfies never;
        return '';
    }
  });
}

/** The e2e pull request's repository and changes, as the local copy lists them. */
const E2E = whole(
  [
    'README.md',
    'assets/mark.png',
    'data/numbers.txt',
    'pnpm-lock.yaml',
    'src/format.ts',
    'src/parser.ts',
    'src/text/wrap.ts',
    'docs/guide/intro.md',
  ],
  [
    changed('assets/mark.png', 'modified'),
    changed('data/numbers.txt', 'added'),
    changed('pnpm-lock.yaml', 'modified'),
    changed('src/format.ts', 'modified'),
    changed('src/legacy.ts', 'deleted'),
    changed('src/parser.ts', 'renamed', 'src/parse.ts'),
    changed('src/text/wrap.ts', 'added'),
  ],
);

const none = new Map<string, Viewed>();

describe('the tree', () => {
  it('opens folders with changes and closes the rest, dims unchanged files and keeps deletions in place', () => {
    expect(lines(model(E2E, new Map(), none, NO_CHOICES).rows)).toEqual([
      'v assets',
      '  mark.png [M]',
      'v data',
      '  numbers.txt [A]',
      '> docs/guide',
      'v src',
      '  v text',
      '    wrap.ts [A]',
      '  format.ts [M]',
      '  legacy.ts [D]',
      '  parser.ts [R, ← parse.ts]',
      'README.md [dim]',
      'pnpm-lock.yaml [M, gen]',
    ]);
  });

  it('puts a chain of folders with one folder each on one line, and counts a closed one’s changes', () => {
    const state = whole(
      ['.github/workflows/ci.yml', 'src/graphql/cost/a.ts', 'src/graphql/cost/b.ts', 'x.ts'],
      [
        changed('.github/workflows/ci.yml', 'modified'),
        changed('src/graphql/cost/a.ts', 'added'),
        changed('src/graphql/cost/b.ts', 'added'),
      ],
    );
    const closed = { ...NO_CHOICES, closed: new Set(['src/graphql/cost', '.github/workflows']) };
    expect(lines(model(state, new Map(), none, closed).rows)).toEqual([
      '> .github/workflows (1)',
      '> src/graphql/cost (2)',
      'x.ts [dim]',
    ]);
  });

  it('shows only the changed files, still as a tree, when asked', () => {
    const rows = model(E2E, new Map(), none, { ...NO_CHOICES, changedOnly: true }).rows;
    expect(lines(rows)).toEqual([
      'v assets',
      '  mark.png [M]',
      'v data',
      '  numbers.txt [A]',
      'v src',
      '  v text',
      '    wrap.ts [A]',
      '  format.ts [M]',
      '  legacy.ts [D]',
      '  parser.ts [R, ← parse.ts]',
      'pnpm-lock.yaml [M, gen]',
    ]);
  });

  it('opens and closes folders by hand, whatever their changes', () => {
    const choices = { ...NO_CHOICES, opened: new Set(['docs/guide']), closed: new Set(['src']) };
    expect(lines(model(E2E, new Map(), none, choices).rows)).toEqual([
      'v assets',
      '  mark.png [M]',
      'v data',
      '  numbers.txt [A]',
      'v docs/guide',
      '  intro.md [dim]',
      '> src (4)',
      'README.md [dim]',
      'pnpm-lock.yaml [M, gen]',
    ]);
  });

  it('names a rename’s old path when it moved to another folder', () => {
    const state = whole(['b/x.ts'], [changed('b/x.ts', 'renamed', 'a/x.ts')]);
    expect(lines(model(state, new Map(), none, NO_CHOICES).rows)).toEqual([
      'v b',
      '  x.ts [R, ← a/x.ts]',
    ]);
  });

  it('shows GitHub’s viewed marks, a rename’s by its old path too', () => {
    const viewed = new Map<string, Viewed>([
      ['src/format.ts', 'viewed'],
      ['src/parse.ts', 'dismissed'],
      ['data/numbers.txt', 'unviewed'],
    ]);
    const rows = model(E2E, new Map(), viewed, { ...NO_CHOICES, changedOnly: true }).rows;
    expect(lines(rows)).toContain('  format.ts [M, viewed]');
    expect(lines(rows)).toContain('  parser.ts [R, ← parse.ts, dismissed]');
    expect(lines(rows)).toContain('  numbers.txt [A, unviewed]');
  });

  it('lists every folder it knows, for opening or closing them all', () => {
    expect(model(E2E, new Map(), none, NO_CHOICES).folders.toSorted()).toEqual([
      'assets',
      'data',
      'docs',
      'docs/guide',
      'src',
      'src/text',
    ]);
  });

  it('shows only the changed files when that’s all main has, saying why', () => {
    const state: TreeState = {
      ...E2E,
      listing: { kind: 'changed', why: 'GitHub lists only part of this repository’s files.' },
    };
    expect(lines(model(state, new Map(), none, NO_CHOICES).rows)).toEqual(
      lines(model(E2E, new Map(), none, { ...NO_CHOICES, changedOnly: true }).rows),
    );
  });
});

describe('a tree whose files are on their way', () => {
  it('shows the changed files already known, and asks for no folder', () => {
    const state: TreeState = {
      ...E2E,
      listing: { kind: 'loading' },
      changes: [changed('src/text/wrap.ts', 'added'), changed('README.md', 'modified')],
    };
    const shown = model(state, new Map(), none, NO_CHOICES);
    expect(lines(shown.rows)).toEqual(['v src/text', '  wrap.ts [A]', 'README.md [M]']);
    expect(shown.wanted).toEqual([]);
  });
});

describe('a tree sent folder by folder', () => {
  const state: TreeState = {
    ...E2E,
    listing: {
      kind: 'folders',
      root: [
        { path: { text: 'src' }, kind: 'folder' },
        { path: { text: 'docs' }, kind: 'folder' },
        file('README.md'),
      ],
    },
    changes: [changed('src/text/wrap.ts', 'added')],
  };

  it('asks for the open folders it has nothing of, which show as loading with their changed files', () => {
    const shown = model(state, new Map(), none, NO_CHOICES);
    expect(lines(shown.rows)).toEqual([
      '> docs',
      'v src …',
      '  v text …',
      '    wrap.ts [A]',
      'README.md [dim]',
    ]);
    expect(shown.wanted).toEqual([{ text: 'src' }, { text: 'src/text' }]);
  });

  it('shows what main sent of each, and puts a chain together only once it knows the whole of it', () => {
    const sent = new Map<string, Entry[]>([
      ['src', [{ path: { text: 'src/text' }, kind: 'folder' }]],
    ]);
    const shown = model(state, sent, none, NO_CHOICES);
    // src has only text in it; text hasn't come yet.
    expect(lines(shown.rows)).toEqual([
      '> docs',
      'v src/text …',
      '  wrap.ts [A]',
      'README.md [dim]',
    ]);
    expect(shown.wanted).toEqual([{ text: 'src/text' }]);
    sent.set('src/text', [file('src/text/wrap.ts'), file('src/text/fill.ts')]);
    expect(lines(model(state, sent, none, NO_CHOICES).rows)).toEqual([
      '> docs',
      'v src/text',
      '  fill.ts [dim]',
      '  wrap.ts [A]',
      'README.md [dim]',
    ]);
  });
});

describe('review order', () => {
  it('lists the changed files flat, in groups, each test under the file it tests', () => {
    const state = whole(
      [],
      [
        changed('src/parse.test.ts', 'added'),
        changed('src/parse.ts', 'modified'),
        changed('package.json', 'modified'),
        changed('pnpm-lock.yaml', 'modified'),
        changed('README.md', 'modified'),
      ],
    );
    const shown = model(state, new Map(), none, { ...NO_CHOICES, mode: 'review' });
    expect(lines(shown.rows)).toEqual([
      '# Source and tests',
      'README.md [M]',
      'parse.ts [M, in src]',
      '  parse.test.ts [A, in src]',
      '# Config',
      'package.json [M]',
      '# Generated',
      'pnpm-lock.yaml [M, gen]',
    ]);
    expect(shown.order).toEqual([
      'README.md',
      'src/parse.ts',
      'src/parse.test.ts',
      'package.json',
      'pnpm-lock.yaml',
    ]);
  });
});

describe('panelOrder', () => {
  it('follows the tree: each folder’s folders, then its files, by name', () => {
    expect(panelOrder(E2E.changes ?? [], 'tree')).toEqual([
      'assets/mark.png',
      'data/numbers.txt',
      'src/text/wrap.ts',
      'src/format.ts',
      'src/legacy.ts',
      'src/parser.ts',
      'pnpm-lock.yaml',
    ]);
    expect(model(E2E, new Map(), none, NO_CHOICES).order).toEqual(
      panelOrder(E2E.changes ?? [], 'tree'),
    );
  });
});

describe('rows', () => {
  it('finds the folder a row is in', () => {
    const { rows } = model(E2E, new Map(), none, NO_CHOICES);
    const wrap = rows.findIndex((row) => row.key === 'src/text/wrap.ts');
    expect(rows[parentRow(rows, wrap)]?.key).toBe('src/text');
    expect(rows[parentRow(rows, parentRow(rows, wrap))]?.key).toBe('src');
    expect(parentRow(rows, 0)).toBe(-1);
  });

  it('names the folders that hold a path, outermost first', () => {
    expect(foldersOf({ text: 'src/text/wrap.ts' })).toEqual(['src', 'src/text']);
    expect(foldersOf({ text: 'README.md' })).toEqual([]);
  });
});

describe('a deleted file’s folder that the head no longer has', () => {
  it('shows once main has said it has nothing of it', () => {
    const state: TreeState = {
      ...E2E,
      listing: { kind: 'folders', root: [file('README.md')] },
      changes: [changed('old/x.ts', 'deleted')],
    };
    expect(model(state, new Map(), none, NO_CHOICES).wanted).toEqual([{ text: 'old' }]);
    const answered = new Map<string, Entry[]>([['old', []]]);
    const shown = model(state, answered, none, NO_CHOICES);
    expect(shown.wanted).toEqual([]);
    expect(lines(shown.rows)).toEqual(['v old', '  x.ts [D]', 'README.md [dim]']);
  });
});

describe('paths too long to key a map by', () => {
  it('are left out, quickly, however many there are', () => {
    // 4,000 files under a folder of 8,200 bytes that aren't UTF-8, keyed by their bytes in hex:
    // over 16,400 characters each, which a map would hash by their length alone.
    const folder = 'e9'.repeat(8_200);
    const entries: Entry[] = Array.from({ length: 4_000 }, (_, index) => ({
      path: {
        text: `${'\uFFFD'.repeat(8_200)}/f${index}.txt`,
        hex: `${folder}2f${Buffer.from(`f${index}.txt`).toString('hex')}`,
      },
      kind: 'file',
    }));
    const state: TreeState = {
      ...E2E,
      listing: { kind: 'whole', entries: [...entries, file('README.md')] },
      changes: [{ ...changed('x', 'added'), path: entries[0]?.path ?? { text: 'x' } }],
    };
    const start = performance.now();
    const shown = model(state, new Map(), none, NO_CHOICES);
    const closed = model(state, new Map(), none, { ...NO_CHOICES, changedOnly: true });
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(lines(shown.rows)).toEqual(['README.md [dim]']);
    expect(shown.omitted).toBe(4_000);
    expect(closed.omitted).toBe(4_000);
    expect(panelOrder(state.changes ?? [], 'tree')).toEqual([]);
  });

  it('drop a rename’s old path, keeping the change', () => {
    const state = whole(['b.ts'], [changed('b.ts', 'renamed', `a/${'x'.repeat(2_000)}.ts`)]);
    expect(lines(model(state, new Map(), none, NO_CHOICES).rows)).toEqual(['b.ts [R]']);
  });
});

describe('names with bidirectional controls', () => {
  it('show without the controls that would turn the text after them around', () => {
    const name = 'invoice\u202Etxt.exe';
    const state = whole(
      [`a\u2067b/${name}`],
      [changed(`a\u2067b/${name}`, 'renamed', `a\u2067b/old\u202Dname.ts`)],
    );
    const rows = model(state, new Map(), none, NO_CHOICES).rows;
    expect(lines(rows)).toEqual(['v ab', '  invoicetxt.exe [R, ← oldname.ts]']);
    // The key, which names the file, stays the path as it is.
    expect(rows[1]?.key).toBe(`a\u2067b/${name}`);
    const review = model(state, new Map(), none, { ...NO_CHOICES, mode: 'review' }).rows;
    expect(lines(review)).toContain('invoicetxt.exe [R, ← oldname.ts, in ab]');
  });
});
