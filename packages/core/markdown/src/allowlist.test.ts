import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  FIGURE_COLORS,
  isSvgAttribute,
  readValue,
  SVG_ELEMENTS,
  svgRule,
  type SvgValue,
} from './allowlist.ts';

/** Each of `values` read as `kind`, as it's kept, or null when it's refused. */
function read(kind: SvgValue, values: string[]): (string | null)[] {
  return values.map((value) => readValue(kind, value)?.value ?? null);
}

describe('numbers and lengths', () => {
  test('are kept as JavaScript writes them', () => {
    expect(
      read('coordinate', [
        '0',
        '-0',
        '+1',
        '.5',
        '1.',
        '1e2',
        '1E-7',
        ' 12.50 ',
        '3px',
        '2EM',
        '50%',
      ]),
    ).toEqual(['0', '0', '1', '0.5', '1', '100', '1e-7', '12.5', '3px', '2em', '50%']);
  });

  test('huge, malformed or out of range, they are refused', () => {
    expect(
      read('coordinate', [
        '1e7',
        '-1000001',
        '1e309',
        '9'.repeat(400),
        `0.${'0'.repeat(70)}1`,
        'NaN',
        'Infinity',
        '0x10',
        '1_000',
        '1 px',
        '1pt',
        '1px;',
        '',
        ' 1',
        '１',
      ]),
    ).toEqual(Array.from({ length: 15 }, () => null));
    expect(read('size', ['-1', '-0.1'])).toEqual([null, null]);
    expect(read('opacity', ['0', '1', '0.25', '1.5', '-0.1'])).toEqual([
      '0',
      '1',
      '0.25',
      null,
      null,
    ]);
    expect(read('miter', ['1', '4', '0.5'])).toEqual(['1', '4', null]);
  });

  test('lists are separated by spaces or one comma', () => {
    expect(read('viewBox', ['0 0 860 120', '0,0,860,120', ' 0 , 0 860\n120 '])).toEqual([
      '0 0 860 120',
      '0 0 860 120',
      '0 0 860 120',
    ]);
    expect(
      read('viewBox', ['0 0 860', '0 0 0 1', '0 0 1 -1', '0,,0,1,1', ',0 0 1 1', '0 0 1 1,']),
    ).toEqual(Array.from({ length: 6 }, () => null));
    expect(read('points', ['0,0 10,10', '0 0 1', ''])).toEqual(['0 0 10 10', null, null]);
    expect(read('coordinates', ['1 2em 3%', '1,,2'])).toEqual(['1 2em 3%', null]);
    expect(read('dashes', ['4 2', 'none', '4,-2'])).toEqual(['4 2', 'none', null]);
  });
});

describe('colors', () => {
  test("Lo's figure colors, plain colors, none and currentColor", () => {
    expect(
      read('paint', [
        'var(--fig-blue)',
        'VAR( --fig-blue-soft )',
        'none',
        'currentcolor',
        'CurrentColor',
        'transparent',
        'Red',
        'rebeccapurple',
        '#ABC',
        '#a5c5e9',
        '#a5c5e980',
        'rgb(1, 2, 3)',
        'rgba(10%,20%,30%,0.5)',
      ]),
    ).toEqual([
      'var(--fig-blue)',
      'var(--fig-blue-soft)',
      'none',
      'currentColor',
      'currentColor',
      'transparent',
      'red',
      'rebeccapurple',
      '#abc',
      '#a5c5e9',
      '#a5c5e980',
      'rgb(1,2,3)',
      'rgba(10%,20%,30%,0.5)',
    ]);
    expect(read('color', ['none', 'red'])).toEqual([null, 'red']);
  });

  test('anything else in CSS is refused', () => {
    const refused = [
      'url(#gradient)',
      'url(https://evil.example/x.svg#p)',
      'url(data:image/svg+xml,<svg/>)',
      'URL(#a)',
      'red url(#a)',
      'var(--fig-blue, red)',
      'var(--fig-blue,url(https://evil.example/))',
      'var(--lo-accent)',
      'var(--fig-font)',
      'var(--fig-Blue)',
      'var(--fig-blue) red',
      'var(var(--fig-blue))',
      'expression(alert(1))',
      String.raw`\72 ed`,
      String.raw`r\65 d`,
      String.raw`var(--fig\-blue)`,
      're/**/d',
      'red;fill:blue',
      'red !important',
      '@import "x"',
      'inherit',
      'initial',
      'unset',
      'context-fill',
      '#ggg',
      '#12345',
      'rgb(1,2)',
      'rgb(1,2,3,4,5)',
      'rgb(300,0,0)',
      'rgb(calc(1),2,3)',
      'rgb(from red r g b)',
      'hsl(0,0%,0%)',
      'javascript:alert(1)',
      ' red',
      'red\u0000',
    ];
    expect(read('paint', refused).filter((value) => value !== null)).toEqual([]);
  });

  test('are the figure colors the design defines', () => {
    const tokens: unknown = JSON.parse(
      readFileSync(new URL('../../../../design/tokens.json', import.meta.url), 'utf8'),
    );
    // Every token named `fig-*` whose value is a color for each theme.
    const names: string[] = [];
    const stack: unknown[] = [tokens];
    while (stack.length > 0) {
      const value = stack.pop();
      if (Array.isArray(value)) stack.push(...value);
      else if (typeof value === 'object' && value !== null) {
        const { name, value: held } = value as { name?: unknown; value?: unknown };
        if (typeof name === 'string' && name.startsWith('fig-') && typeof held === 'object') {
          names.push(name);
        }
        stack.push(...Object.values(value));
      }
    }
    expect(names.toSorted()).toEqual(FIGURE_COLORS.toSorted());
  });
});

describe('paths', () => {
  test('are read as SVG reads them, and written with their numbers apart', () => {
    expect(
      read('path', [
        'M126 54h20',
        'M10-20L.5.5',
        'm0,0 l 1 , 1',
        'M0 0 10 10 20 0z',
        'M0 0zm5 5h1',
        'M0 0a5 5 0 0110 10',
        'M0 0A5,5,30,1,0,10,10',
        'M0 0C1 2 3 4 5 6S7 8 9 10Q1 1 2 2T3 3V9H1Z',
        'M1e2 -1E-1',
      ]),
    ).toEqual([
      'M126 54h20',
      'M10 -20L0.5 0.5',
      'm0 0l1 1',
      'M0 0 10 10 20 0z',
      'M0 0zm5 5h1',
      'M0 0a5 5 0 0 1 10 10',
      'M0 0A5 5 30 1 0 10 10',
      'M0 0C1 2 3 4 5 6S7 8 9 10Q1 1 2 2T3 3V9H1Z',
      'M100 -0.1',
    ]);
  });

  test('and refused whole at the first mistake', () => {
    const refused = [
      '',
      ' ',
      'L0 0',
      'M0',
      'M0 0 1',
      'M0 0,',
      'M0 0,L1 1',
      'M0,,0',
      'M0 0z1 1',
      'M0 0a5 5 0 2 1 10 10',
      'M0 0a5 5 0 0 -1 10 10',
      'M0 0X1',
      'M1e7 0',
      `M${'9'.repeat(400)} 0`,
      'M0 0 url(#a)',
      'M0 0;',
      'M0 0',
      'M0 0e',
    ];
    expect(read('path', refused).filter((value) => value !== null)).toEqual([]);
  });

  test('count their numbers and vertices', () => {
    expect(readValue('path', 'M0 0 1 1 2 2h3z')).toEqual({
      value: 'M0 0 1 1 2 2h3z',
      numbers: 7,
      vertices: 4,
    });
    expect(readValue('points', '0 0 1 1 2 2')).toMatchObject({ numbers: 6, vertices: 3 });
  });
});

describe('transforms', () => {
  test('are a list of SVG transforms, each with as many numbers as it takes', () => {
    expect(
      read('transform', [
        'translate(10)',
        'translate(10 20) rotate(45)',
        'rotate(45, 10,10),scale(2)',
        'matrix(1 0 0 1 0 0)',
        'skewX(10) skewY(-5)',
      ]),
    ).toEqual([
      'translate(10)',
      'translate(10,20) rotate(45)',
      'rotate(45,10,10) scale(2)',
      'matrix(1,0,0,1,0,0)',
      'skewX(10) skewY(-5)',
    ]);
    const refused = [
      '',
      'translate(10px)',
      'translate(1,2,3)',
      'rotate(1,2)',
      'Translate(1)',
      'perspective(1)',
      'translate(1)(2)',
      'translate(1) url(#a)',
      'expression(alert(1))',
      'translate(1);',
      'translate(var(--fig-blue))',
    ];
    expect(read('transform', refused).filter((value) => value !== null)).toEqual([]);
  });
});

describe('keywords and names', () => {
  test('keywords take one spelling', () => {
    expect(read(['nonzero', 'evenodd'], ['EvenOdd', ' nonzero ', 'even odd'])).toEqual([
      'evenodd',
      'nonzero',
      null,
    ]);
    expect(read('aspect', ['xMidYMid meet', 'none', 'xmidymid', 'xMidYMid meet slice'])).toEqual([
      'xMidYMid meet',
      'none',
      null,
      null,
    ]);
    expect(read('orient', ['auto', 'auto-start-reverse', '45', '45deg', '1rad'])).toEqual([
      'auto',
      'auto-start-reverse',
      '45',
      '45',
      null,
    ]);
    expect(read('weight', ['bold', '600', '0', '1001'])).toEqual(['bold', '600', null, null]);
    expect(read('order', ['stroke fill', 'markers', 'fill fill', 'normal stroke'])).toEqual([
      'stroke fill',
      'markers',
      null,
      null,
    ]);
    expect(
      read(SVG_ELEMENTS.text.attributes['font-family']!, ['monospace', 'Arial', 'serif']),
    ).toEqual(['monospace', null, null]);
  });

  test('ids are plain names, and a marker attribute names one in the figure', () => {
    expect(read('id', ['arrow', 'part-1', 'a.b_c', '_x', 'a'.repeat(64)])).toEqual([
      'arrow',
      'part-1',
      'a.b_c',
      '_x',
      'a'.repeat(64),
    ]);
    expect(read('id', ['1a', 'a b', ' a', 'a"b', '<a>', 'a'.repeat(65), '', 'é'])).toEqual(
      Array.from({ length: 8 }, () => null),
    );
    expect(
      read('marker', ['url(#arrow)', "url( '#arrow' )", 'url("#arrow")', 'URL(#arrow)']),
    ).toEqual(['arrow', 'arrow', 'arrow', 'arrow']);
    const refused = [
      'url(arrow)',
      'url(#a b)',
      'url(\'#a")',
      'url(https://evil.example/m.svg#arrow)',
      'url(data:image/svg+xml,x#a)',
      String.raw`url(#\61)`,
      'url(#a) url(#b)',
      'arrow',
      'url(javascript:alert(1))',
    ];
    expect(read('marker', refused).filter((value) => value !== null)).toEqual([]);
  });
});

describe('the allowlist a renderer checks against', () => {
  test('passes only values in the form they are kept in', () => {
    expect(isSvgAttribute('rect', 'fill', 'var(--fig-blue)')).toBe(true);
    expect(isSvgAttribute('path', 'd', 'M0 0h1')).toBe(true);
    expect(isSvgAttribute('path', 'marker-end', 'arrow')).toBe(true);
    expect(isSvgAttribute('g', 'id', 'part')).toBe(true);
    const refused: [string, string, string][] = [
      ['rect', 'fill', ' red'],
      ['rect', 'fill', 'Red'],
      ['rect', 'x', '1.0'],
      ['path', 'd', 'M0,0'],
      ['path', 'marker-end', 'url(#arrow)'],
      ['g', 'marker-end', 'arrow'],
      ['rect', 'href', '#a'],
      ['rect', 'onclick', 'x'],
      ['rect', 'style', ''],
      ['image', 'href', 'x'],
      ['__proto__', 'x', '1'],
      ['rect', '__proto__', '1'],
      ['rect', 'constructor', '1'],
      ['toString', 'id', 'a'],
    ];
    expect(
      refused.filter(([element, name, value]) => isSvgAttribute(element, name, value)),
    ).toEqual([]);
  });

  test("can't be changed", () => {
    expect(Object.isFrozen(SVG_ELEMENTS)).toBe(true);
    expect(Object.isFrozen(SVG_ELEMENTS.rect.attributes)).toBe(true);
    expect(Object.isFrozen(SVG_ELEMENTS.rect.children)).toBe(true);
    expect(Object.isFrozen(SVG_ELEMENTS.rect.attributes['fill-rule'])).toBe(true);
    expect(Object.isFrozen(FIGURE_COLORS)).toBe(true);
    expect(svgRule('__proto__')).toBe(undefined);
    expect(svgRule('hasOwnProperty')).toBe(undefined);
  });
});
