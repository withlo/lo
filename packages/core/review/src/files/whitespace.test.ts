import { expect, test } from 'vitest';

import { withoutWhitespaceChanges } from './whitespace.ts';

/** How many line feeds `text` has. */
function lineFeeds(text: string): number {
  return text.split('\n').length - 1;
}

test('indentation alone leaves no change', () => {
  const old = 'fn main() {\nprintln!("hi");\n}\n';
  const head = 'fn main() {\n    println!("hi");\n}\n';
  expect(withoutWhitespaceChanges(old, head)).toBe(head);
});

test('changes to more than whitespace stay with the bases text', () => {
  const old = 'a\n  b\nc\nd  \n';
  const head = 'a\n\tb\nC\nd\n';
  // b's indentation and d's trailing spaces read as the head's; c's change stays.
  expect(withoutWhitespaceChanges(old, head)).toBe('a\n\tb\nc\nd\n');
});

test('added and deleted lines keep their places', () => {
  const old = 'keep\ngone\n  moved in\nend\n';
  const head = 'keep\nmoved in\nnew line\nend\n';
  // `gone` is deleted and `new line` added; `moved in` only lost its indentation.
  expect(withoutWhitespaceChanges(old, head)).toBe('keep\ngone\nmoved in\nend\n');
});

test('a blank line added is still a change', () => {
  const old = 'a\nb\n';
  const head = 'a\n\nb\n';
  expect(withoutWhitespaceChanges(old, head)).toBe(old);
});

test('only spaces tabs and line breaks count as whitespace', () => {
  // In JavaScript a line separator ends the line, so cleanup() becomes code.
  const old = '// TODO: call cleanup() later\n';
  const head = '// TODO: call\u2028cleanup() later\n';
  expect(withoutWhitespaceChanges(old, head)).toBe(old);
  // A no-break space in a string, an ideographic space, a form feed.
  const others = [
    ['s = "a b";\n', 's = "a\u00a0b";\n'],
    ['x = 1\n', 'x\u3000= 1\n'],
    ['a b\n', 'a\fb\n'],
  ] as const;
  expect(others.filter(([base, other]) => withoutWhitespaceChanges(base, other) !== base)).toEqual(
    [],
  );
  // Tabs and carriage returns are whitespace, as for `git diff -w`.
  expect(withoutWhitespaceChanges('a b\n', 'a\tb\r\n')).toBe('a\tb\r\n');
});

test('a missing final newline on either side keeps the bases lines', () => {
  // The head drops the base's last line and its own final newline.
  expect(withoutWhitespaceChanges('a\nb\nc\n', 'a\nb')).toBe('a\nb\nc\n');
  expect(withoutWhitespaceChanges('one\ntwo\nthree\nfour\n', 'one\n  two\nthree')).toBe(
    'one\n  two\nthree\nfour\n',
  );
  // The base has no final newline, and the head adds a line after it.
  expect(withoutWhitespaceChanges('a\n b', 'a\nb\nc\n')).toBe('a\nb');
  const pairs = [
    ['a\nb\nc\n', 'a\nb'],
    ['a\n b', 'a\nb\nc\n'],
  ] as const;
  expect(pairs.map(([base, head]) => lineFeeds(withoutWhitespaceChanges(base, head)))).toEqual(
    pairs.map(([base]) => lineFeeds(base)),
  );
});

test('whitespace inside a line is ignored too', () => {
  const old = 'let x = a+b;\n';
  const head = 'let x = a + b;\n';
  expect(withoutWhitespaceChanges(old, head)).toBe(head);
});
