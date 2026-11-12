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
      drawn: 2,
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
    // A marker of 63 circles, each with its radius, draws 127 each time: at 1,198 vertices, some
    // 152,000.
    const vertices = Array.from({ length: 1_200 }, (_, i) => `${i} ${i % 2}`).join(' ');
    expect(
      sanitizeSvg(`<svg>${CIRCLES}<polyline points="${vertices}" marker-mid="url(#m)"/></svg>`)
        .removed,
    ).toEqual([{ reason: 'drawn', element: 'svg' }]);
    // At each end only, it's drawn twice.
    expect(
      sanitized(
        `<svg>${CIRCLES}<polyline points="${vertices}" marker-end="url(#m)" marker-start="url(#m)"/></svg>`,
      ).removed,
    ).toEqual([]);
  });

  test('a marker lands on every close of a path', () => {
    const closes = `M50 50${'z'.repeat(50_000)}`;
    // 50,000 closes cost one each to draw,
    expect(sanitized(`<svg><path d="${closes}"/></svg>`).removed).toEqual([]);
    // but a marker at each is drawn 50,000 times.
    expect(
      sanitizeSvg(`<svg>${CIRCLES}<path d="${closes}" marker-mid="url(#m)"/></svg>`).removed,
    ).toEqual([{ reason: 'drawn', element: 'svg' }]);
    // Hundreds of thousands are too many to draw even without one.
    expect(sanitizeSvg(`<svg><path d="M50 50${'z'.repeat(400_000)}"/></svg>`).removed).toEqual([
      { reason: 'drawn', element: 'svg' },
    ]);
  });

  test("a marker lands on a polygon's closing vertex too", () => {
    // An empty marker draws 1. A polygon of n points draws 1, its 2n numbers and its n + 1
    // vertices, and the marker at n - 1 of them: with the figure, 4n + 2 in all.
    const most = (SVG_LIMITS.drawn - 2) / 4;
    expect(sanitized(polygon(most)).removed).toEqual([]);
    expect(sanitizeSvg(polygon(most + 1)).removed).toEqual([{ reason: 'drawn', element: 'svg' }]);
  });

  test('a marker holds no text, which it would lay out again at every vertex', () => {
    const made = sanitized(
      `<svg><marker id="m"><text>${'x'.repeat(1_000)}</text><g><text>y</text></g><title>T</title><circle r="1"/></marker><path d="M0 0L1 1L2 2" marker-mid="url(#m)"/></svg>`,
    );
    expect(removals(made)).toEqual(['element text', 'element text']);
    expect(JSON.stringify(made.svg)).not.toMatch(/x{10}|"y"/);
  });

  test('every character of text is drawn, and counts', () => {
    // The figure and the text element draw one each.
    expect(sanitized(longText(SVG_LIMITS.drawn - 2)).svg).toBeDefined();
    expect(sanitizeSvg(longText(SVG_LIMITS.drawn - 1)).removed).toEqual([
      { reason: 'drawn', element: 'svg' },
    ]);
  });

  test('a figure says how much it draws, and one refused says nothing', () => {
    expect(sanitized(longText(10)).drawn).toBe(12);
    expect(sanitized(longText(SVG_LIMITS.drawn - 2)).drawn).toBe(SVG_LIMITS.drawn);
    // Its markers count each time they're drawn: 4n + 2 for a polygon of n points.
    expect(sanitized(polygon(10)).drawn).toBe(42);
    // What's removed draws nothing.
    expect(sanitized('<svg><script>x</script><rect width="1"/></svg>').drawn).toBe(3);
    expect(sanitizeSvg(longText(SVG_LIMITS.drawn - 1))).not.toHaveProperty('drawn');
    expect(sanitizeSvg('<p>not a figure</p>')).not.toHaveProperty('drawn');
  });
});

/** A figure of an empty marker at every vertex of a polygon of `points` points. */
function polygon(points: number): string {
  return `<svg><marker id="m"/><polygon points="${'0 0 '.repeat(points).trim()}" marker-mid="url(#m)"/></svg>`;
}

/** A figure of one text of `length` characters. */
function longText(length: number): string {
  return `<svg><text>${'x'.repeat(length)}</text></svg>`;
}

/** What's removed from a figure of a rectangle, with `attributes` on the figure. */
function shaped(attributes: string): SvgRemoval[] {
  return sanitizeSvg(`<svg ${attributes}><rect/></svg>`).removed;
}

/** A figure of `count` paths, each dashed every unit along 4,250. */
function paths(count: number): string {
  return `<svg>${'<path d="M0 10L4250 10" stroke-dasharray="0.5 0.5"/>'.repeat(count)}</svg>`;
}

/** A figure of one `shape` through two points 100,000 apart, dashed every unit. */
function dashed(shape: string): string {
  return `<svg><${shape} points="0 0 100000 0" stroke-dasharray="0.5 0.5"/></svg>`;
}

/** A figure of a path dashed with `pattern`, and an offset. */
function dashedPath(pattern: string): string {
  return `<svg><path d="M0 0h10" stroke-dasharray="${pattern}" stroke-dashoffset="2"/></svg>`;
}

/** A hundred of `shape`, a tag left open, each dashed twice a unit. */
function hundred(shape: string): string {
  return `${shape} stroke-dasharray="0.25 0.25 0.25 0.25"/>`.repeat(100);
}

/** A figure of `shapes` and a text of `length` characters. */
function withText(shapes: string, length: number): string {
  return `<svg>${shapes}<text>${'x'.repeat(length)}</text></svg>`;
}

/**
 * The most characters of text that fit in a figure of `shapes`, with the text, within what a
 * figure may draw: the room they leave.
 */
function room(shapes: string): number {
  let fits = 0;
  let past = SVG_LIMITS.drawn + 1;
  while (fits + 1 < past) {
    const length = Math.floor((fits + past) / 2);
    if (sanitizeSvg(withText(shapes, length)).svg) fits = length;
    else past = length;
  }
  return fits;
}

/** A marker of 63 circles, each with its radius, which draws 127 each time it's drawn. */
const CIRCLES = `<marker id="m">${'<circle r="1"/>'.repeat(63)}</marker>`;

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

describe('dashes', () => {
  test('are only on what has a length to dash, so nothing inherits them', () => {
    const made = sanitized(
      `<svg stroke-dasharray="1 1"><g stroke-dasharray="1 1" stroke-dashoffset="1"><text stroke-dasharray="1 1">x</text></g><marker id="m" stroke-dasharray="1 1"/><path d="M0 0h10" stroke-dasharray="4 2" stroke-dashoffset="1" vector-effect="non-scaling-stroke"/></svg>`,
    );
    expect(removals(made)).toEqual([
      'attribute svg.stroke-dasharray',
      'attribute g.stroke-dasharray',
      'attribute g.stroke-dashoffset',
      'attribute text.stroke-dasharray',
      'attribute marker.stroke-dasharray',
      // Its dashes would be counted in the window's units, which scale with the figure.
      'attribute path.vector-effect',
    ]);
    expect(elements(made).at(-1)?.attributes).toEqual({
      d: 'M0 0h10',
      'stroke-dasharray': '4 2',
      'stroke-dashoffset': '1',
    });
  });

  test('are kept only with a period of at least 1, in the unit of the shape', () => {
    // Real figures: "4 3", and a period of exactly 1; an odd count is repeated, so 0.6 is 1.2.
    const kept = ['4 3', '4,3', '4px 3px', '1 0', '0.5 0.5', '0.5', '0.6', '0.2 0.2 0.2'];
    expect(kept.flatMap((pattern) => removals(sanitized(dashedPath(pattern))))).toEqual([]);
    // Just short of 1, with any count of numbers, zeros included, the dashes are removed.
    const short = ['0.499 0.5', '0.4995', '0.4', '0.1 0.1 0.2', '0', '0 0', '0.25 0.25'];
    for (const pattern of short) {
      const made = sanitized(dashedPath(pattern));
      expect(removals(made)).toEqual(['value path.stroke-dasharray']);
      // The path is kept, drawn solid.
      expect(elements(made).at(-1)?.attributes).toEqual({ d: 'M0 0h10', 'stroke-dashoffset': '2' });
    }
  });

  test('count against what a figure draws, along every kind of shape', () => {
    // Each dashed every unit along 200,000: 200,000 dashes, far past the cap, whatever the shape.
    const shapes = [
      '<path d="M0 10L200000 10"',
      '<line x2="200000"',
      '<polyline points="0 0 200000 0"',
      '<polygon points="0 0 100000 0"',
      '<rect width="50000" height="50000"',
      `<circle r="${200_000 / (2 * Math.PI)}"`,
      `<ellipse rx="${200_000 / (2 * Math.PI)}" ry="1"`,
      '<path d="M0 0C0 100000 200000 100000 200000 0"',
      '<path d="M0 0a1 1 0 0 1 100000 0"',
    ];
    const passing = shapes.filter(
      (shape) => sanitizeSvg(`<svg>${shape} stroke-dasharray="0.5 0.5"/></svg>`).svg,
    );
    expect(passing).toEqual([]);
    // At 1 apart, 4,302 each: thirty fit, but not thirty-one.
    expect(sanitized(paths(30)).removed).toEqual([]);
    expect(sanitizeSvg(paths(31)).removed).toEqual([{ reason: 'drawn', element: 'svg' }]);
  });

  test('allow each segment of a shape 8 float32 steps where it is drawn', () => {
    // Near 600,000, a float32 step is a sixteenth, and each segment is allowed 8: half a unit. A
    // hundred tiny shapes there, each dashed twice a unit, draw more than the same near the
    // origin, where a step is far smaller: they leave less room in the figure.
    const shapes = [
      '<rect x="600000.375" width="0.03125" height="0.03125"',
      '<circle cx="600000.375" r="0.001"',
      '<ellipse cy="600000.375" rx="0.001" ry="0.002"',
      '<line x1="600000.375" x2="600000.40625"',
      '<polyline points="600000.375 0 600000.40625 0 600000.375 0"',
      '<path d="M600000.375 0A0.01 0.01 0 0 1 600000.40625 0"',
    ];
    const less = shapes.filter(
      (shape) => room(hundred(shape)) >= room(hundred(shape.replaceAll('600000.', '0.'))),
    );
    expect(less).toEqual([]);
    // A figure that just fits is within what an independent count finds too, and one more
    // character is past it.
    for (const shape of shapes) {
      const fits = room(hundred(shape));
      expect(sanitized(withText(hundred(shape), fits)).removed).toEqual([]);
      expect(sanitizeSvg(withText(hundred(shape), fits + 1)).removed).toEqual([
        { reason: 'drawn', element: 'svg' },
      ]);
    }
  });

  test("along a polygon's closing side too", () => {
    // Dashed every unit along 100,000, some 100,000 dashes; closed back, some 200,000.
    expect(sanitized(dashed('polyline')).removed).toEqual([]);
    expect(sanitizeSvg(dashed('polygon')).removed).toEqual([{ reason: 'drawn', element: 'svg' }]);
  });

  test('in a marker, count each time the marker is drawn', () => {
    // A path dashed every unit along 1,000, some 1,000 dashes, in a marker: drawn at 100 vertices,
    // some 100,000 in all; at 400, past the cap. Its shapes alone would be a few thousand.
    const marker = '<marker id="m"><path d="M0 0h1000" stroke-dasharray="0.5 0.5"/></marker>';
    const at = (vertices: number) =>
      `<svg>${marker}<polyline points="${'1 1 '.repeat(vertices)}" marker-mid="url(#m)"/></svg>`;
    expect(sanitized(at(100)).removed).toEqual([]);
    expect(sanitizeSvg(at(400)).removed).toEqual([{ reason: 'drawn', element: 'svg' }]);
  });

  test('along a shape measured in units that depend on what is around it are removed', () => {
    const made = sanitized(
      '<svg><rect width="50%" height="10" stroke-dasharray="1 1" stroke-dashoffset="1"/><circle r="1em" stroke-dasharray="1"/><rect width="10px" height="10" stroke-dasharray="1"/></svg>',
    );
    expect(removals(made)).toEqual([
      'value rect.stroke-dasharray',
      'value rect.stroke-dashoffset',
      'value circle.stroke-dasharray',
    ]);
    expect(elements(made).at(-1)?.attributes).toMatchObject({ 'stroke-dasharray': '1' });
  });
});

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

  test('on proportions: a figure the article can lay out', () => {
    const refused = [{ reason: 'aspect', element: 'svg' }];
    for (const fine of [
      'viewBox="0 0 860 320"',
      'viewBox="0 0 100 800"',
      'viewBox="0 0 3200 100"',
      'viewBox="0 0 100000 100000"',
      '',
    ]) {
      expect(shaped(fine)).toEqual([]);
    }
    for (const tall of [
      'viewBox="0 0 1 1000000"',
      'viewBox="0 0 100 801"',
      'viewBox="0 0 3201 100"',
      'viewBox="0 0 100001 100000"',
    ]) {
      expect(shaped(tall)).toEqual(refused);
    }
  });

  test("the figure's own width and height are dropped: the renderer sizes it, by its viewBox", () => {
    const boxes: (string | undefined)[] = [];
    for (const sized of [
      'viewBox="0 0 860 320" width="1" height="100000"',
      'viewBox="0 0 860 320" width="1em" height="100000em"',
      'width="100%" height="50%"',
      'width="1em" height="20"',
      'width="20"',
      'width="0" height="20"',
      'width="-1" height="20"',
    ]) {
      const made = sanitized(`<svg ${sized}><rect width="1" height="1"/></svg>`);
      expect(made.removed).toEqual([]);
      expect(Object.keys(made.svg!.attributes).filter((name) => name !== 'viewBox')).toEqual([]);
      boxes.push(made.svg!.attributes['viewBox']);
    }
    expect(boxes).toEqual([
      '0 0 860 320',
      '0 0 860 320',
      ...Array.from({ length: 5 }, () => undefined),
    ]);
    // A shape's own are its own.
    expect(inside('<svg><rect width="10" height="20"/></svg>')).toEqual([
      rect({ width: '10', height: '20' }),
    ]);
  });

  test('without a viewBox, its width and height in its own units give it one, within the caps', () => {
    for (const [sized, box] of [
      ['width="860" height="320"', '0 0 860 320'],
      ['width=" 860px " height="320.5PX"', '0 0 860 320.5'],
      ['width="1e2" height="5e1"', '0 0 100 50'],
    ]) {
      const made = sanitized(`<svg ${sized}><rect width="1" height="1"/></svg>`);
      expect(made.removed).toEqual([]);
      expect(made.svg!.attributes).toEqual({ viewBox: box });
      // Its four numbers are counted, as a viewBox's are.
      expect(made.drawn).toBe(
        sanitized(`<svg viewBox="${box}"><rect width="1" height="1"/></svg>`).drawn,
      );
    }
    expect(sanitized('<svg width="1px" height="1000000"><rect/></svg>').removed).toEqual([
      { reason: 'aspect', element: 'svg' },
    ]);
    expect(sanitized('<svg width="100" height="801"><rect/></svg>').removed).toEqual([
      { reason: 'aspect', element: 'svg' },
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
