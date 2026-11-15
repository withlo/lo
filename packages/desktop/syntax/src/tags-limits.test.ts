// Scanners that abort on what the tagger reads. A thread takes only so many aborts, so these run
// in their own file, and so in their own process.

import { expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';
import { Tagger } from './tags.ts';

/** Strings nested 1,100 deep, past the 512 at which Kotlin's scanner aborts. */
const deep = '"${\n'.repeat(1100);
const sample = 'class Circle {\n    fun area() = 1\n}\n';
/** Past the depth guard, which skips `deep`. */
const unguarded = { maxDepth: Number.POSITIVE_INFINITY };

test('a scanner that aborts fails only its file', async () => {
  const tagger = await Tagger.create(diskLoader());
  const before = await tagger.symbols('kotlin', sample);

  expect(await tagger.symbols('kotlin', deep, unguarded)).toEqual({ skipped: 'failed' });
  expect(await tagger.find('kotlin', deep, 'a', unguarded)).toEqual({ skipped: 'failed' });
  expect(tagger.usable).toBe(true);
  expect(await tagger.symbols('kotlin', sample)).toEqual(before);
  expect(await tagger.symbols('swift', 'func area() {}\n')).toEqual({
    symbols: expect.objectContaining({ definitions: [expect.objectContaining({ name: 'area' })] }),
  });
});

test("a thread's aborts count against its taggers and highlighters alike", async () => {
  const tagger = await Tagger.create(diskLoader());
  const highlighter = await Highlighter.create(diskLoader());
  for (let abort = 0; abort < 8 && tagger.usable; abort++) {
    await (abort % 2 === 0
      ? tagger.symbols('kotlin', deep, unguarded)
      : highlighter.highlight('kotlin', deep, unguarded));
  }

  expect(tagger.usable).toBe(false);
  expect(highlighter.usable).toBe(false);
  expect(await tagger.symbols('kotlin', sample)).toEqual({ skipped: 'failed' });
});
