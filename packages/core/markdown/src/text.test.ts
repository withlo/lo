import { expect, test } from 'vitest';

import { markdownTree } from './markdown.ts';
import { plainText } from './text.ts';
import type { Inline, Tree } from './tree.ts';

test("a tree's text is its words on one line", () => {
  const tree = markdownTree(
    '# Title\n\nSome **bold**text and `code`.\nA line ![alt](https://e.com/a.png) @octocat[^1]\n\n- one\n- two\n\n| a | b |\n|---|---|\n| c | d |\n\n```\nx  y\n```\n\n[^1]: Note.',
  );
  expect(plainText(tree)).toBe(
    'Title Some boldtext and code. A line alt @octocat[1] one two a b c d x y Note.',
  );
});

test('a summary reads no further than it needs', () => {
  const tree = markdownTree('word '.repeat(10_000));
  expect(plainText(tree, 12)).toBe('word word wo');
  expect(plainText(markdownTree(''))).toBe('');
});

test("any tree's text is read without recursion, whatever made it", () => {
  // Nested far deeper than Lo's own trees ever are.
  let node: Inline = { kind: 'text', value: 'deep' };
  for (let i = 0; i < 200_000; i++) node = { kind: 'strong', children: [node] };
  const tree: Tree = {
    blocks: [{ kind: 'paragraph', children: [node] }],
    notes: [],
    diagnostics: [],
  };
  expect(plainText(tree)).toBe('deep');
});
