import { expect, test } from 'vitest';

import { Line, Lines } from '../threads.ts';
import { suggestionBlock, takesSuggestion } from './suggestion.ts';

test('the block holds the selected lines', () => {
  expect(suggestionBlock(['    let total = 1;', '    total + 1'])).toBe(
    '```suggestion\n    let total = 1;\n    total + 1\n```',
  );
});

test('a blank selected line stays in the block', () => {
  expect(suggestionBlock([''])).toBe('```suggestion\n\n```');
});

test('no lines suggest deleting the selection', () => {
  expect(suggestionBlock([])).toBe('```suggestion\n```');
});

test('lines with their own fences get a longer one', () => {
  expect(suggestionBlock(['```rust', 'fn main() {}', '```'])).toBe(
    '````suggestion\n```rust\nfn main() {}\n```\n````',
  );
  expect(suggestionBlock(['  `````', 'x'])).toBe('``````suggestion\n  `````\nx\n``````');
});

test('lines keep no carriage return', () => {
  // Lines of a file with Windows line endings, split on `\n` only.
  expect(suggestionBlock(['a\r', 'b\r'])).toBe('```suggestion\na\nb\n```');
});

test('a fence after a tab counts and a tilde fence does not', () => {
  expect(suggestionBlock(['\t```', 'x'])).toBe('````suggestion\n\t```\nx\n````');
  expect(suggestionBlock(['~~~', 'x'])).toBe('```suggestion\n~~~\nx\n```');
});

test('backticks inside a line keep the usual fence', () => {
  expect(suggestionBlock(['let fence = "```";'])).toBe('```suggestion\nlet fence = "```";\n```');
});

test('only the heads lines take a suggestion', () => {
  expect(takesSuggestion(Lines.one(Line.right(4)))).toBe(true);
  expect(takesSuggestion(Lines.range(Line.right(2), Line.right(4)))).toBe(true);
  expect(takesSuggestion(Lines.one(Line.left(4)))).toBe(false);
  expect(takesSuggestion(Lines.range(Line.left(3), Line.right(4)))).toBe(false);
});
