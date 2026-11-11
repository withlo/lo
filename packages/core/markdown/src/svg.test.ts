import { describe, expect, test } from 'vitest';

import { svgProblems } from '../test/svgwalker.ts';
import { MAX_DIAGNOSTICS } from './limits.ts';
import {
  sanitizeSvg,
  SVG_LIMITS,
  type SanitizedSvg,
  type SvgElement,
  type SvgNode,
  type SvgRemoval,
} from './svg.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

/** `text` sanitized, after checking the result holds only what the rules allow. */
function sanitized(text: string): SanitizedSvg {
  const made = sanitizeSvg(text);
  expect(svgProblems(made)).toEqual([]);
  return made;
}

/** The figure in `text`, with its root's own attributes left out. */
function inside(text: string): SvgNode[] {
  return sanitized(text).svg?.children ?? [];
}

/** Every element in the tree, in order. */
function elements(made: SanitizedSvg): SvgElement[] {
  const found: SvgElement[] = [];
  const stack: SvgNode[] = made.svg ? [made.svg] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind !== 'element') continue;
    found.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return found;
}

/** Each removal as `reason element[.attribute]`. */
function removals(made: SanitizedSvg): string[] {
  return made.removed.map(
    (removal: SvgRemoval) =>
      `${removal.reason} ${removal.element}${removal.attribute ? `.${removal.attribute}` : ''}`,
  );
}

function rect(attributes: Record<string, string> = {}): SvgElement {
  return { kind: 'element', name: 'rect', attributes, children: [] };
}

describe('what figures.md allows, it keeps', () => {
  test('its example, as written', () => {
    const example = `<svg viewBox="0 0 860 120" ${NS}>
  <rect x="0" y="24" width="126" height="60" rx="10" fill="var(--fig-panel)" stroke="var(--fig-line)"/>
  <text x="14" y="50" fill="var(--fig-ink)" font-weight="600">Request</text>
  <path d="M126 54h20" stroke="var(--fig-muted)" stroke-width="1.5"/>
  <rect x="146" y="24" width="126" height="60" rx="10" fill="var(--fig-blue-soft)" stroke="var(--fig-blue)"/>
  <text x="160" y="50" fill="var(--fig-ink)" font-weight="600">Estimate cost</text>
  <text x="160" y="68" fill="var(--fig-blue)" font-family="monospace" font-size="11">cost/analyzer.ts</text>
</svg>`;
    const made = sanitized(example);
    expect(made.removed).toEqual([]);
    expect(made.svg?.attributes).toEqual({ viewBox: '0 0 860 120' });
    expect(
      made.svg?.children.map((node) => (node.kind === 'element' ? node.name : node.kind)),
    ).toEqual(['rect', 'text', 'path', 'rect', 'text', 'text']);
    expect(made.svg?.children[5]).toEqual({
      kind: 'element',
      name: 'text',
      attributes: {
        x: '160',
        y: '68',
        fill: 'var(--fig-blue)',
        'font-family': 'monospace',
        'font-size': '11',
      },
      children: [{ kind: 'text', value: 'cost/analyzer.ts' }],
    });
  });

  test('arrows: markers, in defs or not, named once', () => {
    const made = sanitized(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fig-muted)"/></marker></defs>
      <line x1="0" y1="0" x2="10" y2="0" marker-end="url(#arrow)" marker-start="url('#arrow')" stroke="var(--fig-muted)"/>
      <path d="M0 0h10" marker-end="url(#later)" marker-mid="none"/>
      <marker id="later"><circle r="2"/></marker>
    </svg>`);
    expect(made.removed).toEqual([]);
    const [line, path] = elements(made)
      .filter((element) => ['line', 'path'].includes(element.name))
      .slice(1);
    expect(line?.attributes).toMatchObject({ 'marker-end': 'arrow', 'marker-start': 'arrow' });
    expect(path?.attributes).toEqual({ d: 'M0 0h10', 'marker-end': 'later' });
  });

  test('text only where SVG draws it, and as written', () => {
    const made = sanitized(
      `<svg>loose<g> also loose <text> a <tspan dy="1em">b &amp; c</tspan>\n d</text></g><title>T</title></svg>`,
    );
    expect(made.svg?.children).toEqual([
      {
        kind: 'element',
        name: 'g',
        attributes: {},
        children: [
          {
            kind: 'element',
            name: 'text',
            attributes: {},
            children: [
              { kind: 'text', value: ' a ' },
              {
                kind: 'element',
                name: 'tspan',
                attributes: { dy: '1em' },
                children: [{ kind: 'text', value: 'b & c' }],
              },
              { kind: 'text', value: '\n d' },
            ],
          },
        ],
      },
      { kind: 'element', name: 'title', attributes: {}, children: [{ kind: 'text', value: 'T' }] },
    ]);
  });

  test('an XML declaration, a doctype, comments and namespace declarations change nothing', () => {
    const made = sanitized(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- drawn by hand --><svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>`,
    );
    expect(made).toEqual({
      svg: { kind: 'element', name: 'svg', attributes: {}, children: [rect()] },
      removed: [],
    });
  });
});

describe('scripts', () => {
  test('in every form, are removed with their content', () => {
    const made = sanitized(`<svg ${NS} onload="alert(1)">
      <script>alert(2)</script><SCRIPT type="text/ecmascript">alert(3)</SCRIPT>
      <script xlink:href="data:text/javascript,alert(4)"/>
      <svg:script>alert(5)</svg:script>
      <desc><script>alert(6)</script><img src=x onerror="alert(7)"></desc>
      <rect onclick="alert(8)" ONMOUSEOVER="alert(9)" onBegin="alert(10)" xlink:onload="alert(11)"/>
      <set attributeName="onmouseover" to="alert(12)"/>
      <animate onbegin="alert(13)" attributeName="href" values="javascript:alert(14)"/>
      <handler type="application/ecmascript">alert(15)</handler>
    </svg>`);
    expect(JSON.stringify(made.svg)).not.toMatch(/alert|script/i);
    expect(removals(made)).toEqual([
      'script svg.onload',
      'script script',
      'script script',
      'script script',
      'element svg:script',
      // HTML, in the description.
      'script script',
      'element img',
      'script rect.onclick',
      'script rect.onmouseover',
      'script rect.onbegin',
      'attribute rect.xlink:onload',
      'element set',
      'element animate',
      'element handler',
    ]);
    expect(elements(made).map((element) => element.name)).toEqual(['svg', 'desc', 'rect']);
  });
});

describe('addresses', () => {
  test('`javascript:` and `data:` in any attribute, however written, are removed', () => {
    const values = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      'java&#x09;script:alert(1)',
      '&#106;avascript:alert(1)',
      '&#x6A;&#x61;vascript&colon;alert(1)',
      '\u0001javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'DATA:text/html,<script>alert(1)</script>',
    ];
    const attributes = [
      'href',
      'xlink:href',
      'XLINK:HREF',
      'foo:href',
      'src',
      'fill',
      'stroke',
      'id',
      'transform',
      'd',
      'font-family',
      'marker-end',
      'x',
    ];
    const reasons = new Set<string>();
    for (const value of values) {
      const shapes = attributes.map(
        (attribute) => `<path ${attribute}="${value.replaceAll('"', '&quot;')}"/>`,
      );
      const made = sanitized(`<svg>${shapes.join('')}</svg>`);
      // Not one attribute is left; each `path` stays, emptied.
      expect(
        elements(made).filter((element) => Object.keys(element.attributes).length > 0),
      ).toEqual([]);
      expect(made.removed).toHaveLength(attributes.length);
      for (const removal of made.removed) reasons.add(removal.reason);
    }
    expect(reasons).toEqual(new Set(['script', 'reference', 'id']));
  });

  test('anything outside the figure is removed: links, images, uses, and url() paints', () => {
    const made = sanitized(`<svg>
      <a href="https://evil.example/"><rect/></a>
      <image href="https://evil.example/track.png"/><image xlink:href="data:image/png;base64,AA"/>
      <use href="other.svg#a"/><use xlink:href="#local"/>
      <rect fill="url(https://evil.example/p.svg#p)" stroke="url(#local)" filter="url(#f)" mask="url(#m)" clip-path="url(#c)" cursor="url(x.cur)"/>
      <text font-family="url(x)">x</text>
      <feImage href="https://evil.example/"/>
    </svg>`);
    expect(JSON.stringify(made.svg)).not.toMatch(/evil|url|#local|data:/);
    expect(removals(made)).toEqual([
      'element a',
      'element image',
      'element image',
      'element use',
      'element use',
      'reference rect.fill',
      'reference rect.stroke',
      'reference rect.filter',
      'reference rect.mask',
      'reference rect.clip-path',
      'reference rect.cursor',
      'reference text.font-family',
      'element feImage',
    ]);
  });
});

describe('CSS', () => {
  test('style sheets, style attributes and classes are removed', () => {
    const made = sanitized(`<svg>
      <style>@import url(https://evil.example/x.css); rect { fill: url(#a) }</style>
      <style><![CDATA[ * { background: url(https://evil.example/) } ]]></style>
      <rect style="fill:red;background:url(https://evil.example/)" class="a b"/>
    </svg>`);
    expect(JSON.stringify(made.svg)).not.toMatch(/evil|import|url/);
    expect(removals(made)).toEqual([
      'style style',
      'style style',
      'style rect.style',
      'style rect.class',
    ]);
  });

  test('a presentation attribute holds a color, never CSS', () => {
    const values = [
      'url(#a)',
      'expression(alert(1))',
      'var(--lo-accent)',
      'var(--fig-blue, url(https://evil.example/))',
      'var(--fig-font)',
      String.raw`\75 rl(https://evil.example/)`,
      '&#x75;rl(https://evil.example/)',
      'u&#x72;l(x)',
      'red;fill:url(x)',
      'red/**/',
      '@import "x"',
      'inherit',
    ];
    const made = sanitized(
      `<svg>${values.map((value) => `<rect fill="${value.replaceAll('"', '&quot;')}" stroke="${value.replaceAll('"', '&quot;')}"/>`).join('')}</svg>`,
    );
    expect(elements(made).filter((element) => Object.keys(element.attributes).length > 0)).toEqual(
      [],
    );
    expect(made.removed).toHaveLength(values.length * 2);
  });

  test('values mangled with spaces or entities read as SVG reads them, or not at all', () => {
    expect(
      inside(
        `<svg><rect fill=" &#x76;ar(--fig-blue) " x="&#49;0" stroke="\tCurrentColor\n" width="1&#x2e;5"/></svg>`,
      ),
    ).toEqual([rect({ fill: 'var(--fig-blue)', x: '10', stroke: 'currentColor', width: '1.5' })]);
    // Spaces CSS doesn't count as spaces are part of the value.
    const made = sanitized(`<svg><rect fill="&#xa0;red" x="&#x2003;1" width="1&#x200b;0"/></svg>`);
    expect(elements(made)[1]?.attributes).toEqual({});
  });
});

describe('elements Lo draws no part of', () => {
  test('are removed with what they hold', () => {
    const names = [
      'foreignObject',
      'image',
      'a',
      'use',
      'symbol',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
      'discard',
      'filter',
      'feGaussianBlur',
      'linearGradient',
      'radialGradient',
      'pattern',
      'mask',
      'clipPath',
      'textPath',
      'switch',
      'view',
      'metadata',
      'font',
      'iframe',
      'video',
      'audio',
      'canvas',
    ];
    const made = sanitized(
      // Closed as HTML is: in `foreignObject`, it's HTML.
      `<svg>${names.map((name) => `<${name} id="${name}"><rect id="in-${name}"></rect></${name}>`).join('')}<rect/></svg>`,
    );
    expect(made.svg?.children).toEqual([rect()]);
    expect(made.removed.map((removal) => removal.element)).toEqual(names);
  });

  test('a `use` chain is gone, so it multiplies nothing', () => {
    let chain = '<rect id="a0" width="1"/>';
    for (let i = 1; i < 12; i++) {
      chain += `<g id="a${i}"><use href="#a${i - 1}"/><use href="#a${i - 1}"/></g>`;
    }
    const made = sanitized(`<svg>${chain}</svg>`);
    expect(elements(made).map((element) => element.name)).toEqual([
      'svg',
      'rect',
      ...Array(11).fill('g'),
    ]);
  });

  test('an element where it can’t go is removed', () => {
    const made = sanitized(
      '<svg><rect><circle/></rect><text><rect/></text><defs><rect/></defs><title><b>x</b></title><svg/></svg>',
    );
    expect(removals(made)).toEqual([
      'element circle',
      'element rect',
      'element rect',
      'element b',
      'element svg',
    ]);
  });
});

describe('HTML in SVG', () => {
  test('HTML that closes the figure is outside it', () => {
    const made = sanitized('<svg><rect/><p>hi</p><circle/></svg><img src=x onerror=alert(1)>');
    expect(made.svg?.children).toEqual([rect()]);
    // The image is in the HTML `circle`.
    expect(removals(made)).toEqual(['element p', 'element circle']);
  });

  test('`</svg>` and integration points let nothing out', () => {
    const leaking = [
      '<svg><desc></svg><script>alert(1)</script></desc></svg>',
      '<svg><title></svg><img src=x onerror=alert(1)></title></svg>',
      '<svg><foreignObject><iframe srcdoc="<script>alert(1)</script>"></iframe></foreignObject></svg>',
      '<svg><style><img src=x onerror=alert(1)></style></svg>',
      '<svg><desc><svg><script>alert(1)</script></svg></desc></svg>',
      '<svg><text>a</text></svg ><script>alert(1)</script>',
      '<svg><![CDATA[</svg><script>alert(1)</script>]]></svg>',
      '<svg><noscript><img src=x onerror=alert(1)></noscript></svg>',
      '<svg><template><script>alert(1)</script></template></svg>',
    ].filter((html) => /alert|script|img/.test(JSON.stringify(sanitized(html).svg)));
    expect(leaking).toEqual([]);
  });

  test('MathML inside is only an element Lo removes', () => {
    const made = sanitized(
      '<svg><text><math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math></text></svg>',
    );
    expect(JSON.stringify(made.svg)).not.toMatch(/alert|img|math/);
    expect(removals(made)).toContain('element math');
  });

  test('a figure must be an svg at the top', () => {
    expect(sanitizeSvg('<div><svg></svg></div>').removed).toEqual([
      { reason: 'root', element: 'svg' },
    ]);
    expect(sanitizeSvg('').svg).toBe(undefined);
    expect(sanitizeSvg('<math><svg></svg></math>').svg).toBe(undefined);
    // Only the first is the figure.
    expect(removals(sanitized('<p>caption</p><svg></svg><svg></svg>'))).toEqual([
      'element p',
      'element svg',
    ]);
  });

  test('namespaces and prefixes can’t make an element or attribute Lo’s', () => {
    const made =
      sanitized(`<svg xmlns="http://www.w3.org/1999/xhtml" xmlns:evil="https://evil.example/">
      <svg:rect/><html:script>alert(1)</html:script><RECT X="1" Fill="red" svg:fill="red" xml:space="preserve" xmlns:xlink="https://evil.example/"/>
    </svg>`);
    expect(elements(made).map((element) => [element.name, element.attributes])).toEqual([
      ['svg', {}],
      ['rect', { x: '1', fill: 'red' }],
    ]);
    expect(removals(made)).toEqual([
      'attribute svg.xmlns',
      'reference svg.xmlns:evil',
      'element svg:rect',
      'element html:script',
      'attribute rect.svg:fill',
      'attribute rect.xml:space',
      'attribute rect.xmlns:xlink',
    ]);
  });
});

describe('entities', () => {
  test('a DTD is never read: entities stay their text', () => {
    const lol = Array.from(
      { length: 9 },
      (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`,
    ).join('');
    const bomb = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol0 "lol">${lol}<!ENTITY ext SYSTEM "file:///etc/passwd">]><svg><text>&lol9; &ext;</text></svg>`;
    const started = performance.now();
    const made = sanitized(bomb);
    expect(performance.now() - started).toBeLessThan(100);
    expect(made.svg?.children).toEqual([
      {
        kind: 'element',
        name: 'text',
        attributes: {},
        children: [{ kind: 'text', value: '&lol9; &ext;' }],
      },
    ]);
  });

  test("HTML's own character references decode, each to a character or two", () => {
    expect(inside('<svg><text>&lt;&amp;&#x1F600;&NotEqualTilde;&lol;</text></svg>')).toEqual([
      {
        kind: 'element',
        name: 'text',
        attributes: {},
        children: [{ kind: 'text', value: '<&😀≂̸&lol;' }],
      },
    ]);
  });
});

describe('ids', () => {
  test("named like Lo's own, or JavaScript's, they're only names", () => {
    const names = [
      'root',
      'app',
      'lo',
      'window',
      'document',
      '__proto__',
      'constructor',
      'toString',
    ];
    const made = sanitized(
      `<svg><marker id="__proto__"><rect/></marker>${names
        .slice(0, -1)
        .map((name) => (name === '__proto__' ? '' : `<g id="${name}"/>`))
        .join('')}<path d="M0 0" id="toString" marker-end="url(#__proto__)"/></svg>`,
    );
    expect(made.removed).toEqual([]);
    expect(elements(made).map((element) => element.attributes['id'])).toEqual([
      undefined,
      '__proto__',
      undefined,
      ...names.filter((name) => name !== '__proto__' && name !== 'toString'),
      'toString',
    ]);
    const path = elements(made).at(-1)!;
    expect(Object.getPrototypeOf(path.attributes)).toBe(Object.prototype);
    expect(path.attributes['marker-end']).toBe('__proto__');
  });

  test('an id that is no plain name is removed', () => {
    const made = sanitized(
      `<svg><g id="a b"/><g id="x&quot;y"/><g id="&lt;p&gt;"/><g id="${'a'.repeat(65)}"/><g id="1a"/><g id=""/></svg>`,
    );
    expect(removals(made)).toEqual(Array(6).fill('id g.id'));
  });

  test('an id defined twice names nothing, and nothing can reach it', () => {
    const made = sanitized(`<svg>
      <marker id="m"><circle r="1"/></marker><g id="m"/>
      <path d="M0 0" marker-end="url(#m)"/>
      <marker id="twice"/><marker id="twice"/><path d="M0 0" marker-start="url(#twice)"/>
    </svg>`);
    expect(elements(made).filter((element) => 'id' in element.attributes)).toEqual([]);
    expect(removals(made)).toEqual([
      'id marker.id',
      'id g.id',
      'reference path.marker-end',
      'id marker.id',
      'id marker.id',
      'reference path.marker-start',
    ]);
  });

  test('a marker attribute names only a marker', () => {
    const made = sanitized(`<svg>
      <g id="g"/><text id="t">x</text>
      <path d="M0 0" marker-end="url(#g)" marker-start="url(#t)" marker-mid="url(#missing)"/>
      <rect marker-end="url(#g)"/><g marker-end="url(#g)"/>
    </svg>`);
    expect(removals(made)).toEqual([
      'reference path.marker-end',
      'reference path.marker-start',
      'reference path.marker-mid',
      'reference rect.marker-end',
      'reference g.marker-end',
    ]);
  });
});

describe('markers', () => {
  test('a marker draws no marker: not itself, nor another', () => {
    const made = sanitized(`<svg>
      <marker id="self"><path d="M0 0L1 1" marker-end="url(#self)"/></marker>
      <marker id="a"><g><path d="M0 0L1 1" marker-mid="url(#b)"/></g></marker>
      <marker id="b"><polyline points="0 0 1 1" marker-start="url(#a)"/><marker id="inner"/></marker>
      <marker id="c"><g><marker id="deeper"/></g></marker>
      <path d="M0 0L1 1L2 2" marker-mid="url(#a)" marker-end="url(#self)"/>
    </svg>`);
    expect(removals(made)).toEqual([
      'reference path.marker-end',
      'reference path.marker-mid',
      'reference polyline.marker-start',
      'element marker',
      'element marker',
    ]);
    expect(elements(made).at(-1)?.attributes).toEqual({
      d: 'M0 0L1 1L2 2',
      'marker-mid': 'a',
      'marker-end': 'self',
    });
  });

  test('a figure whose markers would draw too much is refused', () => {
    // A marker of 64 elements at each of 400 vertices: some 25,000 drawn.
    const marker = `<marker id="m">${'<circle r="1"/>'.repeat(63)}</marker>`;
    const vertices = Array.from({ length: 400 }, (_, i) => `${i} ${i % 2}`).join(' ');
    expect(
      sanitizeSvg(`<svg>${marker}<polyline points="${vertices}" marker-mid="url(#m)"/></svg>`)
        .removed,
    ).toEqual([{ reason: 'drawn', element: 'svg' }]);
    // At each end only, it's drawn twice.
    expect(
      sanitized(
        `<svg>${marker}<polyline points="${vertices}" marker-end="url(#m)" marker-start="url(#m)"/></svg>`,
      ).removed,
    ).toEqual([]);
  });
});

/** `count` rectangles in a figure. */
function rects(count: number): string {
  return `<svg>${'<rect/>'.repeat(count)}</svg>`;
}

/** Groups in a figure, `depth` deep with the figure. */
function nested(depth: number): string {
  return `<svg>${'<g>'.repeat(depth - 1)}`;
}

/** `count` pairs of numbers. */
function pairs(count: number): string {
  return '0 0 '.repeat(count).trim();
}

describe('the caps', () => {
  test('on size', () => {
    const at = `<svg>${' '.repeat(SVG_LIMITS.size - 11)}</svg>`;
    expect(at.length).toBe(SVG_LIMITS.size);
    expect(sanitized(at).svg).toBeDefined();
    expect(sanitizeSvg(`${at} `).removed).toEqual([{ reason: 'size', element: 'svg' }]);
  });

  test('on elements, kept or not', () => {
    expect(sanitized(rects(SVG_LIMITS.elements - 1)).svg?.children).toHaveLength(
      SVG_LIMITS.elements - 1,
    );
    expect(sanitizeSvg(rects(SVG_LIMITS.elements)).removed).toEqual([
      { reason: 'elements', element: 'svg' },
    ]);
    expect(sanitizeSvg(`<svg>${'<b>'.repeat(SVG_LIMITS.elements)}</svg>`).removed[0]?.reason).toBe(
      'elements',
    );
  });

  test('on depth', () => {
    expect(sanitized(nested(SVG_LIMITS.depth)).svg).toBeDefined();
    expect(sanitizeSvg(nested(SVG_LIMITS.depth + 1)).removed).toEqual([
      { reason: 'depth', element: 'svg' },
    ]);
    // Deeper still, as fast.
    const started = performance.now();
    expect(sanitizeSvg(nested(SVG_LIMITS.elements - 1)).removed[0]?.reason).toBe('depth');
    expect(performance.now() - started).toBeLessThan(250);
  });

  test('on numbers: a flood of coordinates is refused', () => {
    expect(
      sanitized(`<svg><polyline points="${pairs(SVG_LIMITS.numbers / 2)}"/></svg>`).svg,
    ).toBeDefined();
    expect(
      sanitizeSvg(`<svg><path d="M${pairs(SVG_LIMITS.numbers / 2 + 1)}"/></svg>`).removed,
    ).toEqual([{ reason: 'numbers', element: 'svg' }]);
    // Spread over many elements, too.
    const polyline = `<polyline points="${pairs(17)}"/>`;
    expect(sanitizeSvg(`<svg>${polyline.repeat(2_000)}</svg>`).removed).toEqual([
      { reason: 'numbers', element: 'svg' },
    ]);
  });

  test('numbers too large to draw are removed', () => {
    const made = sanitized(
      `<svg><rect x="1e309" width="${'9'.repeat(400)}" height="1e7" stroke-width="1e6" font-size="-1"/></svg>`,
    );
    expect(elements(made)[1]?.attributes).toEqual({ 'stroke-width': '1000000' });
    expect(removals(made)).toEqual([
      'value rect.x',
      'value rect.width',
      'value rect.height',
      'value rect.font-size',
    ]);
  });

  test('on what it lists, with every removal counted against it', () => {
    const made = sanitized(`<svg>${'<rect onclick="x"/>'.repeat(MAX_DIAGNOSTICS + 10)}</svg>`);
    expect(made.removed).toHaveLength(MAX_DIAGNOSTICS);
  });

  test('names in what it lists are cut, and whole', () => {
    const made = sanitized(`<svg><${'x'.repeat(63)}😀/><rect ${'y'.repeat(100)}="1"/></svg>`);
    expect(
      made.removed.map((removal) => [removal.element.length, removal.attribute?.length]),
    ).toEqual([
      [64, undefined],
      [4, 64],
    ]);
  });
});

describe('whatever the text', () => {
  test('it never throws, and holds only what the rules allow', () => {
    const pieces = [
      '<svg>',
      '</svg>',
      '<g>',
      '</g>',
      '<rect x="1"/>',
      '<text>',
      'a',
      '<p>',
      '<desc>',
      '<!--',
      '-->',
      '<![CDATA[',
      ']]>',
      '&amp;',
      '<marker id="m">',
      '<path d="M0 0" marker-end="url(#m)"/>',
      '"',
      "'",
      '<',
      '>',
      '\ud800',
      '\u0000',
    ];
    let seed = 1;
    const next = () => (seed = (seed * 48_271) % 2_147_483_647);
    const failing: [string, string[]][] = [];
    for (let run = 0; run < 300; run++) {
      const text = Array.from({ length: 40 }, () => pieces[next() % pieces.length]).join('');
      const found = svgProblems(sanitizeSvg(text));
      if (found.length > 0) failing.push([text, found]);
    }
    expect(failing).toEqual([]);
  });
});
