import { expect, test } from 'vitest';

import type { ChangedFile } from './changed.ts';
import { isLockfile, whyGenerated } from './generated.ts';

const ALL_LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Cargo.lock',
  'go.sum',
  'uv.lock',
  'poetry.lock',
  'Gemfile.lock',
  'composer.lock',
  'Podfile.lock',
  'Package.resolved',
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
  'bun.lock',
  'bun.lockb',
  'packages.lock.json',
];

function file(path: string, linguistGenerated: boolean | undefined): ChangedFile {
  return { path, additions: 0, deletions: 0, binary: false, linguistGenerated };
}

test('every listed lockfile is a lockfile', () => {
  expect(ALL_LOCKFILES.filter((name) => !isLockfile(name))).toEqual([]);
});

test('lockfiles count in any directory', () => {
  expect(isLockfile('apps/web/pnpm-lock.yaml')).toBe(true);
  expect(isLockfile('tools/xtask/Cargo.lock')).toBe(true);
  expect(
    isLockfile('App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'),
  ).toBe(true);
});

test('other files are not lockfiles', () => {
  const paths = [
    'package.json',
    'Cargo.toml',
    'go.mod',
    'Gemfile',
    'cargo.lock',
    'yarn.lock.orig',
    'old-yarn.lock',
    'Cargo.lock/notes.md',
    'docs/lockfiles.md',
    '',
  ];
  expect(paths.filter((path) => isLockfile(path))).toEqual([]);
});

test('the attribute marks a file generated', () => {
  expect(whyGenerated(file('src/schema.ts', true))).toBe('attribute');
});

test('lockfiles are generated without the attribute', () => {
  expect(whyGenerated(file('Cargo.lock', undefined))).toBe('lockfile');
});

test('unsetting the attribute keeps a lockfile expanded', () => {
  expect(whyGenerated(file('Cargo.lock', false))).toBeUndefined();
});

test('a lockfile marked generated cites the attribute', () => {
  expect(whyGenerated(file('yarn.lock', true))).toBe('attribute');
});

test('other files are not generated', () => {
  expect(whyGenerated(file('src/main.ts', undefined))).toBeUndefined();
  expect(whyGenerated(file('src/main.ts', false))).toBeUndefined();
});
