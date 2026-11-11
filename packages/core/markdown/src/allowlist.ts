/**
 * What an overview's figure may hold, as `design/figures.md` describes it: the elements, what each
 * may hold, its attributes, and the one form each attribute's value takes. `sanitizeSvg` keeps only
 * this, with every value in that form, and a renderer checks every element and attribute against
 * it again (`SVG_ELEMENTS`, `isSvgAttribute`).
 *
 * Two rules reach further than an element's own:
 *
 * - Nothing inside a `marker` is a `marker` or `text`, or has a marker attribute, so no marker draws
 *   another or lays out text again at every vertex.
 * - `id` and the marker attributes hold names, which a renderer scopes to the figure as it does a
 *   document's anchors, so a figure can't reach an id of Lo's own or another figure's. It writes a
 *   marker attribute as `url(#<the scoped name>)`, and each names a `marker` defined once.
 *
 * Colors are only `var(--fig-*)` for one of Lo's figure colors, a plain color, `none` or
 * `currentColor`. Nothing refers to anything outside the figure, and no value holds a URL, an
 * escape, a comment or a function besides those.
 */

import { Pen, polylineLength } from './length.ts';

/** The elements a figure may hold. */
export type SvgName =
  | 'svg'
  | 'g'
  | 'defs'
  | 'marker'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'path'
  | 'text'
  | 'tspan'
  | 'title'
  | 'desc';

/** The form an attribute's value takes. A list is the keywords it may be. */
export type SvgValue =
  | 'coordinate'
  | 'size'
  | 'coordinates'
  | 'numbers'
  | 'opacity'
  | 'miter'
  | 'dashes'
  | 'paint'
  | 'color'
  | 'viewBox'
  | 'points'
  | 'path'
  | 'transform'
  | 'aspect'
  | 'orient'
  | 'spacing'
  | 'weight'
  | 'order'
  | 'id'
  | 'marker'
  | readonly string[];

export interface SvgRule {
  /** Its attributes, each with the form its value takes. */
  readonly attributes: Readonly<Record<string, SvgValue>>;
  /** The elements it may hold. */
  readonly children: readonly SvgName[];
  /** Whether it may hold text. */
  readonly text: boolean;
}

/** Lo's figure colors, which it defines on the figure's frame for both themes. */
export const FIGURE_COLORS: readonly string[] = Object.freeze([
  'fig-paper',
  'fig-panel',
  'fig-ink',
  'fig-muted',
  'fig-line',
  'fig-blue',
  'fig-blue-soft',
  'fig-aqua',
  'fig-aqua-soft',
  'fig-green',
  'fig-green-soft',
  'fig-amber',
  'fig-amber-soft',
  'fig-red',
  'fig-red-soft',
  'fig-violet',
  'fig-violet-soft',
]);

/** How a figure draws: color, stroke and type, on any element that draws. */
const PRESENTATION: Readonly<Record<string, SvgValue>> = {
  fill: 'paint',
  'fill-opacity': 'opacity',
  'fill-rule': ['nonzero', 'evenodd'],
  stroke: 'paint',
  'stroke-width': 'size',
  'stroke-opacity': 'opacity',
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel', 'miter-clip', 'arcs'],
  'stroke-miterlimit': 'miter',
  opacity: 'opacity',
  color: 'color',
  // Lo sets the figure's type, and maps `monospace` to its own.
  'font-family': ['monospace'],
  'font-size': 'size',
  'font-weight': 'weight',
  'font-style': ['normal', 'italic', 'oblique'],
  'text-anchor': ['start', 'middle', 'end'],
  'dominant-baseline': [
    'auto',
    'middle',
    'central',
    'hanging',
    'alphabetic',
    'ideographic',
    'mathematical',
    'text-before-edge',
    'text-after-edge',
    'text-top',
    'text-bottom',
  ],
  'letter-spacing': 'spacing',
  'text-decoration': ['none', 'underline', 'overline', 'line-through'],
  'paint-order': 'order',
};

/**
 * Dashes, only on what has a length to dash, so nothing inherits them: each is drawn like a shape
 * of its own, and they're counted along the element's length.
 */
const DASHES: Readonly<Record<string, SvgValue>> = {
  'stroke-dasharray': 'dashes',
  'stroke-dashoffset': 'coordinate',
};

/** Where markers go: only shapes with vertices. */
const MARKERS: Readonly<Record<string, SvgValue>> = {
  'marker-start': 'marker',
  'marker-mid': 'marker',
  'marker-end': 'marker',
};

const DRAWN: readonly SvgName[] = [
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'title',
  'desc',
];

const CONTAINER: readonly SvgName[] = [...DRAWN, 'marker', 'defs'];

const DESCRIBED: readonly SvgName[] = ['title', 'desc'];

const TEXT: Readonly<Record<string, SvgValue>> = {
  x: 'coordinates',
  y: 'coordinates',
  dx: 'coordinates',
  dy: 'coordinates',
  rotate: 'numbers',
  textLength: 'size',
  lengthAdjust: ['spacing', 'spacingAndGlyphs'],
};

function shape(attributes: Record<string, SvgValue>, markable = false): SvgRule {
  return {
    attributes: {
      id: 'id',
      transform: 'transform',
      ...PRESENTATION,
      ...DASHES,
      ...(markable ? MARKERS : {}),
      ...attributes,
    },
    children: DESCRIBED,
    text: false,
  };
}

function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) frozen(inner);
  }
  return value;
}

/** Each element a figure may hold: what it may hold, and its attributes. */
export const SVG_ELEMENTS: Readonly<Record<SvgName, SvgRule>> = frozen({
  // No width or height: the renderer sizes the figure, by its viewBox.
  svg: {
    attributes: {
      id: 'id',
      viewBox: 'viewBox',
      preserveAspectRatio: 'aspect',
      ...PRESENTATION,
    },
    children: CONTAINER,
    text: false,
  },
  g: {
    attributes: { id: 'id', transform: 'transform', ...PRESENTATION },
    children: CONTAINER,
    text: false,
  },
  // Definitions, which draw nothing themselves: here, only markers.
  defs: { attributes: { id: 'id' }, children: ['marker', ...DESCRIBED], text: false },
  // A marker draws only shapes and paths: text it held would be laid out again at every vertex.
  marker: {
    attributes: {
      id: 'id',
      viewBox: 'viewBox',
      refX: 'coordinate',
      refY: 'coordinate',
      markerWidth: 'size',
      markerHeight: 'size',
      markerUnits: ['strokeWidth', 'userSpaceOnUse'],
      orient: 'orient',
      preserveAspectRatio: 'aspect',
      ...PRESENTATION,
    },
    children: DRAWN.filter((name) => name !== 'text'),
    text: false,
  },
  rect: shape({
    x: 'coordinate',
    y: 'coordinate',
    width: 'size',
    height: 'size',
    rx: 'size',
    ry: 'size',
  }),
  circle: shape({ cx: 'coordinate', cy: 'coordinate', r: 'size' }),
  ellipse: shape({ cx: 'coordinate', cy: 'coordinate', rx: 'size', ry: 'size' }),
  line: shape({ x1: 'coordinate', y1: 'coordinate', x2: 'coordinate', y2: 'coordinate' }, true),
  polyline: shape({ points: 'points' }, true),
  polygon: shape({ points: 'points' }, true),
  path: shape({ d: 'path' }, true),
  text: {
    attributes: { id: 'id', transform: 'transform', ...PRESENTATION, ...TEXT },
    children: ['tspan', ...DESCRIBED],
    text: true,
  },
  tspan: {
    attributes: { id: 'id', ...PRESENTATION, ...TEXT },
    children: ['tspan'],
    text: true,
  },
  title: { attributes: {}, children: [], text: true },
  desc: { attributes: {}, children: [], text: true },
});

/** The rule for `name`, when it's an element a figure may hold. */
export function svgRule(name: string): SvgRule | undefined {
  const rules: Readonly<Record<string, SvgRule>> = SVG_ELEMENTS;
  return Object.hasOwn(rules, name) ? rules[name] : undefined;
}

/** What `attribute` on `element` holds, when it may have it. */
export function svgValueOf(element: string, attribute: string): SvgValue | undefined {
  const rule = svgRule(element);
  if (!rule || !Object.hasOwn(rule.attributes, attribute)) return undefined;
  return rule.attributes[attribute];
}

/**
 * Whether `value` is one `attribute` on `element` may hold, in the form `sanitizeSvg` writes it.
 * For `id` and the marker attributes, it's a name.
 */
export function isSvgAttribute(element: string, attribute: string, value: string): boolean {
  const kind = svgValueOf(element, attribute);
  if (kind === undefined) return false;
  if (kind === 'id' || kind === 'marker') return isName(value);
  return readValue(kind, value)?.value === value;
}

/** A value read in the one form it's kept in, and how many numbers it holds. */
export interface Read {
  value: string;
  numbers: number;
  /** For a path or points, how many vertices: where a marker can go, a path's closes included. */
  vertices?: number;
  /** For a path or points, at most how long it is, in its own units. */
  length?: number;
  /** For points, how far from the last back to the first, which a polygon draws. */
  closing?: number;
}

/** The largest number a value may hold, either side of zero. */
export const MAX_MAGNITUDE = 1_000_000;

/** The least magnitude of a normal 32-bit float. */
const LEAST_NORMAL = 2 ** -126;

/** The longest name, an id or a marker's. */
export const MAX_NAME = 64;

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMBER_AT = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /^[A-Za-z_][\w.-]*$/;

function isName(text: string): boolean {
  return text.length <= MAX_NAME && NAME.test(text);
}

/**
 * CSS's spaces off both ends; only those, so no other space slips through as one. By hand: a
 * regular expression for a run at the end tries again at every space of a run inside, which takes
 * time in the square of its length.
 */
function trimmed(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/** A number as written in SVG, when it's finite and within `MAX_MAGNITUDE`. */
function number(text: string): number | undefined {
  if (text.length > 64 || !NUMBER.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MAGNITUDE) return undefined;
  // A browser reads SVG's numbers as 32-bit floats, and one too small for a normal one as 0, so a
  // radius of 1e-200 draws a straight line. It's kept as the 0 it is.
  return Math.abs(value) < LEAST_NORMAL ? 0 : value;
}

function written(value: number): string {
  // `String` writes -0 as 0, and small numbers with an exponent, which SVG reads.
  return String(value);
}

/** The items of a list separated by spaces or one comma, or undefined when one is empty. */
function items(text: string): string[] | undefined {
  const list = trimmed(text).split(/[\t\n\f\r ]*,[\t\n\f\r ]*|[\t\n\f\r ]+/);
  return list.some((item) => item === '') ? undefined : list;
}

/** A length: a number, then `px`, `em` or `%`, or nothing. */
function length(text: string, least?: number): string | undefined {
  const match = /^(.*?)(px|em|%)?$/i.exec(text);
  const value = match?.[1] === undefined ? undefined : number(match[1]);
  if (value === undefined || (least !== undefined && value < least)) return undefined;
  return `${written(value)}${match?.[2]?.toLowerCase() ?? ''}`;
}

function numbers(text: string, least?: number): number[] | undefined {
  const list = items(text);
  if (!list) return undefined;
  const values: number[] = [];
  for (const item of list) {
    const value = number(item);
    if (value === undefined || (least !== undefined && value < least)) return undefined;
    values.push(value);
  }
  return values;
}

/** `text` read as `kind`, in the one form it's kept in, or undefined when it's not allowed. */
export function readValue(kind: SvgValue, text: string): Read | undefined {
  if (typeof kind !== 'string') {
    const word = trimmed(text).toLowerCase();
    const found = kind.find((keyword) => keyword.toLowerCase() === word);
    return found === undefined ? undefined : { value: found, numbers: 0 };
  }
  switch (kind) {
    case 'coordinate':
    case 'size': {
      const value = length(trimmed(text), kind === 'size' ? 0 : undefined);
      return value === undefined ? undefined : { value, numbers: 1 };
    }
    case 'coordinates': {
      const list = items(text);
      const values = list?.map((item) => length(item));
      if (!values || values.some((value) => value === undefined)) return undefined;
      return { value: values.join(' '), numbers: values.length };
    }
    case 'numbers': {
      const values = numbers(text);
      return values && { value: values.map(written).join(' '), numbers: values.length };
    }
    case 'opacity':
    case 'miter': {
      const value = number(trimmed(text));
      if (value === undefined) return undefined;
      if (kind === 'opacity' ? value < 0 || value > 1 : value < 1) return undefined;
      return { value: written(value), numbers: 1 };
    }
    case 'dashes': {
      // In the element's own units, as its length is, so its dashes can be counted.
      if (trimmed(text).toLowerCase() === 'none') return { value: 'none', numbers: 0 };
      const values = items(text)?.map((item) => number(item.replace(/px$/i, '')));
      if (!values || values.some((value) => value === undefined || value < 0)) return undefined;
      return { value: values.map((value) => written(value!)).join(' '), numbers: values.length };
    }
    case 'paint':
    case 'color': {
      const value = color(trimmed(text), kind === 'paint');
      return value === undefined ? undefined : { value, numbers: 0 };
    }
    case 'viewBox': {
      const values = numbers(text);
      if (values?.length !== 4 || values[2]! <= 0 || values[3]! <= 0) return undefined;
      return { value: values.map(written).join(' '), numbers: 4 };
    }
    case 'points': {
      const values = numbers(text);
      if (!values || values.length < 2 || values.length % 2 !== 0) return undefined;
      const open = polylineLength(values, false);
      return {
        value: values.map(written).join(' '),
        numbers: values.length,
        vertices: values.length / 2,
        length: open,
        closing: polylineLength(values, true) - open,
      };
    }
    case 'path':
      return path(text);
    case 'transform':
      return transform(text);
    case 'aspect': {
      const words = trimmed(text).split(/[\t\n\f\r ]+/);
      const [align, fit] = words;
      if (words.length > 2 || align === undefined) return undefined;
      if (align !== 'none' && !/^x(?:Min|Mid|Max)Y(?:Min|Mid|Max)$/.test(align)) return undefined;
      if (fit !== undefined && fit !== 'meet' && fit !== 'slice') return undefined;
      return { value: words.join(' '), numbers: 0 };
    }
    case 'orient': {
      const word = trimmed(text);
      const keyword = ['auto', 'auto-start-reverse'].find((name) => name === word.toLowerCase());
      if (keyword) return { value: keyword, numbers: 0 };
      const value = number(word.replace(/deg$/i, ''));
      return value === undefined ? undefined : { value: written(value), numbers: 1 };
    }
    case 'spacing': {
      const word = trimmed(text);
      if (word.toLowerCase() === 'normal') return { value: 'normal', numbers: 0 };
      const value = length(word);
      return value === undefined ? undefined : { value, numbers: 1 };
    }
    case 'weight': {
      const word = trimmed(text).toLowerCase();
      if (['normal', 'bold', 'bolder', 'lighter'].includes(word)) {
        return { value: word, numbers: 0 };
      }
      const value = number(word);
      if (value === undefined || value < 1 || value > 1000) return undefined;
      return { value: written(value), numbers: 1 };
    }
    case 'order': {
      const words = trimmed(text)
        .toLowerCase()
        .split(/[\t\n\f\r ]+/);
      if (words.length === 1 && words[0] === 'normal') return { value: 'normal', numbers: 0 };
      const allowed = ['fill', 'stroke', 'markers'];
      if (words.some((word) => !allowed.includes(word)) || new Set(words).size !== words.length) {
        return undefined;
      }
      return { value: words.join(' '), numbers: 0 };
    }
    case 'id':
      return isName(text) ? { value: text, numbers: 0 } : undefined;
    case 'marker': {
      // `url(#name)`, perhaps with the name quoted, as the name it gives.
      const match = /^url\([\t\n\f\r ]*(["']?)#([^"'()\\\s]*)\1[\t\n\f\r ]*\)$/i.exec(
        trimmed(text),
      );
      const name = match?.[2];
      return name !== undefined && isName(name) ? { value: name, numbers: 0 } : undefined;
    }
  }
  return undefined;
}

/** The CSS named colors, which draw as written. */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/**
 * A color: one of Lo's figure colors as `var(--fig-*)`, with no fallback; `currentColor`; a hex,
 * named or `rgb()` color; or, for a paint, `none`.
 */
function color(text: string, paint: boolean): string | undefined {
  const word = text.toLowerCase();
  if (paint && word === 'none') return 'none';
  if (word === 'currentcolor') return 'currentColor';
  if (word === 'transparent' || NAMED_COLORS.has(word)) return word;
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(word)) return word;
  // Custom properties' names keep their case.
  const variable = /^var\([\t\n\f\r ]*--([\w-]+)[\t\n\f\r ]*\)$/i.exec(text);
  if (variable) {
    const name = variable[1]!;
    return FIGURE_COLORS.includes(name) ? `var(--${name})` : undefined;
  }
  const rgb = /^rgba?\(([^()]*)\)$/.exec(word);
  if (rgb) {
    const parts = rgb[1]!.split(',').map(trimmed);
    if (parts.length !== 3 && parts.length !== 4) return undefined;
    const channels: string[] = [];
    for (const [index, part] of parts.entries()) {
      const percent = part.endsWith('%');
      const value = number(percent ? part.slice(0, -1) : part);
      const most = index === 3 ? (percent ? 100 : 1) : percent ? 100 : 255;
      if (value === undefined || value < 0 || value > most) return undefined;
      channels.push(`${written(value)}${percent ? '%' : ''}`);
    }
    return `${channels.length === 4 ? 'rgba' : 'rgb'}(${channels.join(',')})`;
  }
  return undefined;
}

/** How many numbers each of a path's commands takes. */
const PATH_ARGUMENTS = new Map([
  ['m', 2],
  ['l', 2],
  ['h', 1],
  ['v', 1],
  ['c', 6],
  ['s', 4],
  ['q', 4],
  ['t', 2],
  ['a', 7],
  ['z', 0],
]);

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/**
 * A path's data as SVG's grammar reads it, rewritten with each command's numbers apart: it starts
 * with a move, each command has whole groups of its numbers, and an arc's flags are 0 or 1.
 * Anything else, and the whole path is refused, rather than drawn up to the mistake.
 */
function path(text: string): Read | undefined {
  let at = 0;
  let out = '';
  let count = 0;
  let vertices = 0;
  const pen = new Pen();
  const spaces = (): void => {
    while (isSpace(text[at])) at += 1;
  };
  /** Spaces, and at most one comma. */
  const separator = (): boolean => {
    spaces();
    if (text[at] !== ',') return false;
    at += 1;
    spaces();
    return true;
  };
  const read = (flag: boolean): number | undefined => {
    if (flag) {
      const char = text[at];
      if (char !== '0' && char !== '1') return undefined;
      at += 1;
      return char === '1' ? 1 : 0;
    }
    NUMBER_AT.lastIndex = at;
    const match = NUMBER_AT.exec(text);
    if (!match) return undefined;
    at += match[0].length;
    return number(match[0]);
  };
  spaces();
  if (at >= text.length) return undefined;
  while (at < text.length) {
    const command = text[at]!;
    const takes = PATH_ARGUMENTS.get(command.toLowerCase());
    if (takes === undefined || (out === '' && command.toLowerCase() !== 'm')) return undefined;
    at += 1;
    out += command;
    spaces();
    if (takes === 0) {
      // A marker goes where a close lands, too.
      vertices += 1;
      pen.draw(command, [], true);
      continue;
    }
    for (let group = 0; ; group += 1) {
      const values: number[] = [];
      for (let index = 0; index < takes; index += 1) {
        if (index > 0) separator();
        const value = read(command.toLowerCase() === 'a' && (index === 3 || index === 4));
        if (value === undefined) return undefined;
        values.push(value);
      }
      pen.draw(command, values, group === 0);
      out += (group > 0 ? ' ' : '') + values.map(written).join(' ');
      count += takes;
      vertices += 1;
      const comma = separator();
      // Another group of the same command, or the next command.
      if (!/[\d+.-]/.test(text[at] ?? '')) {
        if (comma) return undefined;
        break;
      }
    }
  }
  return { value: out, numbers: count, vertices, length: pen.bound };
}

/** How many numbers each transform takes. */
const TRANSFORMS = new Map([
  ['matrix', [6]],
  ['translate', [1, 2]],
  ['scale', [1, 2]],
  ['rotate', [1, 3]],
  ['skewX', [1]],
  ['skewY', [1]],
]);

/** One transform, and the spaces and comma after it, read where the last one ended. */
const TRANSFORM_AT = /([A-Za-z]+)[\t\n\f\r ]*\(([^()]*)\)[\t\n\f\r ]*,?[\t\n\f\r ]*/y;

/** A list of transforms, each with as many numbers as it takes, written `name(a,b)`. */
function transform(text: string): Read | undefined {
  const out: string[] = [];
  let count = 0;
  const list = trimmed(text);
  if (list === '') return undefined;
  TRANSFORM_AT.lastIndex = 0;
  while (TRANSFORM_AT.lastIndex < list.length) {
    const match = TRANSFORM_AT.exec(list);
    const takes = match ? TRANSFORMS.get(match[1]!) : undefined;
    const values = match?.[2] === undefined ? undefined : numbers(match[2]);
    if (!match || !takes || !values || !takes.includes(values.length)) return undefined;
    out.push(`${match[1]}(${values.map(written).join(',')})`);
    count += values.length;
  }
  if (list.endsWith(',')) return undefined;
  return { value: out.join(' '), numbers: count };
}
