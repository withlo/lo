// The syntax index's store: readings kept per blob and stamped with a version, trees' files, lookups
// by name within one tree, and its cap, which lets go of what no open view holds first. And the
// worker thread main asks it through.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import type { FileSymbols } from '../../jobs.ts';
import { storeWorker } from './client.ts';
import { Store, type Reading } from './store.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

function symbols(change: Partial<FileSymbols> = {}): FileSymbols {
  return { definitions: [], references: [], imports: [], ...change };
}

function reading(oid: string, read: Reading['read'], language = 'typescript'): Reading {
  return { oid, language, read };
}

/** The ID of the `index`th blob. */
const blob = (index: number) => index.toString(16).padStart(40, '0');

function opened(): Store {
  const store = new Store(':memory:');
  onTestFinished(() => store.close());
  return store;
}

describe('the store', () => {
  it('keeps a blob’s reading at its version, and nothing at another, which reads it again', () => {
    const store = opened();
    const parse = symbols({
      definitions: [
        { name: 'Parser', kind: 'class', line: 1, column: 13, lastLine: 9 },
        { name: 'parse', kind: 'method', line: 2, column: 2, lastLine: 4, parent: 0 },
      ],
      references: ['Line', 'split'],
      imports: [{ line: 1, module: './line.ts', names: [{ name: 'Line' }] }],
    });
    store.put('v1', [reading(A, { symbols: parse }), reading(B, { skipped: 'minified' })]);
    const blobs = [
      { oid: A, language: 'typescript' },
      { oid: B, language: 'typescript' },
      { oid: A, language: 'python' },
    ];
    // B was skipped, which a tree's count of files leaves out.
    expect(store.fresh('v1', blobs)).toEqual({ found: [0, 1], skipped: [1] });
    expect(store.fresh('v2', blobs)).toEqual({ found: [], skipped: [] });
    expect(store.kept('v1', blobs[0]!)).toEqual({
      skipped: undefined,
      definitions: parse.definitions,
      imports: parse.imports,
      namespace: undefined,
    });
    expect(store.kept('v1', blobs[1]!)).toMatchObject({ skipped: 'minified', definitions: [] });
    expect(store.kept('v2', blobs[0]!)).toBe(undefined);

    // Read again at a new version, it replaces what was kept.
    store.put('v2', [reading(A, { symbols: symbols({ references: ['other'] }) })]);
    expect(store.fresh('v2', blobs)).toEqual({ found: [0], skipped: [] });
    expect(store.kept('v2', blobs[0]!)?.definitions).toEqual([]);
  });

  it('finds a name’s definitions and the files that use it, in one tree alone', () => {
    const store = opened();
    store.put('v1', [
      reading(A, {
        symbols: symbols({
          definitions: [{ name: 'parse', kind: 'function', line: 3, column: 16, lastLine: 5 }],
        }),
      }),
      reading(B, { symbols: symbols({ references: ['parse'] }) }),
      reading(C, {
        symbols: symbols({
          definitions: [{ name: 'parse', kind: 'function', line: 1, column: 0, lastLine: 1 }],
          references: ['parse'],
        }),
      }),
    ]);
    store.setTree('t1', [
      { path: 'src/parse.ts', oid: A, language: 'typescript' },
      { path: 'src/format.ts', oid: B, language: 'typescript' },
    ]);
    store.setTree('t2', [{ path: 'old/parse.ts', oid: C, language: 'typescript' }]);
    expect(store.definitions('v1', 't1', 'parse', 10)).toEqual([
      {
        path: 'src/parse.ts',
        oid: A,
        name: 'parse',
        kind: 'function',
        line: 3,
        column: 16,
        lastLine: 5,
      },
    ]);
    expect(store.referrers('v1', 't1', 'parse', 10)).toEqual([
      { path: 'src/format.ts', oid: B, language: 'typescript' },
    ]);
    expect(store.definitions('v1', 't2', 'parse', 10).map((found) => found.path)).toEqual([
      'old/parse.ts',
    ]);
    // Not at another version, nor under another name.
    expect(store.definitions('v2', 't1', 'parse', 10)).toEqual([]);
    expect(store.referrers('v1', 't1', 'format', 10)).toEqual([]);
    expect(store.tree('t1')?.map((file) => file.path)).toEqual(['src/format.ts', 'src/parse.ts']);
  });

  it('keeps under its cap by letting go of the trees, then the blobs, no open view holds', () => {
    let clock = 0;
    const store = new Store(':memory:', () => (clock += 1));
    onTestFinished(() => store.close());
    const names = Array.from({ length: 400 }, (_, index) => `name${index}`);
    // Three trees of 30 blobs each, each blob referring to many names.
    for (const tree of ['old', 'open', 'newer']) {
      const files = Array.from({ length: 30 }, (_, index) => ({
        path: `${tree}/${index}.ts`,
        oid: blob(tree === 'open' ? index : tree === 'old' ? 100 + index : 200 + index),
        language: 'typescript',
      }));
      store.put(
        'v1',
        files.map((file) => reading(file.oid, { symbols: symbols({ references: names }) })),
      );
      store.setTree(tree, files);
    }
    const before = store.used();
    expect(store.trim(['open'], before)).toEqual({ trees: 0, blobs: 0 });
    const gone = store.trim(['open'], Math.floor(before / 2));
    expect(gone.trees).toBeGreaterThan(0);
    expect(gone.blobs).toBeGreaterThan(0);
    // What the open tree holds stays, whatever the cap.
    store.trim(['open'], 1);
    expect(store.tree('open')).toHaveLength(30);
    expect(store.tree('old')).toBe(undefined);
    expect(store.referrers('v1', 'open', 'name7', 100)).toHaveLength(30);
    expect(store.fresh('v1', [{ oid: blob(150), language: 'typescript' }]).found).toEqual([]);
  });

  it('lets go of everything once cleared, as clearing the cache does', () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-symbols-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const store = new Store(join(folder, 'code', 'symbols.db'));
    onTestFinished(() => store.close());
    store.put('v1', [reading(A, { symbols: symbols({ references: ['parse'] }) })]);
    store.setTree('t1', [{ path: 'a.ts', oid: A, language: 'typescript' }]);
    store.clear();
    expect(store.fresh('v1', [{ oid: A, language: 'typescript' }]).found).toEqual([]);
    expect(store.tree('t1')).toBe(undefined);
  });
});

describe('the store’s worker', () => {
  it('answers main’s questions off its thread, and stops', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-symbols-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const store = storeWorker(
      new URL('./worker.ts', import.meta.url),
      join(folder, 'code', 'symbols.db'),
    );
    await store.put('v1', [reading(A, { symbols: symbols({ references: ['parse'] }) })]);
    await store.setTree('t1', [{ path: 'a.ts', oid: A, language: 'typescript' }]);
    expect(await store.referrers('v1', 't1', 'parse', 10)).toEqual([
      { path: 'a.ts', oid: A, language: 'typescript' },
    ]);
    await store.stop();
    await expect(store.tree('t1')).resolves.toMatchObject([{ path: 'a.ts' }]);
    await store.stop();
  });
});
