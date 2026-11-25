import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import { afterAll, expect, test } from 'vitest';

import { fileFolders } from './folders.ts';

const made: string[] = [];

// Registered first, so it runs last, once the folders' own removal has run.
afterAll(() => {
  expect(made).toHaveLength(2);
  expect(made.filter((folder) => existsSync(folder))).toEqual([]);
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
