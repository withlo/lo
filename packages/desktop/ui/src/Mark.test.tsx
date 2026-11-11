import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Mark } from './Mark.tsx';

/** The brand's own file for the mark, which the component draws the shapes of. */
const brand = readFileSync(new URL('../../../../brand/logo/mark.svg', import.meta.url), 'utf8');

/** The shapes of an SVG: its paths' data and its circles' attributes, in order. */
function shapes(svg: string): string[] {
  return [...svg.matchAll(/<(?:path|circle)\b[^>]*>/g)].map((each) =>
    each[0].replaceAll(/\s*\/?>$/g, '').replaceAll(/\s+/g, ' '),
  );
}

describe('Mark', () => {
  it('draws the brand’s mark, shape for shape, in the mark’s color and no other', () => {
    const drawn = renderToStaticMarkup(<Mark className="size-48" />);
    expect(shapes(drawn)).toEqual(shapes(brand));
    expect(drawn).toContain('viewBox="12 12 76 76"');
    expect(drawn).toContain('fill-mark');
    expect(drawn).toContain('aria-label="Lo"');
    expect(drawn).toContain('class="size-48"');
  });
});
