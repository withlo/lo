// An SVG figure, drawn from the tree the overview's check kept (`@lo/markdown`'s `SvgElement`),
// never from its file. The tree is plain data that crossed from another process, so nothing in it
// is trusted again: each element is made with `createElementNS` in SVG's namespace, only when the
// allowlist names it where it stands; each attribute is set only when `isSvgAttribute` allows its
// value; and text is set only as text. Every id and marker reference is scoped to the block that
// shows the figure, so a figure can't reach an id of Lo's own, or another block's.

import { isSvgAttribute, SVG_ELEMENTS, type SvgElement, type SvgName } from '@lo/markdown';

const SVG = 'http://www.w3.org/2000/svg';

/** The attributes that name a marker, which the tree holds as a name and the DOM as `url(#…)`. */
const MARKERS = new Set(['marker-start', 'marker-mid', 'marker-end']);

/** What a part may be: a shape, a group or a text, drawn once. */
const LINKABLE = new Set<SvgName>([
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
]);

/** A scope: Lo's own name, which every id in the figure starts with. */
const SCOPE = /^lo-[a-z\d-]+$/;

/** A figure drawn into SVG elements, not yet in the document. */
export interface DrawnSvg {
  svg: SVGSVGElement;
  /** Each element a part may name, by its id in the figure. */
  linkable: ReadonlyMap<string, SVGElement>;
  /** Its viewBox's width and height, when it has one, which its drawn size follows. */
  box: { width: number; height: number } | undefined;
}

/** The id `name`, an id in a figure, has in the document under `scope`. */
export function scopedId(scope: string, name: string): string {
  return `${scope}-${name}`;
}

/** A node of the tree to draw, and where it goes. */
interface Entry {
  node: unknown;
  parent: SVGElement;
  /** What its parent may hold. */
  holds: readonly string[];
  /** Whether its parent holds text. */
  text: boolean;
  /** Whether it's inside a marker. */
  marker: boolean;
  /** Whether it's inside a marker, or the definitions that hold them. */
  defined: boolean;
}

/**
 * Draws `tree` under `scope`, a name unique to the block that shows it. Undefined when its root
 * isn't an `svg` element, or `scope` isn't one of Lo's. Leaves out, with all it holds, anything
 * that isn't an element the allowlist has where it stands, and any attribute it doesn't allow.
 */
export function drawSvg(tree: SvgElement, scope: string): DrawnSvg | undefined {
  if (!SCOPE.test(scope) || !isElement(tree) || tree.name !== 'svg') return undefined;
  const linkable = new Map<string, SVGElement>();
  const ids = new Map<string, { element: SVGElement; name: SvgName; defined: boolean }>();
  /** Marker attributes, set once every marker is known. */
  const references: { element: SVGElement; attribute: string; name: string }[] = [];
  const twice = new Set<string>();
  const root = document.createElementNS(SVG, 'svg');
  const stack: Entry[] = [];
  const draw = (node: SvgElement, element: SVGElement, marker: boolean, defined: boolean): void => {
    for (const [attribute, value] of Object.entries(node.attributes)) {
      if (typeof value !== 'string' || !isSvgAttribute(node.name, attribute, value)) continue;
      if (attribute === 'id') {
        if (ids.has(value)) twice.add(value);
        else ids.set(value, { element, name: node.name, defined });
      } else if (MARKERS.has(attribute)) {
        // Nothing a marker draws has markers of its own.
        if (!marker) references.push({ element, attribute, name: value });
      } else {
        element.setAttribute(attribute, value);
      }
    }
    const rule = SVG_ELEMENTS[node.name];
    for (let index = node.children.length - 1; index >= 0; index--) {
      stack.push({
        node: node.children[index],
        parent: element,
        holds: rule.children,
        text: rule.text,
        marker: marker || node.name === 'marker',
        defined: defined || node.name === 'marker' || node.name === 'defs',
      });
    }
  };
  draw(tree, root, false, false);
  while (stack.length > 0) {
    const { node, parent, holds, text, marker, defined } = stack.pop()!;
    if (isRecord(node) && node['kind'] === 'text') {
      const value = node['value'];
      if (text && typeof value === 'string') parent.append(document.createTextNode(value));
      continue;
    }
    if (!isElement(node) || !holds.includes(node.name)) continue;
    // Nothing a marker draws is a marker, or text laid out again at every vertex.
    if (marker && (node.name === 'marker' || node.name === 'text')) continue;
    const element = document.createElementNS(SVG, node.name);
    parent.append(element);
    draw(node, element, marker, defined);
  }

  // An id two elements have names neither, as the check has it.
  for (const [name, { element, name: kind, defined }] of ids) {
    if (twice.has(name)) continue;
    element.setAttribute('id', scopedId(scope, name));
    // Not the figure itself, nor a marker or anything it draws.
    if (LINKABLE.has(kind) && !defined) linkable.set(name, element);
  }
  for (const { element, attribute, name } of references) {
    const target = twice.has(name) ? undefined : ids.get(name);
    if (target?.name === 'marker') {
      element.setAttribute(attribute, `url(#${scopedId(scope, name)})`);
    }
  }
  return { svg: root, linkable, box: viewBox(root) };
}

/** The width and height of `svg`'s viewBox, as the allowlist keeps it: four numbers, sized. */
function viewBox(svg: SVGSVGElement): DrawnSvg['box'] {
  const box = svg.getAttribute('viewBox')?.split(' ').map(Number);
  const [width, height] = box?.slice(2) ?? [];
  if (box?.length !== 4 || !(width! > 0) || !(height! > 0)) return undefined;
  return { width: width!, height: height! };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is an element of the tree, of a name the allowlist has, in its shape. */
function isElement(value: unknown): value is SvgElement {
  return (
    isRecord(value) &&
    value['kind'] === 'element' &&
    typeof value['name'] === 'string' &&
    Object.hasOwn(SVG_ELEMENTS, value['name']) &&
    isRecord(value['attributes']) &&
    Array.isArray(value['children'])
  );
}

/** A part a block links: an id in its figure, and what it links to, in words. */
export interface PartLink {
  id: string;
  /** Its accessible name: where it goes. */
  label: string;
}

/** How far a part's hit area reaches past it on each side, in the figure's units. */
const HIT_PADDING = 5;

/**
 * Wraps each of `parts` that names an element a part may be in a link: a `g.lo-fig-link`, focusable,
 * holding a `rect.lo-fig-hit` under the part, which `sizeHits` sizes. A part with a transform hands
 * it to its link, so the hit area is measured in the part's own units. Returns the links, each
 * with the index of its part.
 */
export function linkParts(drawn: DrawnSvg, parts: readonly PartLink[]): SVGGElement[] {
  const links: SVGGElement[] = [];
  const linked = new Set<string>();
  for (const [index, part] of parts.entries()) {
    const element = drawn.linkable.get(part.id);
    const parent = element?.parentNode;
    if (!element || !parent || linked.has(part.id)) continue;
    linked.add(part.id);
    const link = document.createElementNS(SVG, 'g');
    link.setAttribute('class', 'lo-fig-link');
    link.setAttribute('tabindex', '0');
    link.setAttribute('role', 'link');
    link.setAttribute('aria-label', part.label);
    link.dataset['part'] = String(index);
    const transform = element.getAttribute('transform');
    if (transform !== null) {
      link.setAttribute('transform', transform);
      element.removeAttribute('transform');
    }
    const hit = document.createElementNS(SVG, 'rect');
    hit.setAttribute('class', 'lo-fig-hit');
    parent.insertBefore(link, element);
    link.append(hit, element);
    links.push(link);
  }
  return links;
}

/** Sizes each link's hit area to its part, once the figure is laid out with its fonts. */
export function sizeHits(links: readonly SVGGElement[]): void {
  for (const link of links) {
    const [hit, part] = [link.firstElementChild, link.lastElementChild];
    if (hit?.localName !== 'rect' || !part || part === hit || !isMeasurable(part)) continue;
    let box: DOMRect;
    try {
      box = part.getBBox();
    } catch {
      // Not laid out: it has no box to measure yet.
      continue;
    }
    hit.setAttribute('x', String(box.x - HIT_PADDING));
    hit.setAttribute('y', String(box.y - HIT_PADDING));
    hit.setAttribute('width', String(Math.max(0, box.width + 2 * HIT_PADDING)));
    hit.setAttribute('height', String(Math.max(0, box.height + 2 * HIT_PADDING)));
  }
}

/** Whether `element` can say its box, as SVG's shapes, groups and texts can once laid out. */
function isMeasurable(element: Element): element is SVGGraphicsElement {
  return 'getBBox' in element && typeof element.getBBox === 'function';
}
