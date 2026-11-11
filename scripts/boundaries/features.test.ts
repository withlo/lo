import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, onTestFinished, test } from 'vitest';

import type { Violation } from './check.ts';
import { checkFeatures } from './features.ts';

const features = 'apps/desktop/src/features';

/** Writes a made-up workspace to a temporary folder and checks its features. */
function check(files: Record<string, string>, links: Record<string, string> = {}): Violation[] {
  const root = mkdtempSync(join(tmpdir(), 'lo-features-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
  }
  return checkFeatures(root);
}

/** The `tree` feature's files, each exporting something, for the `diff` feature to import. */
const tree = Object.fromEntries(
  [
    'contract.ts',
    'keys.ts',
    'service.ts',
    'jobs.ts',
    'main/index.ts',
    'main/store.ts',
    'window/index.ts',
    'window/shared.ts',
    'window/store.ts',
    'window/Tree.tsx',
    'migrations/001-tree.sql',
  ].map((file) => [`${features}/tree/${file}`, `export const x = 1;`]),
);

/** The diff feature's main code, importing `specifier`. */
const diffImporting = (source: string) => ({
  ...tree,
  [`${features}/diff/main/index.ts`]: source,
});

/** A violation at `where` whose message contains `text`. */
function violation(where: string, text: string) {
  return { where, message: expect.stringContaining(text) };
}

const at = (line = 1) => `${features}/diff/main/index.ts:${line}`;

test("a feature imports its own files and others' shared files", () => {
  expect(
    check({
      ...tree,
      [`${features}/diff/main/index.ts`]: [
        `import { x } from './store.ts';`,
        `import { contract } from '../contract.ts';`,
        `import { contract as trees } from '../../tree/contract.ts';`,
        `import type { TreeAccess } from '../../tree/service.ts';`,
        `export * from '../../tree/keys.ts';`,
        `const sql = import.meta.glob('../migrations/*.sql', { query: '?raw' });`,
        `const services = import.meta.glob('../../*/service.ts', { eager: true });`,
        `import { z } from 'zod';`,
        `import { app } from 'electron';`,
        `import { defineFeature } from '../../../main/features.ts';`,
      ].join('\n'),
      [`${features}/diff/window/index.ts`]: [
        `import { middle } from '../../tree/window/shared.ts';`,
        `const lazy = await import('../../tree/window/shared.ts');`,
      ].join('\n'),
      [`${features}/diff/main/store.ts`]: `export const x = 1;`,
      [`${features}/diff/contract.ts`]: `export const contract = 1;`,
      [`${features}/diff/migrations/001-diff.sql`]: `create table diff_files (id integer);`,
    }),
  ).toEqual([]);
});

test("code outside the features isn't held to the rule", () => {
  expect(
    check({
      ...tree,
      'apps/desktop/src/main/index.ts': [
        `const features = import.meta.glob('../features/*/main/index.ts', { eager: true });`,
        `import { x } from '../features/tree/main/store.ts';`,
      ].join('\n'),
      'apps/desktop/src/window/commands/overlays.test.tsx': `import tree from '../../features/tree/window/index.ts';`,
      [`${features}/contracts.test.ts`]: `const all = import.meta.glob('./*/main/index.ts');`,
      'apps/desktop/e2e/tree.spec.ts': `import { x } from '../src/features/tree/window/store.ts';`,
    }),
  ).toEqual([]);
});

describe("a feature can't reach another's other files", () => {
  test('by import, re-export, type, require or reference', () => {
    expect(
      check(
        diffImporting(
          [
            `import { x } from '../../tree/main/store.ts';`,
            `export { x as y } from '../../tree/window/store.ts';`,
            `export * from '../../tree/main/index.ts';`,
            `import type { X } from '../../tree/window/Tree.tsx';`,
            `type Y = typeof import('../../tree/jobs.ts');`,
            `const z = await import('../../tree/window/index.ts');`,
            `const w = require('../../tree/main/index.ts');`,
            `/// <reference path="../../tree/window/store.ts" />`,
            `import sql from '../../tree/migrations/001-tree.sql?raw';`,
          ].join('\n'),
        ),
      ),
    ).toEqual([
      violation(
        at(1),
        `imports ../../tree/main/store.ts: that's main/store.ts in the tree feature`,
      ),
      violation(at(2), `that's window/store.ts in the tree feature`),
      violation(at(3), `that's main/index.ts in the tree feature`),
      violation(at(4), `that's window/Tree.tsx in the tree feature`),
      violation(at(5), `that's jobs.ts in the tree feature`),
      violation(at(6), `that's window/index.ts in the tree feature`),
      violation(at(7), `that's main/index.ts in the tree feature`),
      violation(at(8), `references ../../tree/window/store.ts: that's window/store.ts`),
      violation(at(9), `that's migrations/001-tree.sql in the tree feature`),
    ]);
  });

  test('and the message names the files a feature shares', () => {
    expect(check(diffImporting(`import { x } from '../../tree/main/store.ts';`))).toEqual([
      {
        where: at(),
        message:
          "imports ../../tree/main/store.ts: that's main/store.ts in the tree feature, and features share only their contract.ts, keys.ts, service.ts and window/shared.ts.",
      },
    ]);
  });

  test('from its tests too', () => {
    expect(
      check({
        ...tree,
        [`${features}/diff/main/index.test.ts`]: `import { x } from '../../tree/main/store.ts';`,
      }),
    ).toEqual([
      violation(
        `${features}/diff/main/index.test.ts:1`,
        `that's main/store.ts in the tree feature`,
      ),
    ]);
  });

  test('by a path that goes the long way round', () => {
    expect(
      check(
        diffImporting(
          [
            `import { a } from '../../diff/../tree/main/store.ts';`,
            `import { b } from '../../../features/tree/main/store.ts';`,
            `import { c } from '../../../../src/features/tree/./main/store.ts';`,
            `import { d } from '../../tree/main/../window/store.ts';`,
          ].join('\n'),
        ),
      ),
    ).toEqual([
      violation(at(1), `that's main/store.ts in the tree feature`),
      violation(at(2), `that's main/store.ts in the tree feature`),
      violation(at(3), `that's main/store.ts in the tree feature`),
      violation(at(4), `that's window/store.ts in the tree feature`),
    ]);
  });

  test('through a symlink, to a file or a folder', () => {
    expect(
      check(
        {
          ...diffImporting(
            [
              `import { a } from './tree.ts';`,
              `import { b } from './trees/store.ts';`,
              `import { c } from '../../../window/tree.ts';`,
            ].join('\n'),
          ),
        },
        {
          [`${features}/diff/main/tree.ts`]: '../../tree/main/store.ts',
          [`${features}/diff/main/trees`]: '../../tree/window',
          'apps/desktop/src/window/tree.ts': '../features/tree/window/store.ts',
        },
      ),
    ).toEqual([
      violation(at(1), `imports ./tree.ts: that's main/store.ts in the tree feature`),
      violation(at(2), `imports ./trees/store.ts: that's window/store.ts in the tree feature`),
      violation(at(3), `imports ../../../window/tree.ts: that's window/store.ts`),
    ]);
  });

  test("through a symlink in another feature's shared files", () => {
    const files: Record<string, string> = diffImporting(
      `import { a } from '../../tree/window/shared.ts';`,
    );
    delete files[`${features}/tree/window/shared.ts`];
    expect(
      check(
        { ...files, [`${features}/open/window/store.ts`]: `export const a = 1;` },
        // tree's shared file may stand for its own internals, but not for a third feature's.
        { [`${features}/tree/window/shared.ts`]: '../../open/window/store.ts' },
      ),
    ).toEqual([violation(at(), `that's window/store.ts in the open feature`)]);
  });

  test('through an installed package, or the app’s imports', () => {
    expect(
      check(
        {
          ...diffImporting(
            [
              `import { a } from 'trees/main/store.ts';`,
              `import { b } from '#tree/window/store.ts';`,
              `import { c } from '#store';`,
              `import { d } from '#shared';`,
            ].join('\n'),
          ),
          'apps/desktop/package.json': JSON.stringify({
            name: '@lo/desktop',
            imports: {
              '#tree/*': './src/features/tree/*',
              '#store': { node: './src/features/tree/main/store.ts', default: './x.ts' },
              '#shared': './src/features/tree/window/shared.ts',
            },
          }),
        },
        { 'apps/desktop/node_modules/trees': '../src/features/tree' },
      ),
    ).toEqual([
      violation(at(1), `imports trees/main/store.ts: that's main/store.ts in the tree feature`),
      violation(at(2), `imports #tree/window/store.ts: that's window/store.ts`),
      violation(at(3), `imports #store: that's main/store.ts in the tree feature`),
    ]);
  });

  test('by a module chosen at run time', () => {
    expect(
      check(diffImporting(`const tree = await import(\`../../\${name}/main/store.ts\`);`)),
    ).toEqual([violation(at(), 'the module is chosen at run time')]);
  });

  test('by a glob', () => {
    expect(
      check(
        diffImporting(
          [
            `const mains = import.meta.glob('../../*/main/index.ts', { eager: true });`,
            `const all = import.meta.glob(['../../*/service.ts', '../../tree/**/*.ts']);`,
            `const keys = import.meta.glob(['../../*/keys.ts', '!../../tree/keys.ts']);`,
            `const rooted = import.meta.glob('/src/features/*/service.ts');`,
          ].join('\n'),
        ),
      ),
    ).toEqual([
      violation(
        at(1),
        `globs ../../*/main/index.ts, which matches ../../tree/main/index.ts: that's main/index.ts in the tree feature`,
      ),
      violation(at(2), `globs ../../tree/**/*.ts, which matches ../../tree/jobs.ts`),
      violation(at(4), `globs /src/features/*/service.ts: a feature's globs start with ./ or ../`),
    ]);
  });
});

describe("a feature can't reach another's other files", () => {
  test("through the other feature's folder itself, which loads its index", () => {
    expect(
      check(
        diffImporting(
          [
            `import tree from '../../tree';`,
            `const lazy = await import('../../tree/');`,
            `import { x } from '../../tree/window';`,
          ].join('\n'),
        ),
      ),
    ).toEqual([
      violation(
        at(1),
        `imports ../../tree: that's the tree feature's folder, which loads its index`,
      ),
      violation(at(2), `imports ../../tree/: that's the tree feature's folder`),
      violation(at(3), `imports ../../tree/window: that's window/ in the tree feature`),
    ]);
  });

  test('from any file Vite could bundle, in whatever folder it sits', () => {
    const store = `import { x } from '../../tree/main/store.ts';`;
    expect(
      check({
        ...tree,
        [`${features}/diff/fixtures/store.ts`]: store,
        [`${features}/diff/.hidden/store.ts`]: store,
        [`${features}/diff/dist/store.js`]: store,
        [`${features}/diff/node_modules/store.mjs`]: store,
        [`${features}/diff/window/style.css`]: [
          `/* @import '../../tree/window/hidden.css'; */`,
          `@import '../../tree/window/tree.css';`,
          `.icon { background: url("../../tree/window/icon.svg"); }`,
          `.mark { background: url(mark.svg) }`,
          `.page { background: url(data:image/png;base64,AAAA) url(/icon.svg) url(#mask); }`,
        ].join('\n'),
        [`${features}/diff/window/mark.svg`]: '<svg/>',
      }),
    ).toEqual([
      violation(`${features}/diff/.hidden/store.ts:1`, `that's main/store.ts in the tree feature`),
      violation(`${features}/diff/dist/store.js:1`, `that's main/store.ts in the tree feature`),
      violation(`${features}/diff/fixtures/store.ts:1`, `that's main/store.ts in the tree feature`),
      violation(
        `${features}/diff/node_modules/store.mjs:1`,
        `that's main/store.ts in the tree feature`,
      ),
      violation(
        `${features}/diff/window/style.css:2`,
        `refers to ../../tree/window/tree.css: that's window/tree.css in the tree feature`,
      ),
      violation(
        `${features}/diff/window/style.css:3`,
        `refers to ../../tree/window/icon.svg: that's window/icon.svg in the tree feature`,
      ),
    ]);
  });

  test('by a URL Vite bundles, or a module declaration', () => {
    expect(
      check(
        diffImporting(
          [
            `const icon = new URL('../../tree/window/icon.svg', import.meta.url);`,
            `const own = new URL('./store.ts', import.meta.url);`,
            `const any = new URL(\`../../\${name}/icon.svg\`, import.meta.url);`,
            `declare module '../../tree/main/store.ts' { interface X { y: 1 } }`,
            `declare module 'zod' { interface X { y: 1 } }`,
          ].join('\n'),
        ),
      ),
    ).toEqual([
      violation(at(1), `makes a URL to ../../tree/window/icon.svg: that's window/icon.svg`),
      violation(at(3), 'the file is chosen at run time'),
      violation(at(4), `declares module ../../tree/main/store.ts: that's main/store.ts`),
    ]);
  });
});

describe("a glob's options", () => {
  test('are followed where they change what it matches, and refused where they can’t be', () => {
    expect(
      check(
        diffImporting(
          [
            `const a = import.meta.glob('./main/*.ts', { base: '../../tree', eager: true });`,
            `const b = import.meta.glob('./*.ts', { base: '../../tree', import: 'contract' });`,
            `const c = import.meta.glob('../../*/KEYS.ts', { caseSensitive: false });`,
            `const d = import.meta.glob('../../*/keys.ts', { exhaustive: true });`,
            `const e = import.meta.glob('../../*/keys.ts', { [name]: true });`,
            `const f = import.meta.glob('../../*/keys.ts', options);`,
            `const g = import.meta.glob('../../*/keys.ts', { base: '/src/features' });`,
            `const h = import.meta.glob('../../*/keys.ts', { base: folder });`,
            `const i = import.meta.glob('../../*/keys.ts', { later: 1 });`,
            `const j = import.meta.glob('../migrations/*.sql', {`,
            `  query: '?raw', import: 'default', eager: true, caseSensitive: true, exhaustive: false,`,
            `});`,
          ].join('\n'),
        ),
      ),
    ).toEqual([
      violation(
        at(1),
        `globs ./main/*.ts (from ../../tree), which matches main/index.ts: that's main/index.ts in the tree feature`,
      ),
      violation(at(2), `globs ./*.ts (from ../../tree), which matches jobs.ts`),
      violation(
        at(3),
        `globs ../../*/KEYS.ts with caseSensitive: false, which the feature rule doesn't follow`,
      ),
      violation(
        at(4),
        `globs ../../*/keys.ts with exhaustive: true, which the feature rule doesn't follow`,
      ),
      violation(at(5), `with options that aren't written out as an object`),
      violation(at(6), `with options that aren't written out as an object`),
      violation(
        at(7),
        `from the base "/src/features": a feature's globs and their base start with ./ or ../`,
      ),
      violation(at(8), `from a base not written out`),
      violation(
        at(9),
        `globs ../../*/keys.ts with later: 1, which the feature rule doesn't follow`,
      ),
    ]);
  });
});

describe('a shared file', () => {
  test("hands on none of its feature's other files whole", () => {
    expect(
      check({
        ...tree,
        [`${features}/tree/service.ts`]: [
          `export * from './main/store.ts';`,
          `export { x as y } from './main/index.ts';`,
          `export type { X } from './main/store.ts';`,
          `export { type Y, type Z } from './main/store.ts';`,
          `export { contract } from './contract.ts';`,
          `export { z } from 'zod';`,
          `export { middle } from '../open/window/shared.ts';`,
        ].join('\n'),
        [`${features}/tree/window/shared.ts`]: [
          `import { store } from './store.ts';`,
          `export const reveal = () => store;`,
          `export * as store from './store.ts';`,
          `export * from '.';`,
        ].join('\n'),
        [`${features}/tree/keys.ts`]: `export * from './window/index.ts';`,
        [`${features}/tree/contract.ts`]: `export * from './jobs.ts';`,
        [`${features}/tree/main/index.ts`]: `export * from './store.ts';`,
        [`${features}/open/window/shared.ts`]: `export const middle = 1;`,
      }),
    ).toEqual([
      violation(`${features}/tree/contract.ts:1`, `re-exports ./jobs.ts, which is jobs.ts`),
      violation(`${features}/tree/keys.ts:1`, `re-exports ./window/index.ts`),
      violation(
        `${features}/tree/service.ts:1`,
        `re-exports ./main/store.ts, which is main/store.ts: a shared file names each thing it shares`,
      ),
      violation(`${features}/tree/service.ts:2`, `re-exports ./main/index.ts`),
      violation(
        `${features}/tree/window/shared.ts:3`,
        `re-exports ./store.ts, which is window/store.ts`,
      ),
      violation(`${features}/tree/window/shared.ts:4`, `re-exports ., which is window/`),
    ]);
  });
});

describe('a shared file, again', () => {
  test("exports none of its feature's other files under any name", () => {
    expect(
      check({
        ...tree,
        [`${features}/tree/service.ts`]: [
          `import { x, y as z } from './main/store.ts';`,
          `import * as all from './main/index.ts';`,
          `import type { T } from './main/store.ts';`,
          `import { type U } from './main/store.ts';`,
          `import { contract } from './contract.ts';`,
          `import { q } from 'zod';`,
          `export { x };`,
          `export { z as renamed, contract, q };`,
          `export const aliased = (all.store as unknown)!;`,
          `export const wrapped = () => x;`,
          `export type { T, U };`,
          `export default all;`,
        ].join('\n'),
        [`${features}/tree/window/shared.ts`]: [
          `import store = require('./store.ts');`,
          `export import index = require('./index.ts');`,
          `export { store };`,
        ].join('\n'),
      }),
    ).toEqual([
      violation(
        `${features}/tree/service.ts:7`,
        `exports what it imports from ./main/store.ts, which is main/store.ts: a shared file names each thing it shares`,
      ),
      violation(`${features}/tree/service.ts:8`, `exports what it imports from ./main/store.ts`),
      violation(`${features}/tree/service.ts:9`, `exports what it imports from ./main/index.ts`),
      violation(`${features}/tree/service.ts:12`, `exports what it imports from ./main/index.ts`),
      violation(`${features}/tree/window/shared.ts:2`, `exports what it imports from ./index.ts`),
      violation(`${features}/tree/window/shared.ts:3`, `exports what it imports from ./store.ts`),
    ]);
  });
});

describe('a glob', () => {
  test('follows symlinked folders, as Vite does, and ends at a loop', () => {
    expect(
      check(diffImporting(`const all = import.meta.glob('./**/*.ts');`), {
        [`${features}/diff/main/linked`]: '../../tree/window',
        [`${features}/diff/main/loop`]: '..',
      }),
    ).toEqual([
      violation(
        at(),
        `globs ./**/*.ts, which matches linked/index.ts: that's window/index.ts in the tree feature`,
      ),
    ]);
  });
});

describe('a module chosen at run time', () => {
  test('passes in a test or fixture nothing bundles, but not once something does', () => {
    const load = `export const load = (name: string) => import(name);`;
    const files = {
      ...tree,
      [`${features}/diff/fixtures/load.ts`]: load,
      [`${features}/diff/fixtures/used.ts`]: load,
      [`${features}/diff/main/load.test.ts`]: load,
      [`${features}/diff/test/load.ts`]: load,
      [`${features}/diff/main/index.ts`]: `import { load } from '../fixtures/used';`,
    };
    expect(check(files)).toEqual([
      violation(`${features}/diff/fixtures/used.ts:1`, 'the module is chosen at run time'),
    ]);
  });
});

test("a file that doesn't parse is left to the boundary check", () => {
  expect(check(diffImporting(`import { from '../../tree/main/store.ts';`))).toEqual([]);
});

test('a workspace without the app has nothing to check', () => {
  expect(check({ 'packages/core/github/src/index.ts': `export const x = 1;` })).toEqual([]);
});
