import { describe, expect, it } from 'vitest';

import { addressPath, keyOf, nameOf, parentOf, pathOfKey } from './paths.ts';

describe('paths in the window', () => {
  const cafe = { text: 'd�/caf�.txt', hex: '64e92f636166e92e747874' };

  it('keys a UTF-8 path by its text, and any other by its bytes', () => {
    expect(keyOf({ text: 'src/a.ts' })).toBe('src/a.ts');
    expect(keyOf(cafe)).toBe('\u0000' + cafe.hex);
    expect(pathOfKey(keyOf(cafe))).toEqual(cafe);
    expect(pathOfKey('src/a.ts')).toEqual({ text: 'src/a.ts' });
  });

  it('finds a path’s folder, by its bytes when they aren’t UTF-8', () => {
    expect(parentOf({ text: 'src/text/wrap.ts' })).toEqual({ text: 'src/text' });
    expect(parentOf({ text: 'README.md' })).toBeUndefined();
    expect(parentOf(cafe)).toEqual({ text: 'd�', hex: '64e9' });
    expect(parentOf({ text: 'src/caf�', hex: '7372632f636166e9' })).toEqual({ text: 'src' });
    expect(nameOf(cafe)).toBe('caf�.txt');
  });

  it('escapes a path for an address, its bytes as they are', () => {
    expect(addressPath({ text: 'src/a b#c.ts' })).toBe('src/a%20b%23c.ts');
    expect(addressPath(cafe)).toBe('d%E9/caf%E9.txt');
  });
});
