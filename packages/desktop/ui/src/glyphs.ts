import type { IconName } from './icons.ts';

/** How a character is drawn as an icon: which, and whether it faces the other way. */
export interface Glyph {
  readonly icon: IconName;
  readonly mirrored?: true;
}

/**
 * The characters Lo draws as icons, each with its icon. Host Grotesk and Fragment Mono hold none of
 * them but `↑` and `↓`, so the system would draw each in another weight; all four arrows are icons,
 * so they match. The keys' symbols come first, as macOS writes a key (Linux writes words, but for
 * the arrows), then the rest. `· › … –` and curly quotes are in both fonts (`fonts.css`), and stay
 * characters.
 */
export const GLYPHS: ReadonlyMap<string, Glyph> = new Map<string, Glyph>([
  ['⌘', { icon: 'command' }],
  ['⌃', { icon: 'chevron-up' }],
  ['⌥', { icon: 'option' }],
  ['⇧', { icon: 'arrow-big-up' }],
  ['⏎', { icon: 'corner-down-left' }],
  ['⇥', { icon: 'arrow-right-to-line' }],
  ['⌫', { icon: 'delete' }],
  ['⌦', { icon: 'delete', mirrored: true }],
  ['↑', { icon: 'arrow-up' }],
  ['↓', { icon: 'arrow-down' }],
  // The arrow keys, and in text a revision range, a rename or a size: `r1 → r3`.
  ['←', { icon: 'arrow-left' }],
  ['→', { icon: 'arrow-right' }],
  // A link that leaves Lo, as a check's details.
  ['↗', { icon: 'arrow-up-right' }],
  // A step that's done.
  ['✓', { icon: 'check' }],
  // More actions.
  ['⋯', { icon: 'ellipsis' }],
  // Moved code, in its gutter.
  ['⇄', { icon: 'arrow-left-right' }],
]);

/** A character of {@link GLYPHS} in a string, with how it's drawn. */
export interface GlyphPiece {
  readonly character: string;
  readonly glyph: Glyph;
}

/**
 * `text` in pieces: the runs of characters the fonts draw, as strings, and each character of
 * {@link GLYPHS} on its own. `r1 → r3` is `['r1 ', →, ' r3']`.
 */
export function glyphPieces(text: string): (string | GlyphPiece)[] {
  const pieces: (string | GlyphPiece)[] = [];
  let run = '';
  for (const character of text) {
    const glyph = GLYPHS.get(character);
    if (glyph === undefined) {
      run += character;
      continue;
    }
    if (run !== '') pieces.push(run);
    run = '';
    pieces.push({ character, glyph });
  }
  if (run !== '') pieces.push(run);
  return pieces;
}
