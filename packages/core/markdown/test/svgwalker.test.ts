/** The figure walker refuses whatever the rules don't allow, so a figure that passes holds only that. */

import { expect, test } from 'vitest';

import { SVG_ELEMENTS, SVG_LIMITS } from '../src/index.ts';
import { ATTRIBUTES, HOLDS, svgProblems } from './svgwalker.ts';

type Node = Record<string, unknown>;

function element(
  name: string,
  attributes: Record<string, unknown> = {},
  ...children: Node[]
): Node {
  return { kind: 'element', name, attributes, children };
}

function text(value: string): Node {
  return { kind: 'text', value };
}

function figure(...children: Node[]): unknown {
  return { svg: element('svg', { viewBox: '0 0 860 120' }, ...children), removed: [] };
}

const MARKER = element(
  'defs',
  {},
  element('marker', { id: 'arrow', orient: 'auto' }, element('path', { d: 'M0 0L10 5 0 10z' })),
);

test('a figure of what the rules allow passes', () => {
  expect(
    svgProblems(
      figure(
        MARKER,
        element('rect', { x: '0', y: '24', width: '126', height: '60', fill: 'var(--fig-panel)' }),
        element('path', { d: 'M126 54h20', stroke: 'var(--fig-muted)', 'marker-end': 'arrow' }),
        element(
          'text',
          { x: '14', y: '50', 'font-family': 'monospace', transform: 'rotate(45,10,10)' },
          text('Request'),
          element('tspan', { dy: '1em', fill: '#a5c5e9' }, text(' and more')),
        ),
        element('g', { id: 'part' }, element('title', {}, text('A part'))),
      ),
    ),
  ).toEqual([]);
  expect(svgProblems({ removed: [{ reason: 'size', element: 'svg' }] })).toEqual([]);
});

test('anything else fails', () => {
  const cases: [string, unknown][] = [
    ['a script', figure(element('script', {}, text('alert(1)')))],
    ['foreignObject', figure(element('foreignObject'))],
    ['an image', figure(element('image', { href: 'https://e.com/a.png' }))],
    ['use', figure(element('use', { href: '#a' }))],
    ['an animation', figure(element('rect', {}, element('animate')))],
    ['a gradient', figure(element('linearGradient', { id: 'g' }))],
    ['a nested svg', figure(element('svg'))],
    ['text in a group', figure(element('g', {}, text('x')))],
    ['a shape in text', figure(element('text', {}, element('rect')))],
    [
      'a marker in a marker',
      figure(element('marker', { id: 'a' }, element('marker', { id: 'b' }))),
    ],
    [
      'a marker in a group in a marker',
      figure(element('marker', { id: 'a' }, element('g', {}, element('marker', { id: 'b' })))),
    ],
    ['a handler', figure(element('rect', { onclick: 'x' }))],
    ['a style', figure(element('rect', { style: 'fill:red' }))],
    ['an href', figure(element('rect', { href: 'https://e.com/' }))],
    ['a namespaced attribute', figure(element('rect', { 'xlink:href': '#a' }))],
    ['a url paint', figure(element('rect', { fill: 'url(#g)' }))],
    ['another variable', figure(element('rect', { fill: 'var(--lo-accent)' }))],
    ['a variable with a fallback', figure(element('rect', { fill: 'var(--fig-blue, red)' }))],
    ['a figure variable that is no color', figure(element('rect', { fill: 'var(--fig-font)' }))],
    ['an escape', figure(element('rect', { fill: String.raw`\72 ed` }))],
    ['a script address', figure(element('rect', { fill: 'javascript:alert(1)' }))],
    ['a data address', figure(element('rect', { 'font-family': 'data:x' }))],
    ['an unwritten value', figure(element('rect', { fill: ' Red' }))],
    ['an unwritten number', figure(element('rect', { x: '1.0' }))],
    ['a number too large', figure(element('rect', { x: '10000000' }))],
    ['a negative size', figure(element('rect', { width: '-1' }))],
    ['a bad path', figure(element('path', { d: 'L0 0' }))],
    ['a marker attribute on a group', figure(MARKER, element('g', { 'marker-end': 'arrow' }))],
    [
      'a marker attribute in a marker',
      figure(element('marker', { id: 'm' }, element('path', { d: 'M0 0', 'marker-end': 'm' }))),
    ],
    ['a marker that is not there', figure(element('path', { d: 'M0 0', 'marker-end': 'nowhere' }))],
    [
      'a marker attribute naming a group',
      figure(element('g', { id: 'g' }), element('path', { d: 'M0 0', 'marker-end': 'g' })),
    ],
    ['a repeated id', figure(element('g', { id: 'a' }), element('rect', { id: 'a' }))],
    ['an id that is no name', figure(element('g', { id: 'a b' }))],
    ['an attribute it does not have', figure(element('circle', { width: '1' }))],
    ['an extra field', figure({ ...element('rect'), id: 'x' })],
    ['an unknown kind', figure({ kind: 'html', value: '<p>' })],
    ['a lone surrogate', figure(element('text', {}, text('\ud800')))],
    [
      'attributes in a list',
      figure({ kind: 'element', name: 'rect', attributes: [], children: [] }),
    ],
    [
      'a class instance',
      figure(Object.assign(Object.create({ kind: 'element' }), element('rect'))),
    ],
    ['an unknown reason', { removed: [{ reason: 'why', element: 'svg' }] }],
    ['a long name', { removed: [{ reason: 'element', element: 'x'.repeat(65) }] }],
    ['an extra key', { removed: [], html: '' }],
    ['a root that is not svg', { svg: element('g'), removed: [] }],
  ];
  expect(cases.filter(([, tree]) => svgProblems(tree).length === 0).map(([what]) => what)).toEqual(
    [],
  );
});

test('the caps fail too', () => {
  let deep = element('rect');
  for (let i = 1; i < SVG_LIMITS.depth; i++) deep = element('g', {}, deep);
  expect(svgProblems(figure(deep))).not.toEqual([]);
  const many = Array.from({ length: SVG_LIMITS.elements }, () => element('rect'));
  expect(svgProblems(figure(...many))).not.toEqual([]);
});

/** What an element may hold, in an order to compare. */
function holds(rule: { children: readonly string[]; text: boolean }) {
  return { children: rule.children.toSorted(), text: rule.text };
}

test("the walker's rules are the allowlist's", () => {
  // Written out twice, so a change to one without the other fails here.
  const exported = Object.fromEntries(
    Object.entries(SVG_ELEMENTS).map(([name, rule]) => [
      name,
      Object.keys(rule.attributes).toSorted(),
    ]),
  );
  const walker = Object.fromEntries(
    Object.entries(ATTRIBUTES).map(([name, attributes]) => [name, attributes.toSorted()]),
  );
  expect(walker).toEqual(exported);
  expect(
    Object.fromEntries(Object.entries(HOLDS).map(([name, rule]) => [name, holds(rule)])),
  ).toEqual(
    Object.fromEntries(Object.entries(SVG_ELEMENTS).map(([name, rule]) => [name, holds(rule)])),
  );
});
