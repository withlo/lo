import { expect, test } from 'vitest';

import type { ChangedFile } from './changed.ts';
import { initialState, LARGE_FILE_BYTES, startsCollapsed } from './state.ts';

function file(path: string, additions: number, deletions: number): ChangedFile {
  return { path, additions, deletions, binary: false };
}

test('an ordinary file starts expanded', () => {
  const state = initialState(file('src/lib.ts', 120, 30));

  expect(state).toStrictEqual({ generated: undefined, large: false, binary: false });
  expect(startsCollapsed(state)).toBe(false);
});

test('a file marked generated starts collapsed', () => {
  const state = initialState({
    ...file('src/api/schema.graphql.ts', 40, 2),
    linguistGenerated: true,
  });

  expect(state.generated).toBe('attribute');
  expect(startsCollapsed(state)).toBe(true);
});

test('a lockfile starts collapsed', () => {
  const state = initialState(file('pnpm-lock.yaml', 12, 4));

  expect(state.generated).toBe('lockfile');
  expect(state.large).toBe(false);
  expect(startsCollapsed(state)).toBe(true);
});

test('a lockfile unmarked generated starts expanded', () => {
  const state = initialState({ ...file('Cargo.lock', 12, 4), linguistGenerated: false });

  expect(state.generated).toBeUndefined();
  expect(startsCollapsed(state)).toBe(false);
});

test('exactly five thousand changed lines start expanded', () => {
  const state = initialState(file('src/table.ts', 3_000, 2_000));

  expect(state.large).toBe(false);
  expect(startsCollapsed(state)).toBe(false);
});

test('more than five thousand changed lines start collapsed', () => {
  const state = initialState(file('src/table.ts', 3_000, 2_001));

  expect(state.large).toBe(true);
  expect(startsCollapsed(state)).toBe(true);
});

test('additions alone can make a file large', () => {
  expect(initialState(file('data/words.txt', 5_001, 0)).large).toBe(true);
});

test('deletions alone can make a file large', () => {
  expect(initialState(file('data/words.txt', 0, 5_001)).large).toBe(true);
});

test('line counts at their limits do not overflow', () => {
  const most = 2 ** 32 - 1;
  expect(initialState(file('data/huge.txt', most, most)).large).toBe(true);
});

test('a file larger than a mebibyte starts collapsed whatever its line count', () => {
  const minified = (size: number): ChangedFile => ({ ...file('dist/app.min.js', 1, 1), size });

  expect(initialState(minified(LARGE_FILE_BYTES)).large).toBe(false);
  const state = initialState(minified(LARGE_FILE_BYTES + 1));
  expect(state.large).toBe(true);
  expect(startsCollapsed(state)).toBe(true);
  // Without a size, as GitHub's list of files gives none, only lines count.
  expect(initialState(file('dist/app.min.js', 1, 1)).large).toBe(false);
});

test('a large lockfile is both generated and large', () => {
  const state = initialState(file('package-lock.json', 9_000, 8_000));

  expect(state.generated).toBe('lockfile');
  expect(state.large).toBe(true);
  expect(startsCollapsed(state)).toBe(true);
});

test('a binary file is flagged and starts expanded', () => {
  const state = initialState({ ...file('assets/logo.png', 0, 0), binary: true });

  expect(state.binary).toBe(true);
  expect(startsCollapsed(state)).toBe(false);
});

test('a binary lockfile is flagged and starts collapsed', () => {
  const state = initialState({ ...file('bun.lockb', 0, 0), binary: true });

  expect(state.binary).toBe(true);
  expect(state.generated).toBe('lockfile');
  expect(startsCollapsed(state)).toBe(true);
});
