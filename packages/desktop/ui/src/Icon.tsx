import { createElement, Fragment, type ReactNode } from 'react';

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
const MIRROR = 'matrix(-1 0 0 1 24 0)';

const SVG = 'http://www.w3.org/2000/svg';

export interface IconProps {
  /** The icon, by its Lucide name in `icons.ts`. */
  name: IconName;
  size: IconSize;
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
function classes(size: IconSize, className: string | undefined): string {
  return className === undefined ? SIZES[size] : `${SIZES[size]} ${className}`;
}

/**
 * One of Lo's icons, from Lucide (see `icons.ts`), in its text's color: stroke only, with round caps
 * and joins, and a stroke set in pixels for its size, so it weighs what the letters beside it do.
 * Nothing else in Lo draws an icon; a code view's own DOM takes {@link iconElement}.
 */
export function Icon({ name, size, label, className, mirrored = false }: IconProps) {
  const shapes: ReactNode = ICONS[name].map(([tag, attributes], index) =>
    createElement(tag, { key: index, ...attributes }),
  );
  return (
    <svg
      className={classes(size, className)}
      viewBox="0 0 24 24"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {mirrored ? <g transform={MIRROR}>{shapes}</g> : shapes}
    </svg>
  );
}

/**
 * The svg {@link Icon} draws, made in a code view's own DOM, where React doesn't reach. It takes
 * what `Icon` takes but the name and size as its options.
 */
export function iconElement(
  name: IconName,
  size: IconSize,
  { label, className, mirrored = false }: Omit<IconProps, 'name' | 'size'> = {},
): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  icon.setAttribute('class', classes(size, className));
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

export interface GlyphsProps {
  /** The string, as it's read aloud and copied. */
  text: string;
  /**
   * The icons' size: 12 beside `text-micro`, `text-small` and code, 14 beside `text-ui` and
   * larger.
   */
  size?: 12 | 14 | undefined;
}

/**
 * A string whose characters the fonts don't hold, such as `→` in `r1 → r3`, drawn with each one as
 * its icon from `glyphs.ts`, so it weighs what the letters beside it do. Each icon is hidden from
 * screen readers, and its character stays beside it, visually hidden (`sr-only`): what's read
 * aloud, copied and found as text is the string as it was.
 */
export function Glyphs({ text, size = 12 }: GlyphsProps) {
  return glyphPieces(text).map((piece, index) =>
    typeof piece === 'string' ? (
      <Fragment key={index}>{piece}</Fragment>
    ) : (
      <Fragment key={index}>
        <Icon name={piece.glyph.icon} size={size} mirrored={piece.glyph.mirrored} />
        <span className="sr-only">{piece.character}</span>
      </Fragment>
    ),
  );
}
