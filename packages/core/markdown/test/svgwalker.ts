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
  marker: { children: DRAWN.filter((name) => name !== 'text'), text: false },
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
];
const MARKERS = ['marker-start', 'marker-mid', 'marker-end'];
const TEXT = ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'];

/** The attributes each element may have. */
export const ATTRIBUTES: Record<string, string[]> = {
  svg: ['id', 'viewBox', 'preserveAspectRatio', ...PRESENTATION],
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
    'stroke-dasharray',
    'stroke-dashoffset',
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
  /** The marker it's inside, if any. */
  marker: object | undefined;
}

/** The numbers a value holds, as `String` writes them. */
function countNumbers(value: string): number {
  return value.match(/-?\d+(?:\.\d+)?(?:e-\d+)?/g)?.length ?? 0;
}

const PATH_TAKES: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };

/** Where a marker can land on `name` with `attributes`: its vertices, closes included. */
function vertices(name: string, attributes: Record<string, unknown>): number {
  if (name === 'line') return 2;
  const points = attributes['points'];
  if (typeof points === 'string') return countNumbers(points) / 2 + (name === 'polygon' ? 1 : 0);
  const d = attributes['d'];
  if (name !== 'path' || typeof d !== 'string') return 0;
  let count = 0;
  // Each command and its numbers; a number's exponent, `e`, is no command.
  for (const command of d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) ?? []) {
    const letter = command[0]!.toLowerCase();
    count += letter === 'z' ? 1 : countNumbers(command.slice(1)) / PATH_TAKES[letter]!;
  }
  return count;
}

/** Attributes whose numbers are no part of what's drawn: colors and names. */
const UNCOUNTED = new Set(['fill', 'stroke', 'color', 'id', ...MARKERS]);

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

  const ids = new Map<string, { name: string; node: object }[]>();
  const references: { where: string; name: string; times: number }[] = [];
  // What's drawn once, and what each marker draws each time it's drawn.
  let drawn = 0;
  const markers = new Map<object, number>();
  const charge = (marker: object | undefined, cost: number): void => {
    if (marker) markers.set(marker, (markers.get(marker) ?? 0) + cost);
    else drawn += cost;
  };
  const stack: Entry[] = [
    { value: result['svg'], where: 'svg', depth: 1, parent: undefined, marker: undefined },
  ];
  while (stack.length > 0) {
    const { value, where, depth, parent, marker } = stack.pop()!;
    const marked = marker !== undefined;
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
      if (typeof text === 'string') charge(marker, text.length);
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
    if (name === 'text' && marked) problem(where, 'is text in a marker');
    if (parent === undefined && !inProportion(value['attributes'])) {
      problem(where, 'is too large, or too tall or wide, to lay out');
    }

    const attributes = value['attributes'];
    if (!isRecord(attributes)) {
      problem(where, 'has attributes that are not a plain object');
      continue;
    }
    const corners = vertices(name, attributes);
    const inside = name === 'marker' ? value : marker;
    let cost = 1 + corners;
    for (const [attribute, held] of Object.entries(attributes)) {
      const at = `${where}.${attribute}`;
      if (typeof held === 'string' && !UNCOUNTED.has(attribute)) cost += countNumbers(held);
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
      if (attribute === 'id') ids.set(held, [...(ids.get(held) ?? []), { name, node: value }]);
      if (MARKERS.includes(attribute)) {
        if (marked) problem(at, 'is a marker attribute inside a marker');
        const times = attribute === 'marker-mid' ? Math.max(0, corners - 2) : 1;
        references.push({ where: at, name: held, times });
      }
    }
    const dashes = dashesOf(name, attributes);
    if (dashes === undefined)
      problem(where, 'has dashes along a length that depends on its context');
    if (patternPeriod(attributes) < 1) problem(where, 'has dashes with a period under 1');
    charge(inside, cost + (dashes ?? 0));
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
        marker: inside,
      });
    }
  }
  for (const [id, holders] of ids) {
    if (holders.length > 1) problem(`#${id}`, `is the id of ${holders.length} elements`);
  }
  for (const { where, name, times } of references) {
    const holders = ids.get(name);
    const target = holders?.length === 1 ? holders[0] : undefined;
    if (target?.name !== 'marker') {
      problem(where, `names ${name}, which is no marker defined once`);
      continue;
    }
    if (times > 0) drawn += times * (markers.get(target.node) ?? 0);
  }
  if (walked.elements > SVG_LIMITS.elements) problem('svg', `has ${walked.elements} elements`);
  if (!(drawn <= SVG_LIMITS.drawn)) problem('svg', `draws ${drawn}, more than ${SVG_LIMITS.drawn}`);
  if (found.length === 0) {
    if (!isDeepStrictEqual(structuredClone(result), result))
      problem('result', "doesn't survive structuredClone");
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(result)), result))
      problem('result', "doesn't survive JSON");
  }
  return { problems: found, ...walked };
}

/** The step from the float32 nearest `magnitude` to the next one up, from its bits. */
function step(magnitude: number): number {
  const float = new Float32Array([Math.abs(magnitude)]);
  const next = new Float32Array(new Uint32Array([new Uint32Array(float.buffer)[0]! + 1]).buffer);
  return next[0]! - float[0]!;
}

/** What `segments` segments may each be longer in a browser: 8 float32 steps at `most`. */
function slack(segments: number, most: number): number {
  return segments * 8 * step(most);
}

/** A length in the element's own units, 0 when left out, or NaN in units that depend on context. */
function own(value: unknown): number {
  if (value === undefined) return 0;
  return typeof value === 'string' && /^[\d.e-]+(?:px)?$/.test(value)
    ? Number.parseFloat(value)
    : Number.NaN;
}

/**
 * The points a canonical path visits, control points included, in absolute units, each run of
 * them broken where a subpath moves; and the arcs' bounds, added separately.
 */
function pathBound(d: string): number {
  // As 32-bit floats, as a browser keeps a path's points.
  const f = Math.fround;
  let length = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic: number[] | undefined;
  let lastQuad: number[] | undefined;
  let segments = 0;
  let most = 0;
  const line = (nx: number, ny: number) => {
    length += Math.hypot(f(nx) - x, f(ny) - y);
    x = f(nx);
    y = f(ny);
    segments += 1;
    most = Math.max(most, Math.abs(x), Math.abs(y));
  };
  for (const command of d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) ?? []) {
    const letter = command[0]!;
    const lower = letter.toLowerCase();
    const numbers =
      command.slice(1).trim() === '' ? [] : command.slice(1).trim().split(' ').map(Number);
    const takes = lower === 'z' ? 0 : PATH_TAKES[lower]!;
    const groups = takes === 0 ? 1 : numbers.length / takes;
    for (let g = 0; g < groups; g++) {
      const v = numbers.slice(g * takes, (g + 1) * takes);
      const dx = letter === lower ? x : 0;
      const dy = letter === lower ? y : 0;
      let cubic: number[] | undefined;
      let quad: number[] | undefined;
      if (lower === 'm' && g === 0) {
        x = f(dx + v[0]!);
        y = f(dy + v[1]!);
        most = Math.max(most, Math.abs(x), Math.abs(y));
        startX = x;
        startY = y;
      } else if (lower === 'm' || lower === 'l') line(dx + v[0]!, dy + v[1]!);
      else if (lower === 'h') line(dx + v[0]!, y);
      else if (lower === 'v') line(x, dy + v[0]!);
      else if (lower === 'z') line(startX, startY);
      else if (lower === 'a') {
        const [rx, ry, angle] = [Math.abs(v[0]!), Math.abs(v[1]!), (v[2]! * Math.PI) / 180];
        const [ex, ey] = [dx + v[5]!, dy + v[6]!];
        let arc: number;
        if (rx === 0 || ry === 0) arc = Math.hypot(f(ex) - x, f(ey) - y);
        else {
          const hx = (x - ex) / 2;
          const hy = (y - ey) / 2;
          const px = Math.cos(angle) * hx + Math.sin(angle) * hy;
          const py = -Math.sin(angle) * hx + Math.cos(angle) * hy;
          const reach = (px * px) / (rx * rx) + (py * py) / (ry * ry);
          const bound = 2 * Math.PI * Math.max(rx, ry) * Math.max(1, Math.sqrt(reach));
          arc = Number.isFinite(bound) ? bound : Infinity;
        }
        length += arc;
        // Up to four cubic curves of three edges, all within its diameter of either end.
        segments += 12;
        most =
          Math.max(most, Math.abs(x), Math.abs(y), Math.abs(f(ex)), Math.abs(f(ey))) +
          arc / Math.PI;
        x = f(ex);
        y = f(ey);
      } else {
        // Curves: through each control point to the end.
        const reflect = (last: number[] | undefined) =>
          last ? [f(2 * x - last[0]!), f(2 * y - last[1]!)] : [x, y];
        const points: number[] =
          lower === 'c'
            ? v.map((n, i) => n + (i % 2 === 0 ? dx : dy))
            : lower === 's'
              ? [...reflect(lastCubic), ...v.map((n, i) => n + (i % 2 === 0 ? dx : dy))]
              : lower === 'q'
                ? v.map((n, i) => n + (i % 2 === 0 ? dx : dy))
                : [...reflect(lastQuad), dx + v[0]!, dy + v[1]!];
        if (lower === 'c' || lower === 's') cubic = points.slice(-4, -2).map(f);
        else quad = points.slice(-4, -2).map(f);
        for (let i = 0; i + 1 < points.length; i += 2) line(points[i]!, points[i + 1]!);
      }
      lastCubic = cubic;
      lastQuad = quad;
    }
  }
  return length + slack(segments, most);
}

/**
 * How long one run of the dash pattern in `attributes` is: the sum of its numbers, twice over when
 * there is an odd count of them, as SVG repeats it. Infinity when there is none.
 */
function patternPeriod(attributes: Record<string, unknown>): number {
  const pattern = attributes['stroke-dasharray'];
  if (typeof pattern !== 'string' || pattern === 'none') return Infinity;
  const values = pattern.split(' ').map(Number);
  const sum = values.reduce((total, value) => total + value, 0);
  return values.length % 2 === 0 ? sum : 2 * sum;
}

/**
 * How many dashes `name` with `attributes` draws, at most, in its own units; undefined when its
 * shape is measured in units that depend on its context.
 */
function dashesOf(name: string, attributes: Record<string, unknown>): number | undefined {
  const pattern = attributes['stroke-dasharray'];
  if (typeof pattern !== 'string' || pattern === 'none') return 0;
  const values = pattern.split(' ').map(Number);
  const period = values.reduce((sum, value) => sum + value, 0);
  const points =
    typeof attributes['points'] === 'string'
      ? attributes['points'].split(' ').map((value) => Math.fround(Number(value)))
      : [];
  const around = (closed: boolean) => {
    let total = 0;
    const count = points.length / 2 + (closed ? 1 : 0);
    for (let i = 1; i < count; i++) {
      const j = (i % (points.length / 2)) * 2;
      total += Math.hypot(
        points[j]! - points[(i - 1) * 2]!,
        points[j + 1]! - points[(i - 1) * 2 + 1]!,
      );
    }
    const most = points.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
    return total + slack(count - 1, most);
  };
  const at = (key: string) => own(attributes[key]);
  const length =
    name === 'rect'
      ? 2 * (at('width') + at('height')) +
        slack(12, Math.max(Math.abs(at('x')) + at('width'), Math.abs(at('y')) + at('height')))
      : name === 'circle'
        ? 2 * Math.PI * at('r') +
          slack(16, Math.max(Math.abs(at('cx')), Math.abs(at('cy'))) + at('r'))
        : name === 'ellipse'
          ? 2 * Math.PI * Math.max(at('rx'), at('ry')) +
            slack(
              16,
              Math.max(Math.abs(at('cx')), Math.abs(at('cy'))) + Math.max(at('rx'), at('ry')),
            )
          : name === 'line'
            ? Math.hypot(at('x2') - at('x1'), at('y2') - at('y1')) +
              slack(1, Math.max(...['x1', 'y1', 'x2', 'y2'].map((key) => Math.abs(at(key)))))
            : name === 'polyline' || name === 'polygon'
              ? around(name === 'polygon')
              : typeof attributes['d'] === 'string'
                ? pathBound(attributes['d'])
                : 0;
  if (Number.isNaN(length) && typeof attributes['d'] !== 'string') return undefined;
  if (!Number.isFinite(length)) return Infinity;
  return period > 0 ? Math.ceil((length * values.length) / (2 * period)) + values.length : 0;
}

/** Whether a figure with `attributes` lays out at the article's width at a size within the caps. */
function inProportion(attributes: unknown): boolean {
  if (!isRecord(attributes)) return false;
  if ('width' in attributes || 'height' in attributes) return false;
  const box = typeof attributes['viewBox'] === 'string' ? attributes['viewBox'].split(' ') : [];
  if (box.length !== 4) return true;
  const [width, height] = [Number(box[2]), Number(box[3])];
  return (
    Math.max(width, height) <= SVG_LIMITS.extent &&
    height <= SVG_LIMITS.tallest * width &&
    width <= SVG_LIMITS.widest * height
  );
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
  'aspect',
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
