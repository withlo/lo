import { createElement, Fragment, type ReactNode } from 'react';

import { glyphPieces } from './glyphs.ts';
import { iconClasses, MIRROR, type IconOptions, type IconSize } from './iconElement.ts';
import { ICONS, type IconName } from './icons.ts';

export { iconElement, type IconOptions, type IconSize } from './iconElement.ts';

export interface IconProps extends IconOptions {
  /** The icon, by its Lucide name in `icons.ts`. */
  name: IconName;
  size: IconSize;
}

/**
 * One of Lo's icons, from Lucide (see `icons.ts`), in its text's color: stroke only, with round caps
 * and joins, and a stroke set in pixels for its size, so it weighs what the letters beside it do.
 * Nothing else in Lo draws an icon; a code view's own DOM takes `iconElement`.
 */
export function Icon({ name, size, label, className, mirrored = false }: IconProps) {
  const shapes: ReactNode = ICONS[name].map(([tag, attributes], index) =>
    createElement(tag, { key: index, ...attributes }),
  );
  return (
    <svg
      className={iconClasses(size, className)}
      viewBox="0 0 24 24"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {mirrored ? <g transform={MIRROR}>{shapes}</g> : shapes}
    </svg>
  );
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
