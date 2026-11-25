import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import { afterAll, expect, test } from 'vitest';

import { fileFolders } from './folders.ts';

const made: string[] = [];

// Registered first, so it runs last, once the folders' own removal has run, and fails the file.
afterAll(() => {
  const left = made.filter((folder) => existsSync(folder));
  if (made.length !== 2 || left.length > 0) {
    throw new Error(`of ${made.length} folders, these are left: ${left.join(', ')}`);
  }
});

const folder = fileFolders('lo-folders-test-');

test('each folder is new, and outlasts the test that made it', () => {
  made.push(folder(), folder());
  expect(new Set(made).size).toBe(2);
  expect(made.map((each) => basename(each).startsWith('lo-folders-test-'))).toEqual([true, true]);
});

test('the folders are there until the file’s tests have all run', () => {
  expect(made.filter((each) => existsSync(each))).toEqual(made);
});
