import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { arcLength, dashCount, dashPeriod, float32Step } from './length.ts';
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
    // A browser reads numbers as 32-bit floats: one too small for a normal one is 0.
    expect(read('coordinate', ['1e-38', '1.2e-38', '1e-200', '-1e-45', '1e-7'])).toEqual([
      '0',
      '1.2e-38',
      '0',
      '0',
      '1e-7',
    ]);
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
    // Dashes are counted in the element's own units, so only those.
    expect(read('dashes', ['4 2', 'none', '4px,2', '4,-2', '4em', '4%'])).toEqual([
      '4 2',
      'none',
      '4 2',
      null,
      null,
      null,
    ]);
  });

  test('a dash pattern is kept when its period is at least 1, doubled for an odd count', () => {
    expect(read('dashes', ['4 3', '1', '0.5', '0.5 0.5', '0.6', '0.2 0.2 0.2', '0.001 1'])).toEqual(
      ['4 3', '1', '0.5', '0.5 0.5', '0.6', '0.2 0.2 0.2', '0.001 1'],
    );
    // A period just short of 1 is refused, in any count of numbers, zeros included.
    expect(
      read('dashes', ['0.4995', '0.4', '0.499 0.5', '0.1 0.1 0.2', '0 0', '0', '0.1 0.2 0.1 0.2']),
    ).toEqual(Array.from({ length: 7 }, () => null));
    // Tiny dashes, however many, are refused too: a period is their sum.
    expect(read('dashes', ['0.0001 '.repeat(1_000).trim()])).toEqual([null]);
    expect(isSvgAttribute('path', 'stroke-dasharray', '4 3')).toBe(true);
    expect(isSvgAttribute('path', 'stroke-dasharray', '0.499 0.5')).toBe(false);
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
    expect(readValue('path', 'M0 0 1 1 2 2h3z')).toMatchObject({
      value: 'M0 0 1 1 2 2h3z',
      numbers: 7,
      // A close is a vertex too.
      vertices: 5,
    });
    expect(readValue('points', '0 0 1 1 2 2')).toMatchObject({ numbers: 6, vertices: 3 });
  });

  test('are no longer than their lines, control polygons and whole ellipses', () => {
    const lengths = [
      ['M0 0L3 4', 5],
      ['m1 1l3 4', 5],
      ['M0 0l3 4z', 10],
      ['M0 0h3v4', 7],
      // Through the control points.
      ['M0 0C0 1 1 1 1 0', 3],
      ['M0 0Q1 1 2 0', 2 * Math.SQRT2],
      // A smooth curve's first control point is the last one reflected.
      ['M0 0C1 0 1 1 0 1S-1 2 0 2', 6],
      ['M0 0Q1 1 2 0T4 0', 4 * Math.SQRT2],
      // An arc: its whole ellipse, scaled up until it reaches; with a radius of 0, a line.
      ['M0 0A5 5 0 0 1 10 0', 10 * Math.PI],
      ['M0 0A1 1 0 0 1 10 0', 10 * Math.PI],
      ['M0 0A0 5 0 0 1 3 4', 5],
      // A move draws nothing; a close goes back to where its subpath began.
      ['M0 0L3 4M10 10l0 1z', 7],
    ] as const;
    // No shorter, and longer only by each segment's slack: 8 float32 steps, here millionths.
    const off = lengths.map(([d, length]) => (readValue('path', d)?.length ?? Infinity) - length);
    expect(off.filter((extra) => !(extra >= 0 && extra < 1e-3))).toEqual([]);
    const points = readValue('points', '0 0 3 4 3 0');
    expect(points?.length).toBeCloseTo(9, 4);
    expect(points?.closing).toBeCloseTo(3, 4);
  });

  test('are measured in 32-bit floats, as a browser keeps their points', () => {
    // Near a million, a float32 is a sixteenth apart: steps of a hundredth there are a sixteenth.
    // And each of its 100 steps is allowed 8 more, however a browser rounds what it reads.
    const zigzag = `M999999.03 0${'L999999.04 0L999999.03 0'.repeat(50)}`;
    expect(readValue('path', zigzag)?.length).toBe(100 / 16 + (100 * 8) / 16);
    expect(readValue('points', `0 0 ${'999999.03 0 999999.04 0 '.repeat(50)}`)?.length).toBe(
      999_999 + 99 / 16 + (100 * 8) / 16,
    );
  });

  test('allow each segment 8 float32 steps, however a browser rounds a number halfway', () => {
    // A browser can read 600000.40625, halfway between two floats, as either: each step a
    // sixteenth, or none. Either way, each is allowed half.
    const short = [
      `M0 600000.375${'V600000.40625V600000.375'.repeat(10)}`,
      `M600000.375 0${'H600000.40625H600000.375'.repeat(10)}`,
      `M0 600000.375${'v0.03125v-0.03125'.repeat(10)}`,
      `M300000.1875 0${'L300000.203125 0L300000.1875 0'.repeat(10)}`,
      `M600000.375 0${'C600000.40625 0 600000.375 0 600000.40625 0'.repeat(10)}`,
    ].filter((d) => {
      const segments = d.includes('C') ? 30 : 20;
      const step = d.includes('300000.') ? 1 / 32 : 1 / 16;
      return !((readValue('path', d)?.length ?? 0) >= segments * 8 * step);
    });
    expect(short).toEqual([]);
    expect(float32Step(600_000)).toBe(1 / 16);
    expect(float32Step(1_000)).toBe(2 ** -14);
    expect(float32Step(0)).toBeGreaterThan(0);
  });

  test('an arc with radii too small for a float32 is the straight line a browser draws', () => {
    for (const d of [
      'M0 0A1e-200 1e-200 0 0 1 0 999000',
      'M0 0A1e-200 5 0 0 1 0 999000',
      'M0 0A5 1e-200 0 0 1 0 999000',
      'M0 0A1e-40 1e-40 0 0 1 0 999000',
      'M0 0A1e-200 1000000 45 1 0 0 999000',
    ]) {
      // Its straight line, and the slack of the curves a browser would draw an arc with: 12 of
      // them, 8 steps each, where the arc's ellipse reaches past a million and a step is an eighth.
      const length = readValue('path', d)?.length ?? 0;
      expect(length).toBeGreaterThanOrEqual(999_000);
      expect(length).toBeLessThanOrEqual(999_000 + 12 * 8 * 0.125);
    }
    // Given radii whose squares underflow, it's no bound at all, rather than a tiny one.
    expect(arcLength(0, 0, 1e-200, 1e-200, 0, 0, 999_000)).toBe(Infinity);
    expect(arcLength(0, 0, 1e-200, 5, 30, 0, 999_000)).toBe(Infinity);
    // As small as a float32 holds, an arc's ellipse is scaled up until it reaches.
    expect(readValue('path', 'M0 0A1e-30 1e-30 0 0 1 0 999000')?.length).toBeGreaterThan(999_000);
  });
});

describe('dashes', () => {
  test('are counted along a length: half as many as the pattern has numbers, each run of their sum', () => {
    // A hundredth more, for a browser's float sums: 5.05 runs of the pattern, and 2 more.
    expect(dashCount([1, 1], 10)).toBe(8);
    // An odd pattern is repeated: the same count.
    expect(dashCount([1], 10)).toBe(7);
    expect(dashCount([0.001, 0.001], 860)).toBe(434_302);
    expect(dashCount([0, 0], 860)).toBe(0);
    expect(dashCount([1, 1], 0)).toBe(2);
    // Dashes as small as a float32 holds are past any cap; smaller, they're 0, a solid line.
    expect(dashCount([1e-30], 1)).toBeGreaterThan(1e29);
    expect(dashCount([1e-300], 1)).toBe(0);
    // A length that isn't finite has no end of dashes.
    expect(dashCount([1, 1], Infinity)).toBe(Infinity);
    expect(dashCount([1, 1], Number.NaN)).toBe(Infinity);
  });

  test('have a period: the sum of their numbers, doubled when there is an odd count', () => {
    expect(dashPeriod([4, 3])).toBe(7);
    expect(dashPeriod([4])).toBe(8);
    expect(dashPeriod([1, 2, 3])).toBe(12);
    expect(dashPeriod([0.25, 0.25])).toBe(0.5);
    expect(dashPeriod([])).toBe(0);
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
      'translate(1),',
      'translate(1),,scale(2)',
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

describe('a long run of spaces', () => {
  // Half a megabyte of spaces, inside a value, where a trim that backtracks takes minutes.
  const run = ' '.repeat(524_000);
  const kinds: SvgValue[] = [
    'coordinate',
    'size',
    'coordinates',
    'numbers',
    'opacity',
    'miter',
    'dashes',
    'paint',
    'color',
    'viewBox',
    'points',
    'path',
    'transform',
    'aspect',
    'orient',
    'spacing',
    'weight',
    'order',
    'id',
    'marker',
    ['nonzero', 'evenodd'],
  ];
  const values = [
    `1${run}1`,
    `${run}1${run}`,
    `translate(1${run}1)`,
    `rgb(1${run},2,3)`,
    `var(${run}--fig-blue${run})`,
    `url(${run}#a${run}x)`,
    `M0${run}0${run}x`,
    `1,${run},1`,
  ];

  test('is read in time linear in its length, by every kind of value', () => {
    const started = performance.now();
    for (const kind of kinds) for (const value of values) readValue(kind, value);
    // Some 170 readings of half a megabyte each.
    expect(performance.now() - started).toBeLessThan(2_500);
  });

  test("and checked so by a renderer, whatever the tree it's given holds", () => {
    const started = performance.now();
    for (const [element, attributes] of Object.entries(SVG_ELEMENTS)) {
      for (const attribute of Object.keys(attributes.attributes)) {
        isSvgAttribute(element, attribute, `1${run}1`);
      }
    }
    expect(performance.now() - started).toBeLessThan(2_500);
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
