// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isSvgAttribute,
  sanitizeSvg,
  SVG_ELEMENTS,
  type SvgElement,
  type SvgName,
  type SvgNode,
} from '@lo/markdown';
import { describe, expect, test } from 'vitest';

import { drawSvg, linkParts, scopedId, sizeHits } from './svg.ts';

// The base is named first: under jsdom, Vite rewrites `new URL('…', import.meta.url)`.
const here = import.meta.url;
const root = fileURLToPath(new URL('../../../../../', here));
const HOSTILE = join(root, 'testing/fixtures/markdown/hostile');
const ARTIFACTS = join(root, 'testing/fixtures/artifacts');

const SVG = 'http://www.w3.org/2000/svg';
const MARKERS = ['marker-start', 'marker-mid', 'marker-end'];

/** `sanitizeSvg`'s hostile figures, and its generated ones, each as its name and text. */
function hostile(): [string, string][] {
  const files = readdirSync(HOSTILE)
    .filter((name) => name.endsWith('.svg'))
    .map((name): [string, string] => [name, readFileSync(join(HOSTILE, name), 'utf8')]);
  const generated: { name: string; parts: [string, number][] }[] = JSON.parse(
    readFileSync(join(HOSTILE, 'generated-svg.json'), 'utf8'),
  ).inputs;
  return [
    ...files,
    ...generated.map(({ name, parts }): [string, string] => [
      name,
      parts
        .map(([part, times]) =>
          part.includes('{i}')
            ? Array.from({ length: times }, (_, i) => part.replaceAll('{i}', String(i))).join('')
            : part.repeat(times),
        )
        .join(''),
    ]),
  ];
}

/** Every SVG in the overviews' fixtures, each as its path and text. */
function fixtures(): [string, string][] {
  const found: [string, string][] = [];
  const stack = [ARTIFACTS];
  while (stack.length > 0) {
    const folder = stack.pop()!;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.endsWith('.svg'))
        found.push([path.slice(ARTIFACTS.length + 1), readFileSync(path, 'utf8')]);
    }
  }
  return found.toSorted(([a], [b]) => a.localeCompare(b));
}

/**
 * Everything in `svg`, drawn under `scope`, that the allowlist lacks: an element not in SVG's
 * namespace, not one it has, or where it can't be; an attribute it doesn't allow there, with its
 * value; an id outside the scope; a marker reference that isn't to a marker in the same figure;
 * and text where none is drawn. Lo's own links and hit areas around parts are known by their
 * class, and hold only what Lo gives them.
 */
function problems(svg: Element, scope: string): string[] {
  const found: string[] = [];
  const ids = new Map<string, Element>();
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    const id = element.getAttribute('id');
    if (id !== null) ids.set(id, element);
  }
  const stack: { node: Node; parent: SvgName | undefined; marker: boolean }[] = [
    { node: svg, parent: undefined, marker: false },
  ];
  while (stack.length > 0) {
    const { node, parent, marker } = stack.pop()!;
    if (node.nodeType === node.TEXT_NODE) {
      if (!parent || !SVG_ELEMENTS[parent].text) found.push(`text in ${parent}`);
      continue;
    }
    if (!(node instanceof Element)) {
      found.push(`a node of type ${node.nodeType}`);
      continue;
    }
    const name = node.localName;
    const ours = lo(node);
    if (node.namespaceURI !== SVG) found.push(`${name} in ${node.namespaceURI}`);
    if (!ours) {
      if (!isSvgName(name)) {
        found.push(`the element ${name}`);
        continue;
      }
      const at = name;
      if (parent ? !SVG_ELEMENTS[parent].children.includes(at) : at !== 'svg') {
        found.push(`${name} in ${parent}`);
      }
      if (marker && (at === 'marker' || at === 'text')) found.push(`${name} in a marker`);
      for (const { name: attribute, value } of node.attributes) {
        const where = `${name}.${attribute}="${value.slice(0, 40)}"`;
        if (attribute === 'id') {
          const named = value.startsWith(`${scope}-`) ? value.slice(scope.length + 1) : undefined;
          if (named === undefined || !isSvgAttribute(at, 'id', named)) found.push(where);
        } else if (MARKERS.includes(attribute)) {
          const target = /^url\(#(.+)\)$/.exec(value)?.[1];
          const marked = target === undefined ? undefined : ids.get(target);
          if (
            !target?.startsWith(`${scope}-`) ||
            marked?.localName !== 'marker' ||
            !svg.contains(marked)
          ) {
            found.push(where);
          }
          if (marker) found.push(`${where} in a marker`);
        } else if (!isSvgAttribute(at, attribute, value)) {
          found.push(where);
        }
      }
    }
    const inside = marker || name === 'marker';
    const as = ours || !isSvgName(name) ? parent : name;
    for (const child of node.childNodes) stack.push({ node: child, parent: as, marker: inside });
  }
  return found;
}

/**
 * Whether `element` is Lo's own: a part's link, holding only its class, focus, role, name and
 * index, and perhaps the part's transform; or its hit area, holding only its class and its box.
 */
function lo(element: Element): boolean {
  const names = [...element.attributes].map((attribute) => attribute.name).toSorted();
  const kind = element.getAttribute('class');
  if (element.localName === 'g' && kind === 'lo-fig-link') {
    const transform = element.getAttribute('transform');
    return (
      names.filter((name) => name !== 'transform').join() ===
        'aria-label,class,data-part,role,tabindex' &&
      (transform === null || isSvgAttribute('g', 'transform', transform))
    );
  }
  if (element.localName === 'rect' && kind === 'lo-fig-hit') {
    return names.every((name) => ['class', 'x', 'y', 'width', 'height'].includes(name));
  }
  return false;
}

/** The tree `svg`, drawn under `scope`, holds: its ids and marker references as names again. */
function treeOf(element: Element, scope: string): SvgElement {
  const attributes: Record<string, string> = {};
  for (const { name, value } of element.attributes) {
    if (name === 'id') attributes[name] = value.slice(scope.length + 1);
    else if (MARKERS.includes(name)) attributes[name] = value.slice(`url(#${scope}-`.length, -1);
    else attributes[name] = value;
  }
  const children: SvgNode[] = [];
  for (const child of element.childNodes) {
    if (child instanceof Element) children.push(treeOf(child, scope));
    else children.push({ kind: 'text', value: child.textContent ?? '' });
  }
  const name = element.localName;
  if (!isSvgName(name)) throw new Error(`${name} isn't an element a figure holds`);
  return { kind: 'element', name, attributes, children };
}

function isSvgName(name: string): name is SvgName {
  return Object.hasOwn(SVG_ELEMENTS, name);
}

/** The ids in `svg`. */
function idsOf(svg: Element): string[] {
  return [...svg.querySelectorAll('[id]')].map((element) => element.id);
}

/** What every figure drawn holds to: nothing that runs, styles itself or reaches outside it. */
function expectInert(svg: Element): void {
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    expect(element.localName).not.toMatch(/^(?:script|style|foreignObject|image|use|a|img)$/i);
    for (const { name, value } of element.attributes) {
      expect(name).not.toMatch(/^on|href|^style$|^src/i);
      expect(value).not.toMatch(/javascript:|data:|blob:|https?:|url\((?!#lo-fig)/i);
    }
  }
}

describe('sanitizeSvg’s hostile figures, and the fixtures', () => {
  const all = [...hostile(), ...fixtures()];

  test('there are some', () => {
    expect(hostile().length).toBeGreaterThanOrEqual(70);
    expect(fixtures().length).toBeGreaterThanOrEqual(15);
  });

  test.each(all)(
    '%s is drawn with nothing the allowlist lacks, as the check kept it',
    (_, text) => {
      const { svg: tree } = sanitizeSvg(text);
      if (!tree) return;
      const drawn = drawSvg(tree, 'lo-fig1')!;
      expect(problems(drawn.svg, 'lo-fig1')).toEqual([]);
      expectInert(drawn.svg);
      // Nothing the check kept is lost, and nothing added.
      expect(treeOf(drawn.svg, 'lo-fig1')).toEqual(tree);
    },
  );
});

/**
 * An element of a tree that may hold anything, as it arrives from another process: plain data,
 * through JSON.
 */
function el(name: string, attributes: object = {}, ...children: unknown[]): SvgElement {
  return JSON.parse(JSON.stringify({ kind: 'element', name, attributes, children }));
}

/** Text in such a tree. */
function words(value: unknown): unknown {
  return { kind: 'text', value };
}

describe('a tree that didn’t come from sanitizeSvg', () => {
  test('loses each element the allowlist lacks, or has elsewhere, with all it holds', () => {
    const drawn = drawSvg(
      el(
        'svg',
        { viewBox: '0 0 10 10' },
        el('script', {}, words('alert(1)')),
        el('foreignObject', {}, el('div', {}, words('html'))),
        el('image', { href: 'https://example.com/a.png' }),
        el('a', { href: 'https://example.com/' }, el('rect', { width: '1' })),
        el('use', { href: '#x' }),
        el('style', {}, words('* { fill: red }')),
        el('animate', { attributeName: 'href' }),
        el('svg', {}, el('rect')),
        el('rect', {}, el('rect'), el('text', {}, words('in a rect'))),
        el('defs', {}, el('rect', { id: 'kept-out' })),
        el(
          'marker',
          { id: 'm' },
          el('marker'),
          el('text', {}, words('in a marker')),
          el('g', {}, el('marker', { id: 'deeper' }), el('text', {}, words('in a group'))),
        ),
        el('text', {}, el('rect'), el('tspan', {}, el('text'), words('kept'))),
        el('title', {}, el('g')),
        el('__proto__'),
        el('constructor'),
        { kind: 'element', name: 'rect', attributes: null, children: [] },
        { kind: 'element', name: 'rect', attributes: {}, children: 'no' },
        { kind: 'other', name: 'rect', attributes: {}, children: [] },
        'a string',
        null,
      ),
      'lo-fig1',
    )!;
    expect(problems(drawn.svg, 'lo-fig1')).toEqual([]);
    expectInert(drawn.svg);
    expect(drawn.svg.outerHTML).toBe(
      '<svg viewBox="0 0 10 10"><rect></rect><defs></defs><marker id="lo-fig1-m"><g></g></marker>' +
        '<text><tspan>kept</tspan></text><title></title></svg>',
    );
  });

  test('loses each attribute the allowlist doesn’t allow there, or with that value', () => {
    // An own `__proto__`, as JSON makes one.
    const attributes = Object.assign(JSON.parse('{"__proto__": "1"}'), {
      onload: 'alert(1)',
      onclick: 'alert(1)',
      href: 'https://example.com/',
      'xlink:href': '#a',
      src: 'data:image/png;base64,AA',
      style: 'fill: red',
      class: 'lo-fig-link',
      tabindex: '0',
      fill: 'url(https://example.com/p.svg#p)',
      stroke: 'javascript:alert(1)',
      transform: 'expression(alert(1))',
      'font-family': 'url(x)',
      filter: 'url(#f)',
      mask: 'url(#m)',
      width: { toString: () => '1' },
      height: 2,
      x: '1 ',
      y: 'NaN',
      cx: '1',
    });
    const drawn = drawSvg(
      el('svg', { width: '100', height: '100', onload: 'x' }, el('rect', attributes)),
      'lo-fig1',
    )!;
    expect(problems(drawn.svg, 'lo-fig1')).toEqual([]);
    expect(drawn.svg.outerHTML).toBe('<svg><rect></rect></svg>');
  });

  test('sets text only as text', () => {
    const drawn = drawSvg(
      el(
        'svg',
        {},
        el('text', {}, words('<script>alert(1)</script>'), words('&amp; <b>'), words(7)),
      ),
      'lo-fig1',
    )!;
    const shown = drawn.svg.querySelector('text')!;
    expect(shown.childElementCount).toBe(0);
    expect(shown.textContent).toBe('<script>alert(1)</script>&amp; <b>');
  });

  test('isn’t drawn unless its root is an svg element, or under one of Lo’s scopes', () => {
    expect(drawSvg(el('g', {}, el('rect')), 'lo-fig1')).toBeUndefined();
    expect(drawSvg(el('svg', {}, el('rect')), 'a" onload="alert(1)')).toBeUndefined();
    expect(drawSvg(el('svg', {}, el('rect')), '')).toBeUndefined();
    expect(drawSvg(JSON.parse('{"kind": "text", "value": "svg"}'), 'lo-fig1')).toBeUndefined();
  });

  test('names nothing with an id two elements have', () => {
    const drawn = drawSvg(
      el(
        'svg',
        {},
        el('defs', {}, el('marker', { id: 'arrow' }, el('path', { d: 'M0 0' }))),
        el('rect', { id: 'arrow' }),
        el('path', { d: 'M0 0L1 1', 'marker-end': 'arrow' }),
      ),
      'lo-fig1',
    )!;
    expect(drawn.svg.querySelectorAll('[id]')).toHaveLength(0);
    expect(drawn.svg.querySelector('path[marker-end]')).toBeNull();
    expect(drawn.linkable.size).toBe(0);
  });

  test('sets a marker reference only to a marker in its own figure, and not inside one', () => {
    const drawn = drawSvg(
      el(
        'svg',
        {},
        el(
          'defs',
          {},
          el('marker', { id: 'arrow' }, el('path', { d: 'M0 0L1 1', 'marker-end': 'arrow' })),
        ),
        el('rect', { id: 'box' }),
        el('path', {
          d: 'M0 0L1 1',
          'marker-end': 'arrow',
          'marker-start': 'box',
          'marker-mid': 'gone',
        }),
        el('path', { d: 'M0 0L1 1', 'marker-end': 'url(#arrow)' }),
      ),
      'lo-fig1',
    )!;
    const paths = [...drawn.svg.querySelectorAll('path')].map((path) =>
      MARKERS.map((name) => path.getAttribute(name)),
    );
    expect(paths).toEqual([
      [null, null, null],
      [null, null, 'url(#lo-fig1-arrow)'],
      [null, null, null],
    ]);
  });
});

describe('scopes', () => {
  const tree = sanitizeSvg(
    readFileSync(join(ARTIFACTS, 'valid/example/figures/flow.svg'), 'utf8'),
  ).svg!;

  test('every id and marker reference is the block’s own, so one figure shown twice has two', () => {
    const marked = sanitizeSvg(
      `<svg viewBox="0 0 10 10"><defs><marker id="a"><path d="M0 0L1 1"/></marker></defs>` +
        `<path id="p" d="M0 0L5 5" marker-end="url(#a)"/></svg>`,
    ).svg!;
    for (const figure of [tree, marked]) {
      const first = drawSvg(figure, 'lo-fig1')!;
      const second = drawSvg(figure, 'lo-fig2')!;
      expect(idsOf(first.svg).length).toBeGreaterThan(0);
      expect(idsOf(first.svg).every((id) => id.startsWith('lo-fig1-'))).toBe(true);
      expect(idsOf(second.svg)).toEqual(
        idsOf(first.svg).map((id) => id.replace('lo-fig1-', 'lo-fig2-')),
      );
      document.body.append(first.svg, second.svg);
      for (const drawn of [first, second]) {
        for (const element of drawn.svg.querySelectorAll('[marker-end]')) {
          const target = /^url\(#(.+)\)$/.exec(element.getAttribute('marker-end')!)![1]!;
          expect(drawn.svg.contains(document.getElementById(target))).toBe(true);
        }
      }
      first.svg.remove();
      second.svg.remove();
    }
    expect(scopedId('lo-fig3', 'cost')).toBe('lo-fig3-cost');
  });
});

describe('parts', () => {
  const tree = sanitizeSvg(
    `<svg viewBox="0 0 860 120">
      <defs><marker id="tip"><path id="in-tip" d="M0 0L1 1"/></marker></defs>
      <g id="group"><rect id="box" x="1" y="2" width="30" height="40"/></g>
      <text id="label" x="5" y="5" transform="translate(10,0)">Cost<tspan id="span">s</tspan></text>
      <circle id="dot" cx="5" cy="5" r="2"/>
    </svg>`,
  ).svg!;

  test('wrap only shapes, groups and texts drawn once, each in a link with a hit area', () => {
    const drawn = drawSvg(tree, 'lo-fig1')!;
    const links = linkParts(drawn, [
      { id: 'box', label: 'Code: cost.ts' },
      { id: 'label', label: 'The term cost' },
      { id: 'tip', label: 'a marker' },
      { id: 'in-tip', label: 'in a marker' },
      { id: 'span', label: 'a span' },
      { id: 'nowhere', label: 'nothing' },
      { id: 'box', label: 'again' },
    ]);
    expect(links.map((link) => link.lastElementChild?.id)).toEqual([
      'lo-fig1-box',
      'lo-fig1-label',
    ]);
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Code: cost.ts',
      'The term cost',
    ]);
    expect(links.map((link) => link.dataset['part'])).toEqual(['0', '1']);
    for (const link of links) {
      expect(link.getAttribute('class')).toBe('lo-fig-link');
      expect(link.getAttribute('tabindex')).toBe('0');
      expect(link.getAttribute('role')).toBe('link');
      expect(link.firstElementChild?.getAttribute('class')).toBe('lo-fig-hit');
    }
    // The part's transform goes to its link, so its hit area is measured in the part's units.
    expect(links[1]!.getAttribute('transform')).toBe('translate(10,0)');
    expect(links[1]!.lastElementChild?.hasAttribute('transform')).toBe(false);
    // The box stays in its group, and nothing else moves.
    expect(links[0]!.parentElement?.id).toBe('lo-fig1-group');
    expect(problems(drawn.svg, 'lo-fig1')).toEqual([]);
  });

  test('get hit areas a little larger than the part’s box', () => {
    const drawn = drawSvg(tree, 'lo-fig1')!;
    const links = linkParts(drawn, [{ id: 'box', label: 'a box' }]);
    sizeHits(links);
    // jsdom lays nothing out: until there's a box, the hit area has none.
    expect(links[0]!.firstElementChild?.hasAttribute('width')).toBe(false);
    Object.defineProperty(links[0]!.lastElementChild, 'getBBox', {
      value: () => new DOMRect(1, 2, 30, 40),
    });
    sizeHits(links);
    const hit = links[0]!.firstElementChild!;
    expect(['x', 'y', 'width', 'height'].map((name) => hit.getAttribute(name))).toEqual([
      '-4',
      '-3',
      '40',
      '50',
    ]);
  });
});
