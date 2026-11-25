// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GLYPHS, glyphPieces } from './glyphs.ts';
import { Glyphs } from './Icon.tsx';

/** `text` drawn by `Glyphs`, in an element of its own. */
function drawn(text: string, size?: 12 | 14): HTMLElement {
  const host = document.createElement('span');
  host.innerHTML = renderToStaticMarkup(<Glyphs text={text} size={size} />);
  return host;
}

describe('glyphPieces', () => {
  it('parts the characters the fonts draw from those drawn as icons', () => {
    expect(glyphPieces('r1 → r3')).toEqual([
      'r1 ',
      { character: '→', glyph: { icon: 'arrow-right' } },
      ' r3',
    ]);
    expect(
      glyphPieces('⌘⇧P').map((piece) => (typeof piece === 'string' ? piece : piece.glyph.icon)),
    ).toEqual(['command', 'arrow-big-up', 'P']);
    expect(glyphPieces('a · b › c … d – e “f”')).toEqual(['a · b › c … d – e “f”']);
    expect(glyphPieces('')).toEqual([]);
  });

  it('draws Forward Delete as Backspace facing the other way', () => {
    expect(GLYPHS.get('⌫')).toEqual({ icon: 'delete' });
    expect(GLYPHS.get('⌦')).toEqual({ icon: 'delete', mirrored: true });
  });
});

describe('Glyphs', () => {
  it('draws each character as a hidden icon, and keeps the string as its text', () => {
    const host = drawn('No changes in r1 → r3');
    expect(host.textContent).toBe('No changes in r1 → r3');
    const icon = host.querySelector('svg');
    expect(icon?.getAttribute('class')).toBe('lo-i lo-i--xs');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.nextElementSibling?.className).toBe('sr-only');
    expect(icon?.nextElementSibling?.textContent).toBe('→');
  });

  it('draws every character of the table, at 14 px beside text-ui', () => {
    const text = [...GLYPHS.keys()].join('');
    const host = drawn(text, 14);
    expect(host.textContent).toBe(text);
    expect(host.querySelectorAll('svg.lo-i--sm')).toHaveLength(GLYPHS.size);
    expect(host.querySelectorAll('svg g[transform]')).toHaveLength(1);
  });

  it('leaves a string with none of them as it is', () => {
    expect(drawn('Fix the gutter').innerHTML).toBe('Fix the gutter');
  });
});
