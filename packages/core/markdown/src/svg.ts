/**
 * An overview's SVG figure, from anyone's pull request, as Lo's own small tree of SVG. It's parsed
 * with the same HTML parser as posts, as a browser reads SVG in a page, never with an XML parser:
 * no DTD is read and no entity expanded, so an entity's name stays its text. Then it's walked with
 * an explicit stack, keeping only the elements, attributes and values the allowlist names, each
 * value in the one form the allowlist keeps it in. Whatever else the figure held is removed, and
 * listed with why, so an overview can leave the figure out with a note and the checker says the
 * same. A figure past a cap on its size, elements, depth or numbers, or whose markers would draw
 * too much, is refused whole.
 *
 * What a renderer must do with the tree:
 *
 * - Make each element with `createElementNS` in SVG's namespace, and set each attribute itself,
 *   after checking it with `isSvgAttribute`, and the element against `SVG_ELEMENTS`.
 * - Scope every `id` and marker attribute to the figure, as it does a document's anchors, and write
 *   a marker attribute as `url(#<the scoped name>)`.
 * - Set text only as text.
 */

import { html as namespaces, type DefaultTreeAdapterTypes } from 'parse5';

import { readValue, svgRule, type SvgName } from './allowlist.ts';
import { parseHtml, type Fragment } from './html.ts';
import { MAX_DIAGNOSTICS } from './limits.ts';

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

export interface SvgElement {
  kind: 'element';
  name: SvgName;
  /** Its attributes, each one the allowlist allows on it, in the form it keeps it in. */
  attributes: Record<string, string>;
  children: SvgNode[];
}

export interface SvgText {
  kind: 'text';
  value: string;
}

export type SvgNode = SvgElement | SvgText;

/**
 * Why something was removed:
 *
 * - `script`: a script, an event handler, or a script's address in any attribute;
 * - `style`: a style sheet, or a `style` or `class` attribute;
 * - `reference`: an address outside the figure, `url()` anywhere but in a marker attribute, or a
 *   marker attribute that names no marker defined once, or is inside a marker;
 * - `element`: an element Lo doesn't draw, with all it held: `foreignObject`, `image`, `a`, `use`,
 *   animations and `set`, filters, gradients, patterns, masks, HTML, and anything else outside
 *   the allowlist; or one where it can't go, such as a marker inside a marker;
 * - `attribute`: an attribute Lo doesn't draw on that element;
 * - `value`: an attribute Lo draws, with a value outside its form: a color that isn't one of Lo's
 *   or plain, a number too large, a path that doesn't parse;
 * - `id`: an id that isn't a plain name, or one defined more than once, which names nothing.
 *
 * And why a whole figure was refused, the only entry then:
 *
 * - `size`: it's longer than the cap;
 * - `elements`: it would build more elements, or attributes, than the cap;
 * - `depth`: it nests deeper than the cap;
 * - `numbers`: it holds more numbers than the cap;
 * - `drawn`: it draws more elements than the cap, each of a marker's counted each time it's drawn;
 * - `root`: it has no `<svg>` at the top.
 */
export type SvgReason =
  | 'script'
  | 'style'
  | 'reference'
  | 'element'
  | 'attribute'
  | 'value'
  | 'id'
  | 'size'
  | 'elements'
  | 'depth'
  | 'numbers'
  | 'drawn'
  | 'root';

export interface SvgRemoval {
  reason: SvgReason;
  /** The element it was, or was on, as the parser named it, cut to `MAX_SVG_NAME` characters. */
  element: string;
  /** The attribute, when an attribute was removed, cut the same way. */
  attribute?: string;
  /** The line it's on, counting from 1. */
  line?: number;
}

export interface SanitizedSvg {
  /** The figure, unless it was refused whole. */
  svg?: SvgElement;
  /** What was removed, and why, at most `MAX_DIAGNOSTICS` of them. */
  removed: SvgRemoval[];
}

export interface SvgLimits {
  /** The most characters (UTF-16 code units) read. */
  size: number;
  /** The most elements the parse may build, kept or not. */
  elements: number;
  /** How deep elements may nest, the `<svg>` itself one deep. */
  depth: number;
  /** The most numbers its values may hold, all together. */
  numbers: number;
  /** The most elements it may draw, each of a marker's counted each time the marker is drawn. */
  drawn: number;
}

/**
 * A figure is some 860 by 320, drawn by hand or by an agent: these are far more than one needs,
 * and little enough for the window to lay out on its main thread.
 */
export const SVG_LIMITS: Readonly<SvgLimits> = Object.freeze({
  size: 524_288,
  elements: 4_096,
  depth: 32,
  numbers: 65_536,
  drawn: 16_384,
});

/** The longest name a removal gives. */
export const MAX_SVG_NAME = 64;

const XMLNS: string = namespaces.NS.XMLNS;

/** Namespace declarations that change nothing, since Lo makes every element in SVG's namespace. */
const DECLARATIONS = new Map<string, string>([
  ['xmlns', namespaces.NS.SVG],
  ['xmlns:xlink', namespaces.NS.XLINK],
]);

/** The elements the parser makes of its own for a fragment: a root and a stand-in document. */
const PARSER_ELEMENTS = 2;

/** `text`, an SVG file, as Lo's tree of SVG, and what was removed from it. Never throws. */
export function sanitizeSvg(text: string): SanitizedSvg {
  if (text.length > SVG_LIMITS.size) return refused('size');
  const fragment = parseHtml(text.toWellFormed(), SVG_LIMITS.elements + PARSER_ELEMENTS, true);
  if (!fragment) return refused('elements');
  return new Sanitizer().run(fragment);
}

function refused(reason: SvgReason): SanitizedSvg {
  return { removed: [{ reason, element: 'svg' }] };
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

/** Where something is in the text: its line, from 1, and its offset, which orders removals. */
interface Place {
  line: number | undefined;
  offset: number;
}

function placeOf(node: Element): Place {
  const at = node.sourceCodeLocation;
  return { line: at?.startLine, offset: at?.startOffset ?? 0 };
}

function attributePlace(node: Element, name: string): Place {
  const attributes = node.sourceCodeLocation?.attrs;
  const key = name.toLowerCase();
  const at = attributes && Object.hasOwn(attributes, key) ? attributes[key] : undefined;
  return at ? { line: at.startLine, offset: at.startOffset } : placeOf(node);
}

function named(name: string): string {
  return name.slice(0, MAX_SVG_NAME).toWellFormed();
}

/** Why an element Lo doesn't draw was removed. */
function elementReason(name: string): SvgReason {
  if (name === 'script') return 'script';
  if (name === 'style') return 'style';
  return 'element';
}

/**
 * Why an attribute was removed: a script's address, or any other, wherever it hides in the value,
 * else `fallback`.
 */
function attributeReason(value: string, fallback: SvgReason): SvgReason {
  let squashed = '';
  for (const char of value.toLowerCase()) {
    if (char.charCodeAt(0) > 0x20 && !/\s/u.test(char)) squashed += char;
  }
  if (/(?:java|vb)script:/.test(squashed)) return 'script';
  if (/url\(|data:|\/\/|@import|^[a-z][\d+.a-z-]*:/.test(squashed)) return 'reference';
  return fallback;
}

/** A marker attribute, held back until every marker is known. */
interface Reference {
  element: SvgElement;
  attribute: string;
  name: string;
  place: Place;
  /** How many times the marker would be drawn on its element. */
  times: number;
}

/** A node to read, and where it goes. */
interface Entry {
  node: ChildNode;
  parent: SvgElement;
  /** How deep it is, the `<svg>` one deep. */
  depth: number;
  /** The marker it's in, if any. */
  marker: SvgElement | undefined;
}

interface Removed {
  removal: SvgRemoval;
  offset: number;
}

class Sanitizer {
  /**
   * What was removed, in three lists each in the text's order: what's around the figure, what's
   * in it, and what settling the names removed. Each keeps at most as many as the result does.
   */
  private readonly around: Removed[] = [];
  private readonly within: Removed[] = [];
  private readonly settled: Removed[] = [];
  private numbers = 0;
  /** Elements drawn once each: all but markers' content. */
  private drawn = 0;
  /** Each kept element with an id, by the id. */
  private readonly ids = new Map<string, { element: SvgElement; place: Place }[]>();
  private readonly references: Reference[] = [];
  /** How many elements each marker holds, itself included. */
  private readonly markers = new Map<SvgElement, number>();

  run(fragment: Fragment): SanitizedSvg {
    let root: Element | undefined;
    for (const node of fragment.childNodes) {
      if (!isElement(node)) continue;
      if (!root && node.tagName === 'svg' && node.namespaceURI === namespaces.NS.SVG) {
        root = node;
      } else {
        // What the HTML parser closed the figure for, and anything else around it.
        this.remove(
          this.around,
          elementReason(node.tagName),
          node.tagName,
          undefined,
          placeOf(node),
        );
      }
    }
    if (!root) return refused('root');
    const svg = this.element(root, 'svg', undefined);
    this.drawn += 1;
    // Each node in the text's order, with an explicit stack.
    const stack: Entry[] = [];
    const pushChildren = (
      node: Element,
      parent: SvgElement,
      depth: number,
      marker?: SvgElement,
    ) => {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        stack.push({ node: node.childNodes[i]!, parent, depth, marker });
      }
    };
    pushChildren(root, svg, 2);
    while (stack.length > 0) {
      const { node, parent, depth, marker } = stack.pop()!;
      const rule = svgRule(parent.name)!;
      if (node.nodeName === '#text' && 'value' in node) {
        // SVG draws text only in its text elements.
        if (rule.text) parent.children.push({ kind: 'text', value: node.value });
        continue;
      }
      if (!isElement(node)) continue;
      const name = node.tagName;
      const holds: readonly string[] = rule.children;
      const allowed =
        node.namespaceURI === namespaces.NS.SVG &&
        holds.includes(name) &&
        !(name === 'marker' && marker);
      if (!allowed || !isSvgName(name)) {
        this.remove(this.within, elementReason(name), name, undefined, placeOf(node));
        continue;
      }
      if (depth > SVG_LIMITS.depth) return refused('depth');
      const element = this.element(node, name, marker);
      if (this.numbers > SVG_LIMITS.numbers) return refused('numbers');
      parent.children.push(element);
      const inside = name === 'marker' ? element : marker;
      if (inside) this.markers.set(inside, (this.markers.get(inside) ?? 0) + 1);
      else this.drawn += 1;
      pushChildren(node, element, depth + 1, inside);
    }
    this.resolve();
    if (this.drawn > SVG_LIMITS.drawn) return refused('drawn');
    const removed = [...this.around, ...this.within, ...this.settled]
      .toSorted((a, b) => a.offset - b.offset)
      .slice(0, MAX_DIAGNOSTICS)
      .map((entry) => entry.removal);
    return { svg, removed };
  }

  /** `node` as an element of the tree, with the attributes it may have. */
  private element(node: Element, name: SvgName, marker: SvgElement | undefined): SvgElement {
    const rule = svgRule(name)!;
    const attributes: Record<string, string> = {};
    const made: SvgElement = { kind: 'element', name, attributes, children: [] };
    const references: Omit<Reference, 'times'>[] = [];
    // Where markers go: each vertex of a path or points, and a line's two ends.
    let vertices = name === 'line' ? 2 : 0;
    for (const attribute of node.attrs) {
      const written = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
      const { value } = attribute;
      const place = attributePlace(node, written);
      const remove = (reason: SvgReason): void =>
        this.remove(this.within, reason, name, written, place);
      if (attribute.namespace === XMLNS) {
        if (DECLARATIONS.get(written) !== value) remove('attribute');
        continue;
      }
      // `xlink:href`, `xml:space` and the like: none is Lo's.
      if (attribute.namespace) {
        remove(attributeReason(value, 'attribute'));
        continue;
      }
      if (written.startsWith('on')) {
        remove('script');
        continue;
      }
      if (written === 'style' || written === 'class') {
        remove('style');
        continue;
      }
      const kind = Object.hasOwn(rule.attributes, written) ? rule.attributes[written] : undefined;
      if (kind === undefined) {
        remove(attributeReason(value, 'attribute'));
        continue;
      }
      if (kind === 'marker') {
        // No marker, as when it's left out.
        if (/^[\t\n\f\r ]*none[\t\n\f\r ]*$/i.test(value)) continue;
        if (marker) {
          remove('reference');
          continue;
        }
        const read = readValue(kind, value);
        if (read) references.push({ element: made, attribute: written, name: read.value, place });
        else remove(attributeReason(value, 'value'));
        continue;
      }
      const read = readValue(kind, value);
      if (!read) {
        remove(kind === 'id' ? 'id' : attributeReason(value, 'value'));
        continue;
      }
      attributes[written] = read.value;
      this.numbers += read.numbers;
      if (read.vertices !== undefined) vertices = read.vertices;
      if (kind === 'id') {
        const holders = this.ids.get(read.value) ?? [];
        holders.push({ element: made, place });
        this.ids.set(read.value, holders);
      }
    }
    for (const reference of references) {
      const times = reference.attribute === 'marker-mid' ? Math.max(0, vertices - 2) : 1;
      this.references.push({ ...reference, times });
    }
    return made;
  }

  /**
   * Settles the names: an id defined more than once names nothing, and a marker attribute is kept
   * only when it names a marker defined once. Counts what the markers draw.
   */
  private resolve(): void {
    const removed: Removed[] = [];
    const remove = (reason: SvgReason, element: string, attribute: string, place: Place): void => {
      removed.push({
        removal: removal(reason, element, attribute, place.line),
        offset: place.offset,
      });
    };
    for (const holders of this.ids.values()) {
      if (holders.length < 2) continue;
      for (const { element, place } of holders) {
        delete element.attributes['id'];
        remove('id', element.name, 'id', place);
      }
    }
    for (const { element, attribute, name, place, times } of this.references) {
      const holders = this.ids.get(name);
      const target = holders?.length === 1 ? holders[0]!.element : undefined;
      if (target?.name !== 'marker') {
        remove('reference', element.name, attribute, place);
        continue;
      }
      element.attributes[attribute] = name;
      this.drawn += times * (this.markers.get(target) ?? 1);
    }
    this.settled.push(...removed.toSorted((a, b) => a.offset - b.offset).slice(0, MAX_DIAGNOSTICS));
  }

  private remove(
    list: Removed[],
    reason: SvgReason,
    element: string,
    attribute: string | undefined,
    place: Place,
  ): void {
    if (list.length >= MAX_DIAGNOSTICS) return;
    list.push({ removal: removal(reason, element, attribute, place.line), offset: place.offset });
  }
}

function removal(
  reason: SvgReason,
  element: string,
  attribute: string | undefined,
  line: number | undefined,
): SvgRemoval {
  const made: SvgRemoval = { reason, element: named(element) };
  if (attribute !== undefined) made.attribute = named(attribute);
  if (line !== undefined) made.line = line;
  return made;
}

function isSvgName(name: string): name is SvgName {
  return svgRule(name) !== undefined;
}
