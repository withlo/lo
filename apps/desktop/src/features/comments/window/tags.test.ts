import { describe, expect, it } from 'vitest';

import { holdsTag } from './tags.ts';

/** A review's text as Cursor Bugbot writes it: an image link and two lines in `<sup>`. */
const BUGBOT = [
  'Cursor Bugbot has reviewed your changes and found 2 potential issues.',
  '',
  '<a href="https://cursor.com/open?x=1" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/dark.png"><img alt="Fix All in Cursor" width="115" height="28" src="https://cursor.com/dark.png"></picture></a>',
  '',
  '<sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 73ae3d3.</sup>',
].join('\n');

describe('holdsTag', () => {
  it('finds a tag, a closing tag and a comment: `<` then a letter, `/` or `!`', () => {
    expect(holdsTag(BUGBOT)).toBe(true);
    expect(holdsTag('Line one<br>line two')).toBe(true);
    expect(holdsTag('ends here</details>')).toBe(true);
    expect(holdsTag('<!-- hidden -->Shown')).toBe(true);
    expect(holdsTag('<DIV>upper case</DIV>')).toBe(true);
  });

  it('finds none in text whose `<` starts no tag', () => {
    expect(holdsTag('Plain **Markdown** with a [link](https://example.com).')).toBe(false);
    expect(holdsTag('if a < b and 1<2, or a <= b, then <3 and <-')).toBe(false);
    expect(holdsTag('')).toBe(false);
  });

  it('finds none in code, which GitHub shows as written', () => {
    expect(holdsTag('Should this be `Promise<void>`?')).toBe(false);
    expect(holdsTag('Two ticks: ``a ` <b> `` and one: `</div>`')).toBe(false);
    expect(holdsTag('```ts\nconst list: Array<string> = [];\n```')).toBe(false);
    expect(holdsTag('Before\n\n~~~~html\n<div>\n\n</div>\n~~~~\n\nAfter')).toBe(false);
    expect(holdsTag('- item\n\n  ```\n  <img src="x">\n  ```')).toBe(false);
    expect(holdsTag('> ```\n> <b>quoted code</b>\n> ```')).toBe(false);
  });

  it('finds a tag outside code beside it', () => {
    expect(holdsTag('`code` and <b>bold</b>')).toBe(true);
    expect(holdsTag('```\ncode\n```\n<b>after</b>')).toBe(true);
    // In a span a backslash is itself, so it ends at the tick after it.
    expect(holdsTag('`a\\` <b>b</b> `c`')).toBe(true);
  });

  it('reads as text what it can’t tell is code, so no tag is missed', () => {
    // A backtick with no run to close it, or one escaped.
    expect(holdsTag('`unclosed <b>bold</b>')).toBe(true);
    expect(holdsTag('\\`<b>bold</b>`')).toBe(true);
    // A fence with no end, or whose lines leave it before its closing fence.
    expect(holdsTag('```\n<div>')).toBe(true);
    expect(holdsTag('- item\n  ```\n  code\n<b>out of the list</b>\n  ```')).toBe(true);
    expect(holdsTag('> ```\n<b>out of the quote</b>\n> ```')).toBe(true);
    // A backtick fence with a backtick after it is no fence.
    expect(holdsTag('```a`b\n<b>x</b>\n```')).toBe(true);
    // A code span across lines.
    expect(holdsTag('`one\n<b>two</b>`')).toBe(true);
  });

  it('reads all of a post as text once it has looked through too many lines for fences’ ends', () => {
    // Each line opens a fence that no line after it closes.
    expect(holdsTag(`${'~~~ a\n'.repeat(40_000)}<b>x</b>`)).toBe(true);
    expect(holdsTag(`${'~~~ a\n'.repeat(40_000)}no tag`)).toBe(false);
  });
});
