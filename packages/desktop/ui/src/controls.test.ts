// What the format characters in text from a server or a repository show as: every one, as its code
// point, in a name or in code; and in prose all but the few that real scripts and emoji need.

import { describe, expect, it } from 'vitest';

import { hasFormat, showFormat, showProse, splitFormat, withoutBidi } from './controls.ts';

/** The code points of the marks in `text`, in order, as names show them. */
function marks(text: string, prose = false): string[] {
  return splitFormat(text, prose).flatMap((piece) => (typeof piece === 'string' ? [] : piece.code));
}

describe('splitFormat', () => {
  it('shows every format character in a name, however it hides or reorders the rest', () => {
    const hidden = [
      ['­', 'U+00AD'],
      ['؜', 'U+061C'],
      ['᠎', 'U+180E'],
      ['​', 'U+200B'],
      ['‌', 'U+200C'],
      ['‍', 'U+200D'],
      ['‎', 'U+200E'],
      ['‏', 'U+200F'],
      ['‪', 'U+202A'],
      ['‫', 'U+202B'],
      ['‬', 'U+202C'],
      ['‭', 'U+202D'],
      ['‮', 'U+202E'],
      ['⁠', 'U+2060'],
      ['⁢', 'U+2062'],
      ['⁦', 'U+2066'],
      ['⁧', 'U+2067'],
      ['⁨', 'U+2068'],
      ['⁩', 'U+2069'],
      ['﻿', 'U+FEFF'],
      // Tag characters, which can carry a whole message that no one sees.
      ['\u{E0001}', 'U+E0001'],
      ['\u{E0041}', 'U+E0041'],
      ['\u{E007F}', 'U+E007F'],
    ] as const;
    for (const [char, code] of hidden) {
      const [before, mark, after, ...rest] = splitFormat(`fo${char}o`);
      expect([before, after, rest]).toEqual(['fo', 'o', []]);
      expect(mark).toMatchObject({ code });
    }
  });

  it('shows the direction marks of a right-to-left name, which a name must not hide either', () => {
    expect(marks('שלום‏!')).toEqual(['U+200F']);
    expect(marks('abc؜def')).toEqual(['U+061C']);
  });

  it('never drops a character, so the text is whole again with the marks put back', () => {
    const text = 'a​b‮c\u{E0041}d﻿';
    const whole = splitFormat(text)
      .map((piece) =>
        typeof piece === 'string'
          ? piece
          : String.fromCodePoint(Number.parseInt(piece.code.slice(2), 16)),
      )
      .join('');
    expect(whole).toBe(text);
    expect(marks(text)).toEqual(['U+200B', 'U+202E', 'U+E0041', 'U+FEFF']);
  });

  it('names the common ones, for the title of the mark, and no others', () => {
    const [, override, , zero, , unnamed] = splitFormat('a‮b​c⁤d\u{E0041}e');
    expect(override).toEqual({ code: 'U+202E', name: 'right-to-left override' });
    expect(zero).toEqual({ code: 'U+200B', name: 'zero width space' });
    expect(unnamed).toEqual({ code: 'U+2064', name: 'invisible plus' });
    expect(marks('\u{E0041}')).toEqual(['U+E0041']);
    expect(splitFormat('\u{E0041}')).toEqual([{ code: 'U+E0041', name: undefined }]);
  });

  it('leaves what only looks like one alone: spaces, variation selectors, ordinary text', () => {
    expect(splitFormat('a b c　d ️ é café \u{1F468}‍\u{1F469}'.replace('‍', ''))).toEqual([
      'a b c　d ️ é café \u{1F468}\u{1F469}',
    ]);
    expect(splitFormat('')).toEqual([]);
    expect(hasFormat('plain')).toBe(false);
    expect(hasFormat('p​lain')).toBe(true);
  });

  it('is never the replacement character, which stands for any of them and says none', () => {
    const shown = showFormat('a‮b​c');
    expect(shown).not.toContain('�');
    expect(shown).toBe('a‹U+202E›b‹U+200B›c');
  });
});

describe('in prose', () => {
  const kept = ['‎', '‏', '؜', '‌', '‍'];

  it('keeps the marks and joiners that real scripts and emoji are written with', () => {
    for (const char of kept) expect(marks(`a${char}b`, true)).toEqual([]);
    // A Hebrew sentence ending in a right-to-left mark, an Arabic one in an Arabic letter mark,
    // and a family emoji joined by zero-width joiners.
    const hebrew = 'שלום!‏';
    expect(splitFormat(hebrew, true)).toEqual([hebrew]);
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(splitFormat(family, true)).toEqual([family]);
    expect(showProse(`${hebrew} ${family}`)).toBe(`${hebrew} ${family}`);
  });

  it('shows the embeddings, overrides and isolates, which reorder the text around them', () => {
    const nine = ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩'];
    expect(marks(nine.join('x'), true)).toEqual([
      'U+202A',
      'U+202B',
      'U+202C',
      'U+202D',
      'U+202E',
      'U+2066',
      'U+2067',
      'U+2068',
      'U+2069',
    ]);
  });

  it('shows what hides text, too: zero-width spaces, word joiners and tag characters', () => {
    expect(marks('a​b⁠c\u{E0041}d­e﻿', true)).toEqual([
      'U+200B',
      'U+2060',
      'U+E0041',
      'U+00AD',
      'U+FEFF',
    ]);
    expect(showProse('ig‮nore‍')).toBe('ig‹U+202E›nore‍');
  });

  it('splits text so the marks and the stretches around them are in order', () => {
    expect(splitFormat('a‮b‏c', true)).toEqual([
      'a',
      { code: 'U+202E', name: 'right-to-left override' },
      'b‏c',
    ]);
  });
});

describe('withoutBidi', () => {
  it('drops the embeddings, overrides and isolates that turn the text after them around', () => {
    expect(withoutBidi('evil\u202Etxt.exe')).toBe('eviltxt.exe');
    expect(withoutBidi('\u202Aa\u202Bb\u202Cc\u202Dd\u202Ee')).toBe('abcde');
    expect(withoutBidi('\u2066a\u2067b\u2068c\u2069')).toBe('abc');
  });

  it('keeps the marks that right-to-left text places numbers and punctuation with', () => {
    expect(withoutBidi('a\u200Eb\u200Fc\u061Cd')).toBe('a\u200Eb\u200Fc\u061Cd');
    expect(withoutBidi('Fix the null check in #4821')).toBe('Fix the null check in #4821');
  });
});
