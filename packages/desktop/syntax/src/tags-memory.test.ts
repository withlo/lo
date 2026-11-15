// A file whose syntax tree outgrows the memory. The thread's WebAssembly memory never shrinks, so
// this runs in its own file, and so in its own process.

import { expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';
import { memoryCeiling } from './runtime.ts';
import { Tagger } from './tags.ts';

test('stops reading once the memory passes the ceiling, and asks to be replaced', async () => {
  const tagger = await Tagger.create(diskLoader());
  // A million statements, each a name, past what the tagger would read unasked.
  const text = 'A\n'.repeat(1_000_000);

  const result = await tagger.symbols('typescript', text, {
    maxLength: text.length,
    timeout: 30_000,
  });

  expect(result).toEqual({ skipped: 'out-of-memory' });
  expect(tagger.memory).toBeGreaterThan(memoryCeiling);
  expect(tagger.usable).toBe(false);
  // Only that file is out of memory. The files after aren't read, in the thread's highlighters
  // too, and fail.
  const small = 'func area() {}\n';
  expect(await tagger.symbols('swift', small)).toEqual({ skipped: 'failed' });
  const highlighter = await Highlighter.create(diskLoader());
  expect(highlighter.usable).toBe(false);
  expect(await highlighter.highlight('swift', small)).toEqual({ skipped: 'failed' });
});
