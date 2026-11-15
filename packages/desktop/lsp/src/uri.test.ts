import { expect, test } from 'vitest';

import { checkTreePath, fileUri, folderUri, treePath } from './uri.ts';

const ROOT = '/lo/checkouts/pull-1/abc';

test('a tree path and its URI map to each other, however its name is spelled', () => {
  for (const path of ['src/a.ts', 'a b/#1 100%.ts', 'é/ü?.go', 'back\\slash.rs']) {
    const uri = fileUri(ROOT, path);
    expect(uri.startsWith(`${folderUri(ROOT)}/`)).toBe(true);
    expect(treePath([ROOT], uri)).toBe(path);
  }
  // As the system resolves the folder, too.
  expect(treePath([ROOT, '/private/lo'], 'file:///private/lo/src/a.ts')).toBe('src/a.ts');
});

test('a location outside the checkout has no path', () => {
  for (const uri of [
    'file:///lo/checkouts/pull-1/abc',
    'file:///lo/checkouts/pull-1/abc/../abd/x.ts',
    'file:///lo/checkouts/pull-1/abc-other/x.ts',
    'file:///usr/lib/go/src/fmt/print.go',
    'file://elsewhere/lo/checkouts/pull-1/abc/a.ts',
    'file:///lo/checkouts/pull-1/abc/a%2F..%2F..%2Fx.ts',
    'jdt://contents/rt.jar/java.lang/String.class',
    'untitled:Untitled-1',
    'not a URI',
  ]) {
    expect({ uri, path: treePath([ROOT], uri) }).toEqual({ uri, path: undefined });
  }
});

test('only paths as a tree has them name files', () => {
  for (const path of ['', '/etc/passwd', 'a//b', './a', 'a/../b', '..', 'a/.', 'a\0b']) {
    expect(() => checkTreePath(path)).toThrow('not a path in a tree');
  }
});
