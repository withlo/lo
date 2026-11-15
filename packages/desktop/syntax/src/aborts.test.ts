// Scanners that abort. A thread takes only so many aborts, so they run in their own file, and so in
// their own process.

import { expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';

/** Strings nested 1,100 deep, past the 512 at which Kotlin's scanner aborts. */
const deep = '"${\n'.repeat(1100);
const sample = 'fun total(n: Int) = n * 2\n';
/** Past the depth guard, which skips `deep`. */
const unguarded = { maxDepth: Number.POSITIVE_INFINITY };

test('a scanner that aborts fails only its text', async () => {
  const highlighter = await Highlighter.create(diskLoader());
  const before = await highlighter.highlight('kotlin', sample);

  expect(await highlighter.highlight('kotlin', deep, unguarded)).toEqual({ skipped: 'failed' });
  expect(highlighter.usable).toBe(true);
  expect(await highlighter.highlight('kotlin', sample)).toEqual(before);
  expect(await highlighter.highlight('swift', 'let a = 1\n')).toEqual({
    tokens: expect.any(Uint32Array),
  });
});

test('a thread whose scanners have aborted eight times stops highlighting', async () => {
  const highlighter = await Highlighter.create(diskLoader());
  for (let abort = 0; abort < 8; abort++) await highlighter.highlight('kotlin', deep, unguarded);

  expect(highlighter.usable).toBe(false);
  expect(await highlighter.highlight('kotlin', sample)).toEqual({ skipped: 'failed' });
});
