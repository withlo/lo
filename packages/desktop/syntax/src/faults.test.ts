// A fault in WebAssembly as a highlighter parses. It breaks the thread's memory for good, so it
// runs in its own file, and so in its own process.

import { Parser } from 'web-tree-sitter';
import { expect, test, vi } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';
import { Tagger } from './tags.ts';

/** The part of WebAssembly's API this needs, which the types it's checked with leave out. */
declare const WebAssembly: { RuntimeError: ErrorConstructor };

test("a fault in WebAssembly stops the thread's highlighters and taggers for good", async () => {
  const highlighter = await Highlighter.create(diskLoader());
  const tagger = await Tagger.create(diskLoader());
  const parse = vi.spyOn(Parser.prototype, 'parse').mockImplementationOnce(() => {
    throw new WebAssembly.RuntimeError('memory access out of bounds');
  });
  try {
    expect(await highlighter.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
  } finally {
    parse.mockRestore();
  }

  expect(highlighter.usable).toBe(false);
  expect(await highlighter.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
  expect(tagger.usable).toBe(false);
  expect(await tagger.symbols('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
  expect((await Highlighter.create(diskLoader())).usable).toBe(false);
});
