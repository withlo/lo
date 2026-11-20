// The listing `sourcekit.ts` compares a home folder by, on a folder the test makes.

import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { tempFolder } from '../test/support.ts';
import { compare, describe, listFolder } from './home.ts';

/** Writes `file` in `home`, with its folders, last changed at `seconds` after the epoch. */
function put(home: string, file: string, seconds: number, text = 'x'): void {
  const path = join(home, ...file.split('/'));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, seconds, seconds);
}

/** A home with a cache and a config folder that were there before. */
function aHome(): string {
  const folder = tempFolder();
  put(folder, '.cache/old', 1);
  put(folder, '.config/settings', 1);
  put(folder, '.profile', 1);
  return folder;
}

test('list every file in every folder, with a folder as its name alone', async () => {
  const folder = aHome();
  const listing = await listFolder(folder, []);
  expect([...listing.keys()].toSorted()).toEqual([
    '.cache',
    '.cache/old',
    '.config',
    '.config/settings',
    '.profile',
  ]);
  expect(listing.get('.cache')).toBe('folder');
});

test('see a new file in a folder that was there', async () => {
  const folder = aHome();
  const before = await listFolder(folder, []);
  put(folder, '.cache/org.swift.swiftpm/manifests', 2);
  put(folder, '.config/new.json', 2);
  const changes = compare(before, await listFolder(folder, []));
  // The new folder stands for what's in it.
  expect(changes).toEqual({
    added: ['.cache/org.swift.swiftpm', '.config/new.json'],
    changed: [],
    removed: [],
  });
  expect(describe(changes, 10)).toBe('added: .cache/org.swift.swiftpm, .config/new.json');
});

test('see a file changed or removed', async () => {
  const folder = aHome();
  const before = await listFolder(folder, []);
  put(folder, '.config/settings', 2);
  put(folder, '.profile', 1, 'longer');
  rmSync(join(folder, '.cache'), { recursive: true });
  const changes = compare(before, await listFolder(folder, []));
  expect(changes).toEqual({
    added: [],
    changed: ['.config/settings', '.profile'],
    removed: ['.cache'],
  });
  expect(describe(changes, 10)).toBe('changed: .config/settings, .profile; removed: .cache');
});

test('see nothing when nothing changed', async () => {
  const folder = aHome();
  const before = await listFolder(folder, []);
  const changes = compare(before, await listFolder(folder, []));
  expect(changes).toEqual({ added: [], changed: [], removed: [] });
  expect(describe(changes, 10)).toBeUndefined();
});

test('leave out the folders it is told to, and keep what is beside them', async () => {
  const folder = aHome();
  put(folder, 'work/_temp/file', 1);
  const ignored = [join(folder, 'work')];
  const before = await listFolder(folder, ignored);
  expect([...before.keys()]).not.toContain('work/_temp');
  put(folder, 'work/_temp/file', 2);
  put(folder, 'work/checkout/new', 2);
  expect(compare(before, await listFolder(folder, ignored))).toEqual({
    added: [],
    changed: [],
    removed: [],
  });
  put(folder, '.cache/new', 2);
  expect(compare(before, await listFolder(folder, ignored)).added).toEqual(['.cache/new']);
});

test('not follow a link out of the folder', async () => {
  const folder = aHome();
  const outside = tempFolder();
  put(outside, 'elsewhere/file', 1);
  symlinkSync(join(outside, 'elsewhere'), join(folder, 'link'));
  const before = await listFolder(folder, []);
  expect([...before.keys()]).toContain('link');
  expect([...before.keys()]).not.toContain('link/file');
  put(outside, 'elsewhere/new', 2);
  expect(compare(before, await listFolder(folder, [])).added).toEqual([]);
});

test('name the first of a long list, and say how many more', () => {
  const added = ['a', 'b', 'c', 'd'];
  expect(describe({ added, changed: [], removed: [] }, 2)).toBe('added: a, b and 2 more');
});
