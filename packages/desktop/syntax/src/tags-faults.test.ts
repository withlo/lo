// A fault in WebAssembly as a tagger reads. It breaks the thread's memory for good, so it runs in
// its own file, and so in its own process.

import { Parser } from 'web-tree-sitter';
import { expect, test, vi } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';
import { Tagger } from './tags.ts';

test("a fault in WebAssembly stops the thread's taggers and highlighters for good", async () => {
  const tagger = await Tagger.create(diskLoader());
  const highlighter = await Highlighter.create(diskLoader());
  // As the stack running out in WebAssembly throws.
  const parse = vi.spyOn(Parser.prototype, 'parse').mockImplementationOnce(() => {
    throw new RangeError('Maximum call stack size exceeded');
  });
  try {
    expect(await tagger.symbols('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
  } finally {
    parse.mockRestore();
  }

  expect(tagger.usable).toBe(false);
  expect(await tagger.find('typescript', 'let a;\n', 'a')).toEqual({ skipped: 'failed' });
  expect(highlighter.usable).toBe(false);
  expect(await highlighter.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
  expect((await Tagger.create(diskLoader())).usable).toBe(false);
});
