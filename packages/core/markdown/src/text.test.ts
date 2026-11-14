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

/** A Markdown text's words, with the raw HTML in it as the words it shows. */
const read = (markdown: string) => plainText(markdownTree(markdown), Infinity, { html: true });

test('with html, the raw HTML in a text is the words it shows', () => {
  expect(
    read('A <b>bold</b>move, <kbd>Ctrl</kbd>+<i>c</i> and<br>a <a href="https://e.com">link</a>'),
  ).toBe('A boldmove, Ctrl+c and a link');
  expect(read('<details>\n<summary>Stack trace</summary>\n\nat main (a.ts:1)\n</details>')).toBe(
    'Stack trace at main (a.ts:1)',
  );
  // An image is its alt text, or "image".
  expect(read('See <img width="10" src="x.png" alt="the chart"> and <img src="y.png">.')).toBe(
    'See the chart and image .',
  );
  expect(read('<img src="y.png" alt="  ">')).toBe('image');
  // What GitHub never shows, and a comment, give nothing.
  expect(read('a<script>alert(1)</script><style>p{}</style> b <!-- c -->')).toBe('a b');
  // Entities are the characters they stand for, and text that isn't HTML is as it was.
  expect(read('Tom &amp; Jerry, 1 < 2 and 3 > 2, a <3')).toBe('Tom & Jerry, 1 < 2 and 3 > 2, a <3');
  // Code is read as written, in a line or a block.
  expect(read('Use `<div>` or:\n\n```html\n<b>x</b>\n```')).toBe('Use <div> or: <b>x</b>');
  // Without the option it's the text as it's written.
  expect(plainText(markdownTree('a <b>b</b>'))).toBe('a <b>b</b>');
});

test('with html, a text with more raw HTML than a limit is left as it is', () => {
  const text = '<b>'.repeat(5_000);
  expect(plainText(markdownTree(text), Infinity, { html: true })).toBe(text);
});
