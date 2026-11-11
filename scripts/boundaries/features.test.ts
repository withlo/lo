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

test("a file that doesn't parse is left to the boundary check", () => {
  expect(check(diffImporting(`import { from '../../tree/main/store.ts';`))).toEqual([]);
});

test('a workspace without the app has nothing to check', () => {
  expect(check({ 'packages/core/github/src/index.ts': `export const x = 1;` })).toEqual([]);
});
