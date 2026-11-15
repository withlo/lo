// A text whose syntax tree outgrows the memory. The thread's WebAssembly memory never shrinks, so
// this runs in its own file, and so in its own process, from a memory under the ceiling.

import { expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';
import { memoryCeiling } from './runtime.ts';

test('stops parsing once its memory passes the ceiling', async () => {
  const highlighter = await Highlighter.create(diskLoader());
  // Markdown's tree for this takes more memory than the ceiling, and more time than allowed here.
  const text = 'a\n\n'.repeat(1_000_000).slice(0, 2_900_000);
  expect(highlighter.memory).toBeLessThan(memoryCeiling);
  const started = performance.now();

  const result = await highlighter.highlight('markdown', text, { timeout: 10_000 });

  expect(result).toEqual({ skipped: 'out-of-memory' });
  expect(performance.now() - started - highlighter.loadMs).toBeLessThan(5000);
  expect(highlighter.usable).toBe(false);
  // Only that text is out of memory; those after fail.
  expect(await highlighter.highlight('markdown', 'a\n')).toEqual({ skipped: 'failed' });
});
