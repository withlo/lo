import { expect, test } from 'vitest';

import type { ChangedFile } from './changed.ts';
import { asTest, fileKind, type FileKind } from './kind.ts';

function file(path: string, linguistGenerated?: boolean): ChangedFile {
  return { path, additions: 0, deletions: 0, binary: false, linguistGenerated };
}

function kindOf(path: string): FileKind {
  return fileKind(file(path));
}

/** The paths whose kind isn't `kind`, which should be none. */
function notOfKind(kind: FileKind, paths: readonly string[]): string[] {
  return paths.filter((path) => kindOf(path) !== kind);
}

/** The stem and extension of the source file the test at `path` tests. */
function subject(path: string): [string, string] | undefined {
  const found = asTest(path);
  expect(found).toBeDefined();
  const name = found?.subject;
  return name && [name.stem, name.extension];
}

test('code docs and assets are source', () => {
  expect(
    notOfKind('source', [
      'src/main.rs',
      'web/src/app.tsx',
      'pkg/server/server.go',
      'srcs/api/models.py',
      'README.md',
      'docs/guide.md',
      'Makefile',
      'Dockerfile',
      'assets/logo.png',
      'src/foo.d.ts',
    ]),
  ).toEqual([]);
});

test('javascript and typescript tests are named test or spec', () => {
  for (const extension of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) {
    const testPath = `src/button.test.${extension}`;
    const specPath = `src/button.spec.${extension}`;

    expect(notOfKind('test', [testPath, specPath])).toEqual([]);
    expect(subject(testPath)).toEqual(['button', extension]);
    expect(subject(specPath)).toEqual(['button', extension]);
  }
});

test('a test of a dotted name keeps the dots', () => {
  expect(subject('src/user.service.spec.ts')).toEqual(['user.service', 'ts']);
});

test('go tests end in underscore test', () => {
  expect(kindOf('pkg/server/server_test.go')).toBe('test');
  expect(subject('pkg/server/server_test.go')).toEqual(['server', 'go']);
});

test('python tests start with test or end with test', () => {
  expect(kindOf('tests/test_models.py')).toBe('test');
  expect(kindOf('srcs/api/models_test.py')).toBe('test');
  expect(subject('tests/test_models.py')).toEqual(['models', 'py']);
  expect(subject('srcs/api/models_test.py')).toEqual(['models', 'py']);
});

test('rust tests are files in a tests directory', () => {
  expect(kindOf('core/parser/tests/lexer.rs')).toBe('test');
  expect(kindOf('tests/cli.rs')).toBe('test');
  expect(subject('core/parser/tests/lexer.rs')).toEqual(['lexer', 'rs']);
});

test('rust files deeper in a tests directory test nothing in particular', () => {
  expect(kindOf('tests/common/mod.rs')).toBe('test');
  expect(subject('tests/common/mod.rs')).toBeUndefined();
});

test('names that only look like tests are source', () => {
  expect(
    notOfKind('source', [
      'src/test.ts',
      'src/testing.ts',
      'src/button.tests.ts',
      'src/latest.go',
      'src/_test.go',
      'src/contest.py',
      'src/test_.py',
      'src/_test.py',
      'src/tests.rs',
      'src/attest.rs',
      'tests/helpers.py',
      'test/button.ts',
      'src/button.test.rb',
    ]),
  ).toEqual([]);
});

test('json yaml and toml are config', () => {
  expect(
    notOfKind('config', [
      'package.json',
      'tsconfig.json',
      '.vscode/settings.jsonc',
      'renovate.json5',
      'docker-compose.yaml',
      'config/app.yml',
      'Cargo.toml',
      'core/parser/Cargo.toml',
      'deploy/VALUES.YAML',
    ]),
  ).toEqual([]);
});

test('dotfiles are config', () => {
  expect(notOfKind('config', ['.gitignore', '.env.example', 'apps/web/.eslintrc'])).toEqual([]);
});

test('everything in a dot directory is config', () => {
  expect(
    notOfKind('config', [
      '.github/CODEOWNERS',
      '.github/workflows/ci.yml',
      '.github/pull_request_template.md',
      '.husky/pre-commit',
      '.storybook/main.ts',
    ]),
  ).toEqual([]);
});

test('a test in a dot directory is config', () => {
  expect(kindOf('.github/scripts/label.test.js')).toBe('config');
});

test('a lockfile that is not generated is config', () => {
  expect(fileKind(file('Cargo.lock', false))).toBe('config');
});

test('generated beats every other group', () => {
  expect(kindOf('pnpm-lock.yaml')).toBe('generated');
  expect(kindOf('Cargo.lock')).toBe('generated');
  const marked = ['src/schema.ts', 'src/schema.test.ts', 'openapi.json', '.github/labels.yml'];
  expect(marked.filter((path) => fileKind(file(path, true)) !== 'generated')).toEqual([]);
});
