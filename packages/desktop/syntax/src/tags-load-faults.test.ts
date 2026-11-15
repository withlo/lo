// A fault in WebAssembly as a tagger loads a grammar. It breaks the thread's memory for good, so it
// runs in its own file, and so in its own process.

import { Language } from 'web-tree-sitter';
import { expect, test, vi } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter } from './highlight.ts';
import { Tagger } from './tags.ts';

/** The part of WebAssembly's API this needs, which the types it's checked with leave out. */
declare const WebAssembly: { RuntimeError: ErrorConstructor };

test("a fault as a grammar loads stops the thread's taggers and highlighters for good", async () => {
  const tagger = await Tagger.create(diskLoader());
  const highlighter = await Highlighter.create(diskLoader());
  const load = vi
    .spyOn(Language, 'load')
    .mockRejectedValueOnce(new WebAssembly.RuntimeError('unreachable'));
  try {
    expect(await tagger.symbols('go', 'package a\n')).toEqual({ skipped: 'failed' });
  } finally {
    load.mockRestore();
  }

  expect(tagger.usable).toBe(false);
  expect(highlighter.usable).toBe(false);
  expect(await highlighter.highlight('toml', 'a = 1\n')).toEqual({ skipped: 'failed' });
});
