// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Key } from './Key.tsx';
import { keyCap } from './keyCap.ts';

/** `markup` in a page, for its key caps. */
function capsOf(markup: string): HTMLElement[] {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return [...host.querySelectorAll('kbd')];
}

/** What a cap draws, in order: each icon by its size's class, each run of text as itself. */
function drawn(cap: Element): string[] {
  return [...cap.childNodes].flatMap((node) => {
    if (node instanceof SVGElement) return [`<${node.getAttribute('class') ?? ''}>`];
    if (node instanceof HTMLElement) return [];
    return [node.textContent ?? ''];
  });
}

describe('Key', () => {
  it('draws a key’s symbols as 12 px icons, hidden, and its letters as text', () => {
    const [cap] = capsOf(renderToStaticMarkup(<Key keys={['⌘⇧P']} />));
    expect(drawn(cap!)).toEqual(['<lo-i lo-i--xs>', '<lo-i lo-i--xs>', 'P']);
    expect(
      [...cap!.querySelectorAll('svg')].map((icon) => icon.getAttribute('aria-hidden')),
    ).toEqual(['true', 'true']);
    // What's read aloud, copied and found is the key as it was given.
    expect(cap!.textContent).toBe('⌘⇧P');
  });

  it('keeps a key with a name, and Linux’s keys, as words, but for the arrows', () => {
    for (const key of ['Esc', 'Space', 'PgDn', 'F10', 'Ctrl+Shift+P', 'Shift+Tab', 'Enter']) {
      const [cap] = capsOf(renderToStaticMarkup(<Key keys={[key]} />));
      expect(drawn(cap!)).toEqual([key]);
    }
    const arrows = capsOf(renderToStaticMarkup(<Key keys={['↑', '↓', '←', '→']} />));
    expect(arrows.map((cap) => drawn(cap))).toEqual([
      ['<lo-i lo-i--xs>'],
      ['<lo-i lo-i--xs>'],
      ['<lo-i lo-i--xs>'],
      ['<lo-i lo-i--xs>'],
    ]);
  });

  it('draws each key of a sequence in a cap of its own', () => {
    const caps = capsOf(renderToStaticMarkup(<Key keys={[']', 'f']} />));
    expect(caps.map((cap) => cap.textContent)).toEqual([']', 'f']);
    expect(caps.every((cap) => cap.querySelector('svg') === null)).toBe(true);
  });
});

describe('keyCap', () => {
  it('makes the cap Key draws inside, for a code view’s tooltip', () => {
    for (const label of ['⌥⏎', '⇧⇥', '⌦', 'Ctrl+Enter', ']']) {
      const made = keyCap(label);
      const [cap] = capsOf(renderToStaticMarkup(<Key keys={[label]} />));
      expect(made.localName).toBe('kbd');
      expect(made.className).toBe('key-icons');
      expect(made.innerHTML).toBe(cap!.innerHTML);
      expect(made.textContent).toBe(label);
    }
  });
});
