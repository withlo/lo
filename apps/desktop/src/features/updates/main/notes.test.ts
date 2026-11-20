import { describe, expect, it } from 'vitest';

import { characters, LINE_LIMIT } from '../contract.ts';
import { cut, firstLine } from './notes.ts';

describe('the first line of the notes', () => {
  it('is the first line of text in GitHub’s HTML', () => {
    expect(
      firstLine(
        '<h2>Faster diffs &amp; quieter toasts</h2>\n<ul>\n<li>Diffs open in half the time.</li>\n</ul>',
      ),
    ).toBe('Faster diffs & quieter toasts');
    expect(
      firstLine('<p>Lo <strong>0.2.0</strong> reads <code>&lt;stack&gt;</code>s.<br>More.</p>'),
    ).toBe('Lo 0.2.0 reads <stack>s.');
  });

  it('skips lines with no text', () => {
    expect(firstLine('\n\n  <p> </p>\n<p>\n  Faster diffs.\n</p>')).toBe('Faster diffs.');
  });

  it('reads the entities HTML writes, and leaves others as they are', () => {
    expect(
      firstLine('<p>Lo&#39;s &#x201C;stacks&#x201D; &hellip; &nbsp;&bogus; &#0; &#xD800;</p>'),
    ).toBe("Lo's “stacks” … &bogus; &#0; &#xD800;");
  });

  it('is plain text, without the tags of HTML that hides or links', () => {
    expect(
      firstLine('<p><a href="https://example.com">Read this</a><img src=x onerror=alert(1)>!</p>'),
    ).toBe('Read this!');
    expect(firstLine('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('drops a Markdown heading’s or list item’s mark, from notes given as text', () => {
    expect(firstLine('## Highlights\n\n- Faster diffs')).toBe('Highlights');
    expect(firstLine('- Faster diffs\n- Quieter toasts')).toBe('Faster diffs');
  });

  it('drops controls and the characters that turn text around', () => {
    expect(firstLine('Faster\u0007 diffs‮.txt‬⁦ now⁩')).toBe('Faster diffs.txt now');
  });

  it('is the newest release’s, when electron-updater gives the notes of several', () => {
    expect(
      firstLine([
        { version: '0.3.0', note: '<p>Newest.</p>' },
        { version: '0.2.0', note: '<p>Older.</p>' },
      ]),
    ).toBe('Newest.');
    expect(firstLine([{ version: '0.3.0', note: null }])).toBe('');
  });

  it('is empty for notes with no text, or none', () => {
    for (const notes of [null, undefined, '', '<p></p>', [], 42]) {
      expect(firstLine(notes)).toBe('');
    }
  });

  it('is cut to 140 characters', () => {
    const long = 'Lo reads pull requests. '.repeat(20);
    const line = firstLine(`<p>${long}</p>`);
    expect(characters(line)).toBeLessThanOrEqual(LINE_LIMIT);
    expect(line.endsWith('…')).toBe(true);
    expect(long.startsWith(line.slice(0, -1))).toBe(true);
  });
});

describe('cutting a line', () => {
  it('counts characters as a person does, and never splits one', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(cut(family.repeat(LINE_LIMIT))).toBe(family.repeat(LINE_LIMIT));
    const cutFamilies = cut(family.repeat(LINE_LIMIT + 1));
    expect(cutFamilies).toBe(`${family.repeat(LINE_LIMIT - 1)}…`);
    expect(characters(cutFamilies)).toBe(LINE_LIMIT);
  });

  it('leaves a line that fits as it is', () => {
    expect(cut('a'.repeat(LINE_LIMIT))).toBe('a'.repeat(LINE_LIMIT));
  });
});
