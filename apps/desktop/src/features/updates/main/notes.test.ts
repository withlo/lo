import { describe, expect, it } from 'vitest';

import { characters, LINE_LIMIT } from '../contract.ts';
import { cut, firstLine, READ_LIMIT } from './notes.ts';

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

  it('drops what the reader can\u2019t see and changes what they read', () => {
    // Zero-width space and non-joiner, word joiner, the invisible operators, the Mongolian vowel
    // separator and the byte order mark; the soft hyphen and the combining grapheme joiner; the
    // Hangul fillers; the marks that set off an annotation; the direction marks; and tags, which
    // spell out "hi".
    const hidden = [
      '\u200B',
      '\u200C',
      '\u2060',
      '\u2061',
      '\u2064',
      '\u180E',
      '\uFEFF',
      '\u00AD',
      '\u034F',
      '\u115F',
      '\u1160',
      '\u3164',
      '\uFFA0',
      '\uFFF9',
      '\uFFFA',
      '\uFFFB',
      '\u200E',
      '\u200F',
      '\u061C',
      '\u{E0001}\u{E0068}\u{E0069}\u{E007F}',
    ];
    for (const character of hidden) {
      expect(firstLine(`<p>Faster${character} diffs.${character}txt</p>`)).toBe('Faster diffs.txt');
    }
    expect(firstLine('\uFEFF\u200B\n<p>Lo\uFEFFreads</p>')).toBe('Loreads');
  });

  it('spaces the words a next line, line separator or paragraph separator splits', () => {
    expect(firstLine('Faster\u0085diffs\u2028and\u2029quieter toasts')).toBe(
      'Faster diffs and quieter toasts',
    );
  });

  it('keeps what emoji are made of', () => {
    const family = '👨\u200D👩\u200D👧';
    const heart = '❤\uFE0F';
    expect(firstLine(`<p>${family} ${heart}</p>`)).toBe(`${family} ${heart}`);
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

  it('reads no further than the first 64 KiB of the notes', () => {
    expect(firstLine(`${' '.repeat(READ_LIMIT - 4)}Late`)).toBe('Late');
    expect(firstLine(`${' '.repeat(READ_LIMIT - 3)}Late`)).toBe('Lat');
    expect(firstLine(`${'\n'.repeat(READ_LIMIT)}Too late`)).toBe('');
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
