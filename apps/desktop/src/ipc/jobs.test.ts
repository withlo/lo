import { describe, expect, it } from 'vitest';

import { BYTES_LIMIT, isHandOver, plainDataProblem } from './jobs.ts';

/**
 * An array claiming the most entries an array can have, with none: what a hostile page can send
 * cheaply. A check that walked its length wouldn't finish in the test's time.
 */
function sparse(): unknown[] {
  const holes: unknown[] = [];
  holes.length = 4_294_967_295;
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
      { bytes: new Uint8Array([0, 1, 2]) },
    ]) {
      expect(plainDataProblem(value)).toBe(undefined);
    }
  });

  it('refuses an array with holes, however long it claims to be, without walking its length', () => {
    expect(plainDataProblem({ input: sparse() })).toBe('it has an array with holes');
  });

  it.each([
    ['a Blob', new Blob(['x']), 'it holds a Blob'],
    ['a typed array other than bytes', new Uint16Array(4), 'it holds a Uint16Array'],
    ['bytes of shared memory', new Uint8Array(new SharedArrayBuffer(4)), 'it holds a Uint8Array'],
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

  it('counts bytes by the buffers they go with, past the limit on them', () => {
    const buffer = new Uint8Array(BYTES_LIMIT / 2);
    expect(plainDataProblem([buffer, buffer.subarray(0, 1)])).toBe(undefined);
    expect(plainDataProblem([buffer, buffer.subarray(0, 1), new Uint8Array(1)])).toBe(
      'it holds more than 256 MiB of bytes',
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
