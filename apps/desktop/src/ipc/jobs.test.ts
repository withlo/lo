import { describe, expect, it } from 'vitest';

import { isHandOver, plainDataProblem } from './jobs.ts';

/** An array claiming twenty million entries, with none: what a hostile page can send cheaply. */
function sparse(): unknown[] {
  const holes: unknown[] = [];
  holes.length = 20_000_000;
  return holes;
}

describe('plainDataProblem', () => {
  it('accepts plain data', () => {
    for (const value of [
      undefined,
      null,
      true,
      3.5,
      'text',
      [1, 'two', { three: [3] }],
      { nested: { list: [null, false] } },
    ]) {
      expect(plainDataProblem(value)).toBe(undefined);
    }
  });

  it('refuses an array with holes, however long it claims to be, without walking its length', () => {
    expect(plainDataProblem({ input: sparse() })).toBe('it has an array with holes');
  });

  it.each([
    ['a Blob', new Blob(['x']), 'it holds a Blob'],
    ['a typed array', new Uint8Array(4), 'it holds a Uint8Array'],
    ['a Map', new Map(), 'it holds a Map'],
    ['a function', () => {}, 'it holds a function'],
    ['a bigint', 1n, 'it holds a bigint'],
  ])('refuses %s, which a port may drop or a job can’t take', (_case, value, problem) => {
    expect(plainDataProblem({ input: value })).toBe(problem);
  });

  it('refuses data nested too deep, or too much of it', () => {
    let deep: unknown = 'bottom';
    for (let depth = 0; depth < 100; depth += 1) deep = [deep];
    expect(plainDataProblem(deep)).toBe('it nests more than 64 deep');
    expect(plainDataProblem(Array.from({ length: 1_000_001 }, () => 0))).toBe(
      'it has more than a million values',
    );
    expect(plainDataProblem(['x'.repeat(40 * 1024 * 1024), 'x'.repeat(40 * 1024 * 1024)])).toBe(
      'it holds more than 64 million characters',
    );
  });
});

describe('isHandOver', () => {
  it('accepts main’s news, and nothing else', () => {
    expect(isHandOver({ type: 'lo:background', state: 'lost', testing: false })).toBe(true);
    expect(isHandOver({ type: 'lo:background', state: 'gone', testing: false })).toBe(false);
    expect(isHandOver('lo:background')).toBe(false);
  });
});
