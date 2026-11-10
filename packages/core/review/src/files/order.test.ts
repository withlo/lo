import { expect, test } from 'vitest';

import type { ChangedFile } from './changed.ts';
import { pathOrder, reviewOrder } from './order.ts';

function file(path: string, more: Partial<ChangedFile> = {}): ChangedFile {
  return { path, additions: 0, deletions: 0, binary: false, ...more };
}

function files(names: readonly string[]): ChangedFile[] {
  return names.map((name) => file(name));
}

function paths(list: readonly ChangedFile[], order: readonly number[]): (string | undefined)[] {
  return order.map((index) => list[index]?.path);
}

function reviewPaths(list: readonly ChangedFile[]): (string | undefined)[] {
  return paths(list, reviewOrder(list));
}

test('path order sorts by path', () => {
  const list = files(['src/main.ts', 'Cargo.toml', 'README.md', 'build.ts']);

  expect(paths(list, pathOrder(list))).toEqual([
    'Cargo.toml',
    'README.md',
    'build.ts',
    'src/main.ts',
  ]);
});

test('path order compares bytes like git', () => {
  const list = files(['src/a/b.ts', 'src/a.ts', 'src/a-b.ts', 'src/B.ts']);

  expect(paths(list, pathOrder(list))).toEqual([
    'src/B.ts',
    'src/a-b.ts',
    'src/a.ts',
    'src/a/b.ts',
  ]);
});

test('path order compares bytes past U+FFFF too', () => {
  // UTF-16 puts an emoji before a full-width letter; UTF-8, and so git, after it.
  const emoji = String.fromCodePoint(0x1f600);
  const wide = String.fromCodePoint(0xff21);
  const list = files([`src/${emoji}.ts`, `src/${wide}.ts`, 'src/z.ts']);

  expect(paths(list, pathOrder(list))).toEqual(['src/z.ts', `src/${wide}.ts`, `src/${emoji}.ts`]);
});

test('path order of nothing is empty', () => {
  expect(pathOrder([])).toEqual([]);
});

test('review order of nothing is empty', () => {
  expect(reviewOrder([])).toEqual([]);
});

test('each source file is followed by its test', () => {
  const list = files(['src/button.test.tsx', 'src/api.test.ts', 'src/button.tsx', 'src/api.ts']);

  expect(reviewPaths(list)).toEqual([
    'src/api.ts',
    'src/api.test.ts',
    'src/button.tsx',
    'src/button.test.tsx',
  ]);
});

test('spec files follow their source too', () => {
  const list = files(['lib/parse.spec.mjs', 'lib/format.cjs', 'lib/parse.mjs']);

  expect(reviewPaths(list)).toEqual(['lib/format.cjs', 'lib/parse.mjs', 'lib/parse.spec.mjs']);
});

test('go tests follow their source', () => {
  const list = files(['pkg/server/server_test.go', 'pkg/server/routes.go', 'pkg/server/server.go']);

  expect(reviewPaths(list)).toEqual([
    'pkg/server/routes.go',
    'pkg/server/server.go',
    'pkg/server/server_test.go',
  ]);
});

test('python tests follow their source from another directory', () => {
  const list = files([
    'tests/test_models.py',
    'srcs/api/views_test.py',
    'srcs/api/models.py',
    'srcs/api/views.py',
  ]);

  expect(reviewPaths(list)).toEqual([
    'srcs/api/models.py',
    'tests/test_models.py',
    'srcs/api/views.py',
    'srcs/api/views_test.py',
  ]);
});

test('rust integration tests follow their source', () => {
  const list = files([
    'core/parser/tests/parse.rs',
    'core/parser/src/parse.rs',
    'core/parser/src/lib.rs',
  ]);

  expect(reviewPaths(list)).toEqual([
    'core/parser/src/lib.rs',
    'core/parser/src/parse.rs',
    'core/parser/tests/parse.rs',
  ]);
});

test('several tests of one source follow it in path order', () => {
  const list = files(['src/user.test.ts', 'src/user.ts', 'src/user.spec.ts']);

  expect(reviewPaths(list)).toEqual(['src/user.ts', 'src/user.spec.ts', 'src/user.test.ts']);
});

test('a typescript test follows a javascript source of the same name', () => {
  const list = files(['src/button.test.ts', 'src/button.jsx', 'src/card.ts']);

  expect(reviewPaths(list)).toEqual(['src/button.jsx', 'src/button.test.ts', 'src/card.ts']);
});

test('a test prefers the source with its own extension', () => {
  const list = files(['src/foo.ts', 'src/foo.test.js', 'src/foo.js']);

  expect(reviewPaths(list)).toEqual(['src/foo.js', 'src/foo.test.js', 'src/foo.ts']);
});

test('tests do not match sources in other languages', () => {
  const list = files(['src/foo.py', 'src/foo_test.go', 'src/bar.ts']);

  expect(reviewPaths(list)).toEqual(['src/bar.ts', 'src/foo.py', 'src/foo_test.go']);
});

test('a test follows the nearest source of its name', () => {
  const list = files([
    'web/src/index.ts',
    'api/src/index.ts',
    'web/src/index.test.ts',
    'api/test/index.test.ts',
  ]);

  expect(reviewPaths(list)).toEqual([
    'api/src/index.ts',
    'api/test/index.test.ts',
    'web/src/index.ts',
    'web/src/index.test.ts',
  ]);
});

test('a test equally near several sources follows the first in path order', () => {
  const list = files(['b/util.go', 'a/util.go', 'c/util_test.go']);

  expect(reviewPaths(list)).toEqual(['a/util.go', 'c/util_test.go', 'b/util.go']);
});

test('unmatched tests follow the sources and precede config', () => {
  const list = files([
    'package.json',
    'src/legacy.test.ts',
    'tests/common/mod.rs',
    'src/app.ts',
    'src/app.test.ts',
    'src/zoo.ts',
  ]);

  expect(reviewPaths(list)).toEqual([
    'src/app.ts',
    'src/app.test.ts',
    'src/zoo.ts',
    'src/legacy.test.ts',
    'tests/common/mod.rs',
    'package.json',
  ]);
});

test('a test of a generated file is unmatched', () => {
  const list = [
    file('src/schema.ts', { linguistGenerated: true }),
    ...files(['src/schema.test.ts', 'src/main.ts']),
  ];

  expect(reviewPaths(list)).toEqual(['src/main.ts', 'src/schema.test.ts', 'src/schema.ts']);
});

test('groups go source then tests then config then generated', () => {
  const list = files([
    'yarn.lock',
    '.github/workflows/ci.yml',
    'Cargo.toml',
    'tests/cli.rs',
    'src/main.rs',
    'README.md',
  ]);

  expect(reviewPaths(list)).toEqual([
    'README.md',
    'src/main.rs',
    'tests/cli.rs',
    '.github/workflows/ci.yml',
    'Cargo.toml',
    'yarn.lock',
  ]);
});

test('each group keeps path order', () => {
  const list = files([
    'z.lock.json',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'tsconfig.json',
    '.prettierrc',
    'b.ts',
    'a.ts',
  ]);

  expect(reviewPaths(list)).toEqual([
    'a.ts',
    'b.ts',
    '.prettierrc',
    'tsconfig.json',
    'z.lock.json',
    'Cargo.lock',
    'pnpm-lock.yaml',
  ]);
});

test('a renamed file is placed by its new path', () => {
  const list = [
    file('src/session.ts', { previousPath: 'src/auth.ts' }),
    file('src/session.test.ts', { previousPath: 'src/auth.test.ts' }),
    file('src/router.ts'),
  ];

  expect(reviewPaths(list)).toEqual(['src/router.ts', 'src/session.ts', 'src/session.test.ts']);
});
