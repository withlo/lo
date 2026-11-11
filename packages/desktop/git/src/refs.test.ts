import { expect, test } from 'vitest';

import { branchBaseRef, checkName } from './refs.ts';

function said(name: string): string {
  try {
    checkName('repository name', name);
    return 'accepted';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test('names must be safe as folder names', () => {
  const fine = ['sharkdp', 'fd', 'rozed-dev', '.github', 'my_repo.rs', 'A1'];
  expect(fine.map(said)).toEqual(fine.map(() => 'accepted'));
  const unsafe = ['', '.', '..', 'a/b', '../x', 'a b', 'a\nb', 'ä', 'a'.repeat(101)];
  expect(unsafe.map(said)).toEqual(
    unsafe.map((name) => `\`${name}\` isn't a valid repository name`),
  );
});

test('a branch’s tip is pinned by its name’s hash, so no name is another’s folder', () => {
  const nested = [branchBaseRef(1, 'rel'), branchBaseRef(1, 'rel/1.0')];
  expect(nested.map((ref) => ref.split('/').length)).toEqual([6, 6]);
  expect(nested[0]).not.toBe(nested[1]);
  expect(branchBaseRef(1, 'trunk')).toMatch(/^refs\/lo\/pull\/1\/branch-bases\/[0-9a-f]{64}$/);
});
