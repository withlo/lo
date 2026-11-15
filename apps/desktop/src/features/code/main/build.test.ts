// Indexing a tree, on a local copy built in memory: each blob read once however many trees share
// it, the nearest files first past the tree's limits and partial past each, only what the clone has
// when offline, every file read again once the version changes, and what isn't read left out.

import { describe, expect, it } from 'vitest';

import { buildTree, type BuildOptions, type TreeProgress } from './build.ts';
import {
  blobOf,
  commitOf,
  fakeBackground,
  fakeRepo,
  memoryStore,
  type FakeRepo,
} from './test/fake.ts';

const PARSE = `export interface Line { text: string }
export function parse(input: string) { return input.split('\\n') }
`;
const FORMAT = `import { parse } from './parse.ts'
export function format(input: string) { return parse(input).join(' ') }
`;

/** A file of about a kilobyte defining `name`. */
const big = (name: string) => `function ${name}() {}\n${'// filler\n'.repeat(100)}`;

function progress(): TreeProgress {
  return { all: new Set(), done: new Set() };
}

/** Indexes `commit` of `repo`, as the index would for a view showing `changed`. */
async function build(
  repo: FakeRepo,
  commit: string,
  options: Partial<BuildOptions> & { background?: ReturnType<typeof fakeBackground> } = {},
) {
  const background = options.background ?? fakeBackground();
  const store = options.store ?? memoryStore();
  return buildTree({
    repo,
    commit: commitOf(commit),
    changed: [],
    store,
    read: (files) => background.symbols(files),
    version: background.version,
    progress: progress(),
    ...options,
  });
}

describe('indexing a tree', () => {
  it('reads each blob once, however many trees share it', async () => {
    const repo = fakeRepo({
      commits: {
        base: { 'src/parse.ts': PARSE, 'src/format.ts': FORMAT },
        head: { 'src/parse.ts': PARSE, 'src/format.ts': `${FORMAT}// later\n` },
      },
    });
    const background = fakeBackground();
    const store = memoryStore();
    const head = await build(repo, 'head', { background, store, changed: ['src/format.ts'] });
    const base = await build(repo, 'base', { background, store, changed: ['src/format.ts'] });
    expect(background.read).toHaveLength(3);
    expect(background.read.filter((text) => text === PARSE)).toHaveLength(1);
    expect(head).toMatchObject({ total: 2, files: 2, indexed: 2, partial: [] });
    expect(base).toMatchObject({ files: 2, indexed: 2, partial: [] });
    expect(store.store.definitions('v1', head.tree, 'parse', 10)).toMatchObject([
      { path: 'src/parse.ts', line: 2, kind: 'function' },
    ]);
    expect(store.store.referrers('v1', base.tree, 'parse', 10).map((file) => file.path)).toEqual([
      'src/format.ts',
    ]);
  });

  it('reads the files nearest the pull request’s first, and says it’s partial past the tree’s files', async () => {
    const repo = fakeRepo({
      commits: {
        head: {
          'app/web/form.ts': 'function form() {}',
          'app/web/field.ts': 'function field() {}',
          'app/web/inputs/text.ts': 'function text() {}',
          'app/api/route.ts': 'function route() {}',
          'lib/far.ts': 'function far() {}',
          'README.md': '# Not read',
        },
      },
    });
    const background = fakeBackground();
    const built = await build(repo, 'head', {
      background,
      changed: ['app/web/form.ts'],
      limits: { files: 4 },
    });
    expect(built).toMatchObject({ total: 5, files: 4, indexed: 4, partial: ['files'] });
    expect(background.read.toSorted()).toEqual([
      'function field() {}',
      'function form() {}',
      'function route() {}',
      'function text() {}',
    ]);
  });

  it('downloads what the clone lacks, nearest first, and stops at the tree’s cap', async () => {
    const repo = fakeRepo({
      commits: { head: { 'src/a.ts': big('a'), 'src/b.ts': big('b'), 'far/c.ts': big('c') } },
      lacking: ['src/a.ts', 'src/b.ts', 'far/c.ts'],
    });
    const background = fakeBackground();
    const built = await build(repo, 'head', {
      background,
      changed: ['src/a.ts'],
      limits: { bytes: 1500 },
    });
    expect(built.partial).toEqual(['bytes']);
    // One download within the cap brings nothing more once it would pass it.
    expect(repo.downloads.length).toBeGreaterThan(0);
    expect(background.read).toEqual([]);
    expect(repo.lacking.has(blobOf(big('c')))).toBe(true);
  });

  it('reads only what the clone has when it’s offline', async () => {
    const repo = fakeRepo({
      commits: { head: { 'src/parse.ts': PARSE, 'src/format.ts': FORMAT } },
      lacking: ['src/format.ts'],
      offline: true,
    });
    const background = fakeBackground();
    const built = await build(repo, 'head', { background });
    expect(built).toMatchObject({ files: 2, indexed: 1, partial: ['offline'] });
    expect(background.read).toEqual([PARSE]);
    expect(repo.downloads).toEqual([]);
  });

  it('reads every file again once the grammars or queries change, and not before', async () => {
    const repo = fakeRepo({
      commits: { head: { 'src/parse.ts': PARSE, 'src/format.ts': FORMAT } },
    });
    const store = memoryStore();
    const first = fakeBackground({ version: 'v1' });
    await build(repo, 'head', { background: first, store });
    await build(repo, 'head', { background: first, store });
    expect(first.read).toHaveLength(2);
    const changed = fakeBackground({ version: 'v2' });
    const built = await build(repo, 'head', { background: changed, store });
    expect(changed.read).toHaveLength(2);
    expect(store.store.definitions('v2', built.tree, 'format', 10)).toHaveLength(1);
  });

  it('leaves out lockfiles, generated files and files past 1 MB, and keeps a file a job fails on as failed', async () => {
    const repo = fakeRepo({
      commits: {
        head: {
          'src/parse.ts': PARSE,
          'src/schema.ts': 'function generated() {}',
          'src/huge.ts': `function huge() {}\n${'x'.repeat(1024 * 1024)}`,
          'src/hang.ts': 'function hang() {}',
          'package-lock.json': '{}',
        },
      },
      generated: ['src/schema.ts'],
      // Its size is known only once it's downloaded.
      lacking: ['src/huge.ts'],
    });
    const background = fakeBackground({ fail: (text) => text.includes('hang') });
    const store = memoryStore();
    const built = await build(repo, 'head', { background, store });
    expect(built.total).toBe(3);
    expect(background.read).toEqual([PARSE]);
    expect(
      store.store.kept('v1', { oid: blobOf('function hang() {}'), language: 'typescript' }),
    ).toMatchObject({ skipped: 'failed' });
    const huge = blobOf(`function huge() {}\n${'x'.repeat(1024 * 1024)}`);
    expect(store.store.kept('v1', { oid: huge, language: 'typescript' })).toMatchObject({
      skipped: 'too-long',
    });
    // A job that failed was tried again in halves, so the file beside the one it failed on was read.
    expect(background.jobs).toEqual([2, 1, 1]);
  });
});
