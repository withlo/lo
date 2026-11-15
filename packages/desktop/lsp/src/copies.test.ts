import { chmodSync, linkSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { whyDistrusted } from '@lo/git';
import { expect, test } from 'vitest';

import { tempFolder } from '../test/support.ts';
import { findCopy } from './copies.ts';

/** A program at `path`, in folders made for it. */
function program(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'program');
  chmodSync(path, 0o755);
  return path;
}

function setUp() {
  const home = tempFolder();
  const cache = join(home, 'Library', 'Caches', 'Lo');
  mkdirSync(cache, { recursive: true });
  return {
    home,
    cache,
    find: (candidates: string[]) =>
      findCopy(candidates, {
        // The app's check, as git is found: root and this user only.
        distrust: (path) => whyDistrusted(path, [0]),
        outside: [cache],
        home,
      }),
  };
}

test('the first copy that may run wins, by its real path', async () => {
  const { home, find } = setUp();
  const real = program(join(home, 'go', 'bin', 'gopls'));
  const link = join(home, 'bin', 'gopls');
  mkdirSync(join(home, 'bin'));
  symlinkSync(real, link);
  const found = await find([join(home, 'missing', 'gopls'), link]);
  expect(found.program).toBe(real);
  expect(found.skipped).toEqual([{ path: join(home, 'missing', 'gopls'), why: 'it isn’t there' }]);
});

test('skips a copy others could change', async () => {
  const { home, find } = setUp();
  const shared = program(join(home, 'shared', 'bin', 'gopls'));
  chmodSync(join(home, 'shared', 'bin'), 0o777);
  const found = await find([shared]);
  expect(found.program).toBeUndefined();
  expect(found.skipped[0]?.why).toMatch(/other users can change/);
});

test('skips version managers’ shims, which pick a program from the checkout', async () => {
  const { home, find } = setUp();
  const mise = program(join(home, '.local', 'share', 'mise', 'shims', 'gopls'));
  // A link elsewhere to a shim is a shim.
  const linked = join(home, 'linked-gopls');
  symlinkSync(mise, linked);
  // rustup's proxies are rustup itself, by another name.
  const rustup = program(join(home, '.cargo', 'bin', 'rustup'));
  const proxy = join(home, '.cargo', 'bin', 'cargo');
  linkSync(rustup, proxy);
  const found = await find([mise, linked, proxy]);
  expect(found.program).toBeUndefined();
  expect(found.skipped.map((skip) => skip.why)).toEqual(
    Array(3).fill('it’s a version manager’s shim, which picks a program from the checkout'),
  );
});

test('skips a copy in Lo’s cache, where checkouts and downloads are', async () => {
  const { cache, find } = setUp();
  const inCheckout = program(join(cache, 'checkouts', 'repo', 'node_modules', '.bin', 'tsserver'));
  const found = await find([inCheckout]);
  expect(found.skipped).toEqual([{ path: inCheckout, why: 'it’s inside Lo’s cache' }]);
});
