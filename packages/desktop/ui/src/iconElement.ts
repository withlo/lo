// An icon as `Icon` draws it, made in a code view's own DOM, where React doesn't reach, and what the
// two share: the sizes, each size's classes, and how an icon faces the other way; and a string as
// `Glyphs` draws it there. It has no JSX, so a code view's source, which is also built where JSX
// isn't, can import it.

import { glyphPieces } from './glyphs.ts';
import { ICONS, type IconName } from './icons.ts';

/**
 * The sizes an icon is drawn at, in px, each with its stroke in pixels: 12 at 1.25 px beside
 * `text-micro`, `text-small` and in a key chip; 14 at 1.25 px beside `text-ui`; 16 at 1.5 px alone
 * in a control and beside titles and reading text; 24 at 1.5 px in an empty state.
 */
export type IconSize = 12 | 14 | 16 | 24;

/**
 * Each size's classes in `design/css/base.css`, which set its box, its stroke on the 24 grid (the
 * stroke in px × 24 ÷ the size) and where it sits on the line.
 */
const SIZES: Readonly<Record<IconSize, string>> = {
  12: 'lo-i lo-i--xs',
  14: 'lo-i lo-i--sm',
  16: 'lo-i',
  24: 'lo-i lo-i--lg',
};

/** Mirrors the 24 grid left to right, as Forward Delete's key faces the other way to Backspace's. */
export const MIRROR = 'matrix(-1 0 0 1 24 0)';

const SVG = 'http://www.w3.org/2000/svg';

/** How an icon is drawn, beyond which one and its size. */
export interface IconOptions {
  /**
   * What the icon means, for an icon with no words beside it that's a mark of its own: it's then an
   * image by that name. Without it, the icon is hidden from screen readers, as one beside its words
   * or in a control that names itself.
   */
  label?: string | undefined;
  /** More classes, such as its color where it isn't the text's. */
  className?: string | undefined;
  /** Drawn facing the other way, left to right. */
  mirrored?: boolean | undefined;
}

/** The classes an icon of `size` takes, with `className`. */
export function iconClasses(size: IconSize, className: string | undefined): string {
  return className === undefined ? SIZES[size] : `${SIZES[size]} ${className}`;
}

/**
 * The svg `Icon` draws, made in a code view's own DOM, where React doesn't reach. It takes what
 * `Icon` takes but the name and size as its options.
 */
export function iconElement(
  name: IconName,
  size: IconSize,
  { label, className, mirrored = false }: IconOptions = {},
): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  icon.setAttribute('class', iconClasses(size, className));
  icon.setAttribute('viewBox', '0 0 24 24');
  if (label === undefined) {
    icon.setAttribute('aria-hidden', 'true');
  } else {
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', label);
  }
  let holder: SVGElement = icon;
  if (mirrored) {
    holder = document.createElementNS(SVG, 'g');
    holder.setAttribute('transform', MIRROR);
    icon.append(holder);
  }
  for (const [tag, attributes] of ICONS[name]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [attribute, value] of Object.entries(attributes)) {
      if (value !== undefined) shape.setAttribute(attribute, String(value));
    }
    holder.append(shape);
  }
  return icon;
}

/**
 * `text` as `Glyphs` draws it, made in a code view's own DOM: each character the fonts don't hold,
 * as the `←` of a rename, as its icon from `glyphs.ts` at `size`, hidden from screen readers, with
 * the character beside it, visually hidden, so what's read aloud, copied and found as text is the
 * string as it was.
 */
export function glyphNodes(text: string, size: 12 | 14 = 12): (Node | string)[] {
  return glyphPieces(text).flatMap((piece): (Node | string)[] => {
    if (typeof piece === 'string') return [piece];
    const said = document.createElement('span');
    said.className = 'sr-only';
    said.textContent = piece.character;
    return [iconElement(piece.glyph.icon, size, { mirrored: piece.glyph.mirrored }), said];
  });
}
