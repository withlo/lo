/**
 * The allowlist walker for figures: everything a sanitized SVG may hold, checked node by node with
 * an explicit stack, from the rules in `design/figures.md` written out again here. It knows the
 * elements, what each may hold and its attributes, and nothing else passes: an unknown element,
 * attribute or field, a value that isn't in its one form (checked again through the exported
 * allowlist, which a renderer uses), anything that could reach outside the figure, a marker that
 * could draw another, a repeated id, or nesting and counts past the caps.
 */

import { isDeepStrictEqual } from 'node:util';

import { FIGURE_COLORS, isSvgAttribute, MAX_DIAGNOSTICS, SVG_LIMITS } from '../src/index.ts';
import { isRecord } from './walker.ts';

const SHAPES = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'];
const MARKABLE = ['line', 'polyline', 'polygon', 'path'];
const DESCRIBED = ['title', 'desc'];
const DRAWN = ['g', ...SHAPES, 'text', ...DESCRIBED];

/** What each element may hold, and whether it holds text. */
export const HOLDS: Record<string, { children: string[]; text: boolean }> = {
  svg: { children: [...DRAWN, 'marker', 'defs'], text: false },
  g: { children: [...DRAWN, 'marker', 'defs'], text: false },
  defs: { children: ['marker', ...DESCRIBED], text: false },
  marker: { children: DRAWN, text: false },
  ...Object.fromEntries(SHAPES.map((shape) => [shape, { children: DESCRIBED, text: false }])),
  text: { children: ['tspan', ...DESCRIBED], text: true },
  tspan: { children: ['tspan'], text: true },
  title: { children: [], text: true },
  desc: { children: [], text: true },
};

const PRESENTATION = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'text-decoration',
  'paint-order',
  'vector-effect',
];
const MARKERS = ['marker-start', 'marker-mid', 'marker-end'];
const TEXT = ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'];

/** The attributes each element may have. */
export const ATTRIBUTES: Record<string, string[]> = {
  svg: ['id', 'viewBox', 'width', 'height', 'preserveAspectRatio', ...PRESENTATION],
  g: ['id', 'transform', ...PRESENTATION],
  defs: ['id'],
  marker: [
    'id',
    'viewBox',
    'refX',
    'refY',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'orient',
    'preserveAspectRatio',
    ...PRESENTATION,
  ],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  path: ['d'],
  text: ['id', 'transform', ...PRESENTATION, ...TEXT],
  tspan: ['id', ...PRESENTATION, ...TEXT],
  title: [],
  desc: [],
};
for (const shape of SHAPES) {
  ATTRIBUTES[shape] = [
    'id',
    'transform',
    ...PRESENTATION,
    ...(MARKABLE.includes(shape) ? MARKERS : []),
    ...ATTRIBUTES[shape]!,
  ];
}

const NAME = /^[A-Za-z_][\w.-]{0,63}$/;
/** A number as `String` writes it. */
const NUMBER = String.raw`-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e-\d+)?`;

/** The shape a value of each attribute has: a first check, before the allowlist's own. */
function shaped(attribute: string, value: string): boolean {
  if (attribute === 'id' || MARKERS.includes(attribute)) return NAME.test(value);
  if (attribute === 'fill' || attribute === 'stroke' || attribute === 'color') {
    const colors = FIGURE_COLORS.join('|');
    return new RegExp(
      String.raw`^(?:none|currentColor|transparent|[a-z]{3,20}|#[\da-f]{3,8}|rgba?\([\d.,%]+\)|var\(--(?:${colors})\))$`,
    ).test(value);
  }
  if (attribute === 'd') return /^[Mm][\d MmLlHhVvCcSsQqTtAaZz.e-]*$/.test(value);
  if (attribute === 'transform') {
    const one = String.raw`(?:matrix|translate|scale|rotate|skewX|skewY)\(${NUMBER}(?:,${NUMBER})*\)`;
    return new RegExp(`^${one}(?: ${one})*$`).test(value);
  }
  // Everything else: numbers, lengths, lists of them, and keywords.
  return new RegExp(String.raw`^(?:(?:${NUMBER}(?:px|em|%)?|[A-Za-z-]+)(?: |$))+$`).test(value);
}

/** What no value but a name may hold, whatever the attribute. */
const NEVER = /url\(|script|data:|\/\/|\\|\/\*|expression|@|[:;<>"'&`{}!]/i;

export interface SvgWalked {
  problems: string[];
  elements: number;
  depth: number;
}

/** Everything wrong with `result`, a sanitized figure; empty when it holds only what's allowed. */
export function svgProblems(result: unknown): string[] {
  return walkSvg(result).problems;
}

interface Entry {
  value: unknown;
  where: string;
  depth: number;
  parent: string | undefined;
  /** Whether it's inside a marker. */
  marked: boolean;
}

export function walkSvg(result: unknown): SvgWalked {
  const found: string[] = [];
  const problem = (where: string, what: string): void => {
    if (found.length < 50) found.push(`${where}: ${what}`);
  };
  const walked = { elements: 0, depth: 0 };
  if (!isRecord(result)) return { problems: ['the result is not a plain object'], ...walked };
  const keys = Object.keys(result).toSorted().join();
  if (keys !== 'removed,svg' && keys !== 'removed') problem('result', `has ${keys}`);
  checkRemoved(result['removed'], problem);
  if (!('svg' in result)) return { problems: found, ...walked };

  const ids = new Map<string, string[]>();
  const references: { where: string; name: string }[] = [];
  const stack: Entry[] = [
    { value: result['svg'], where: 'svg', depth: 1, parent: undefined, marked: false },
  ];
  while (stack.length > 0) {
    const { value, where, depth, parent, marked } = stack.pop()!;
    if (!isRecord(value)) {
      problem(where, 'is not a plain object');
      continue;
    }
    if (value['kind'] === 'text') {
      const fields = Object.keys(value).toSorted().join();
      const text = value['value'];
      if (fields !== 'kind,value' || typeof text !== 'string' || !text.isWellFormed()) {
        problem(where, `is text of another shape: ${JSON.stringify(value).slice(0, 80)}`);
      }
      if (parent === undefined || !HOLDS[parent]?.text) problem(where, `is text in ${parent}`);
      continue;
    }
    const fields = Object.keys(value).toSorted().join();
    if (value['kind'] !== 'element' || fields !== 'attributes,children,kind,name') {
      problem(where, `is ${JSON.stringify(value).slice(0, 80)}`);
      continue;
    }
    const name = value['name'];
    const rule = typeof name === 'string' && Object.hasOwn(HOLDS, name) ? HOLDS[name] : undefined;
    if (typeof name !== 'string' || !rule) {
      problem(where, `is the element ${String(name)}, which a figure doesn't draw`);
      continue;
    }
    walked.elements += 1;
    walked.depth = Math.max(walked.depth, depth);
    if (depth > SVG_LIMITS.depth) problem(where, `nests ${depth} deep`);
    if (parent === undefined ? name !== 'svg' : !HOLDS[parent]!.children.includes(name)) {
      problem(where, `is ${name} in ${parent ?? 'nothing'}`);
    }
    if (name === 'marker' && marked) problem(where, 'is a marker in a marker');

    const attributes = value['attributes'];
    if (!isRecord(attributes)) {
      problem(where, 'has attributes that are not a plain object');
      continue;
    }
    for (const [attribute, held] of Object.entries(attributes)) {
      const at = `${where}.${attribute}`;
      if (!ATTRIBUTES[name]!.includes(attribute)) {
        problem(at, `is an attribute ${name} doesn't have`);
        continue;
      }
      if (typeof held !== 'string' || !held.isWellFormed()) {
        problem(at, `holds ${JSON.stringify(held)?.slice(0, 80)}`);
        continue;
      }
      const named = attribute === 'id' || MARKERS.includes(attribute);
      if (
        (!named && NEVER.test(held)) ||
        !shaped(attribute, held) ||
        !isSvgAttribute(name, attribute, held)
      ) {
        problem(at, `holds ${JSON.stringify(held.slice(0, 80))}`);
      }
      if (attribute === 'id') ids.set(held, [...(ids.get(held) ?? []), name]);
      if (MARKERS.includes(attribute)) {
        if (marked) problem(at, 'is a marker attribute inside a marker');
        references.push({ where: at, name: held });
      }
    }
    const children = value['children'];
    if (!Array.isArray(children)) {
      problem(where, 'has children that are not a list');
      continue;
    }
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({
        value: children[i],
        where: `${where}.children[${i}]`,
        depth: depth + 1,
        parent: name,
        marked: marked || name === 'marker',
      });
    }
  }
  for (const [id, holders] of ids) {
    if (holders.length > 1) problem(`#${id}`, `is the id of ${holders.length} elements`);
  }
  for (const { where, name } of references) {
    const holders = ids.get(name);
    if (holders?.length !== 1 || holders[0] !== 'marker') {
      problem(where, `names ${name}, which is no marker defined once`);
    }
  }
  if (walked.elements > SVG_LIMITS.elements) problem('svg', `has ${walked.elements} elements`);
  if (found.length === 0) {
    if (!isDeepStrictEqual(structuredClone(result), result))
      problem('result', "doesn't survive structuredClone");
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(result)), result))
      problem('result', "doesn't survive JSON");
  }
  return { problems: found, ...walked };
}

const REASONS = [
  'script',
  'style',
  'reference',
  'element',
  'attribute',
  'value',
  'id',
  'size',
  'elements',
  'depth',
  'numbers',
  'drawn',
  'root',
];

function checkRemoved(removed: unknown, problem: (where: string, what: string) => void): void {
  if (!Array.isArray(removed)) return problem('removed', 'is not a list');
  if (removed.length > MAX_DIAGNOSTICS) problem('removed', `${removed.length} of them`);
  for (const [i, removal] of removed.entries()) {
    const fine =
      isRecord(removal) &&
      REASONS.includes(String(removal['reason'])) &&
      typeof removal['element'] === 'string' &&
      removal['element'].isWellFormed() &&
      removal['element'].length <= 64 &&
      Object.keys(removal).every((key) =>
        ['reason', 'element', 'attribute', 'line'].includes(key),
      ) &&
      (!('attribute' in removal) ||
        (typeof removal['attribute'] === 'string' &&
          removal['attribute'].isWellFormed() &&
          removal['attribute'].length <= 64)) &&
      (!('line' in removal) ||
        (Number.isSafeInteger(removal['line']) && Number(removal['line']) >= 1));
    if (!fine) problem(`removed[${i}]`, JSON.stringify(removal).slice(0, 120));
  }
}
