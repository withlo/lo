/**
 * Showing text stays fast at the sizes Lo meets: a comment at GitHub's 64 KiB limit, a large
 * overview, and a figure at every cap. Each is timed on its first run in a fresh module, as a
 * background job runs it.
 */

import { expect, test } from 'vitest';

import { readFileSync } from 'node:fs';

import {
  DEFAULT_LIMITS,
  githubTree,
  markdownTree,
  plainText,
  MAX_DIAGNOSTICS,
  sanitizeSvg,
  SVG_LIMITS,
  type SanitizedSvg,
} from '../src/index.ts';
import { svgProblems, walkSvg } from './svgwalker.ts';
import { problems } from './walker.ts';

/**
 * How long each may take, in milliseconds: three times the slowest run on a Linux CI runner,
 * which runs test files side by side (about 250 ms for the comment, 400 ms for the overview and
 * 650 ms for the rendering, against 30, 60 and 100 ms on a laptop). Faster machines pass easily.
 */
const COMMENT_LIMIT = 750;
const OVERVIEW_LIMIT = 1_200;
const RENDERING_LIMIT = 2_000;
/**
 * A figure at the caps takes about 30 ms on a laptop, about a third of its whole test, which also
 * makes the figure and walks what comes back. On a Linux CI runner the whole test took 670 ms, so
 * some 220 ms to sanitize; this is three times 250 ms. Each figure's time is printed.
 */
const FIGURE_LIMIT = 750;

/** One section of a typical long description or overview, about 1.6 KB. */
function section(n: number): string {
  return `## Part ${n}: the *cache* and its \`limits\`

This part changes how the [request queue](https://github.com/octo/repo/blob/main/src/queue.ts) waits,
so @octocat's fix in #${n} and octo/other#${n + 1} hold. See [the notes](#part-${n}-the-cache-and-its-limits)
and the footnote[^n${n}].

> [!NOTE]
> Retries back off **exponentially**, capped at ~~60~~ 30 seconds.

- [x] Read the queue's state once per poll
- [ ] Drop the second read, which www.example.com/docs says is redundant
  1. Nested step with \`code\`
  2. Another, with a link to https://example.com/a?b=${n}

| Case | Before | After |
|:-----|-------:|:-----:|
| cold | 120 ms | 40 ms |
| warm | 30 ms | 12 ms |

\`\`\`ts
export function wait(attempt: number): number {
  return Math.min(30_000, 2 ** attempt * 100);
}
\`\`\`

![The queue, before and after](https://camo.githubusercontent.com/${n.toString(16).padStart(40, '0')}/68747470733a2f2f652e636f6d2f612e706e67)

[^n${n}]: The old limit came from the first version of the poller.

`;
}

function document(size: number): string {
  let text = '';
  for (let n = 1; text.length < size; n++) text += section(n);
  return text.slice(0, size);
}

/** `make` run once, and how long it took, which is printed, so CI's logs show it. */
function timed<T>(what: string, make: () => T): { made: T; elapsed: number } {
  const started = performance.now();
  const made = make();
  const elapsed = performance.now() - started;
  console.info(`${what}: ${elapsed.toFixed(1)} ms`);
  return { made, elapsed };
}

test('a 64 KiB comment shows within budget', () => {
  const text = document(65_536);
  const { made, elapsed } = timed('a 64 KiB comment', () =>
    markdownTree(text, {
      page: 'https://github.com/octo/repo/pull/1',
      repo: { owner: 'octo', name: 'repo' },
    }),
  );
  expect(made.notes).toEqual([]);
  expect(problems(made)).toEqual([]);
  expect(plainText(made, 200)).toMatch(/^Part 1: the cache and its limits This part/);
  expect(elapsed, `took ${elapsed} ms for a 64 KiB comment`).toBeLessThan(COMMENT_LIMIT);
});

test('a 200 KB overview shows within budget', () => {
  const text = document(200_000);
  const limits = { length: 262_144, nodes: 262_144, images: 1_000, addresses: 1_048_576 };
  const { made, elapsed } = timed('a 200 KB overview', () =>
    markdownTree(text, { breaks: false, limits }),
  );
  expect(made.notes).toEqual([]);
  expect(problems(made, { ...DEFAULT_LIMITS, ...limits })).toEqual([]);
  expect(elapsed, `took ${elapsed} ms for a 200 KB overview`).toBeLessThan(OVERVIEW_LIMIT);
});

test('a 1 MiB rendering shows within budget', () => {
  // GitHub's rendering of every construct, over and over, to just under the limit on HTML.
  const one = readFileSync(
    new URL('../../../../testing/fixtures/markdown/github/constructs.html', import.meta.url),
    'utf8',
  );
  const bytes = new TextEncoder().encode(one).length;
  const html = one.repeat(Math.floor(DEFAULT_LIMITS.html / bytes));
  expect(html.length).toBeGreaterThan(DEFAULT_LIMITS.html * 0.9);
  const { made, elapsed } = timed('a 1 MiB rendering', () =>
    githubTree({ html, markdown: '' }, { page: 'https://github.com/rozed-dev/e2e/pull/23' }),
  );
  // Read from the HTML, not the Markdown, and all of it.
  expect(made.blocks.filter((block) => block.kind === 'heading')).toHaveLength(
    18 * Math.floor(DEFAULT_LIMITS.html / bytes),
  );
  expect(problems(made)).toEqual([]);
  expect(elapsed, `took ${elapsed} ms for a 1 MiB rendering`).toBeLessThan(RENDERING_LIMIT);
});

/**
 * A figure as large as Lo reads: a thousand labelled boxes, each with an arrow of 24 points, some
 * 420 KB with 4,000 elements and 57,000 numbers.
 */
function figureAtCaps(): string {
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 320"><defs>' +
    '<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" orient="auto">' +
    '<path d="M0 0L10 5L0 10z" fill="var(--fig-muted)"/></marker></defs>';
  for (let i = 0; i < 1_000; i++) {
    const points = Array.from({ length: 24 }, (_, k) => `${(k * 7) % 97} ${(k * 13 + i) % 89}`);
    svg +=
      `<g transform="translate(${i % 40},${i % 25})">` +
      `<rect x="${i}" y="24" width="126" height="60" rx="10" fill="var(--fig-panel)" stroke="var(--fig-line)"/>` +
      `<path d="M${points.join(' ')}" stroke="var(--fig-blue)" marker-end="url(#arrow)"/>` +
      `<text x="${i}" y="50" fill="var(--fig-ink)" font-family="monospace">part ${i}</text></g>`;
  }
  return `${svg}</svg>`;
}

test('a figure at the caps sanitizes within budget', () => {
  const text = figureAtCaps();
  expect(text.length).toBeGreaterThan(0.75 * SVG_LIMITS.size);
  const { made, elapsed } = timed('a figure at the caps', () => sanitizeSvg(text));
  expect(made.removed).toEqual([]);
  expect(svgProblems(made)).toEqual([]);
  expect(walkSvg(made).elements).toBeGreaterThan(0.95 * SVG_LIMITS.elements);
  expect(elapsed, `took ${elapsed} ms for a figure at the caps`).toBeLessThan(FIGURE_LIMIT);
});

/**
 * A path of one arc from the origin to 999,000 down, with radii `radii` turned `angle` degrees,
 * dashed every unit: drawn as a straight line when a radius is too small for a float32.
 */
const TINY_ARC = (radii: string, angle = 0) =>
  `<path d="M0 0A${radii} ${angle} 0 1 0 999000" stroke-dasharray="0.5 0.5"/>`;

/** A marker of 63 circles, which draws 127 each time it's drawn. */
const CIRCLES = `<marker id="m">${'<circle r="1"/>'.repeat(63)}</marker>`;
const SPACES = ' '.repeat(524_000);
const SEVEN_THOUSAND = '1 1 '.repeat(7_000);
const refused = (reason: string) => (made: SanitizedSvg) =>
  expect(made.removed).toEqual([{ reason, element: 'svg' }]);
const cut =
  (...removals: string[]) =>
  (made: SanitizedSvg) =>
    expect(made.removed.map((removal) => `${removal.reason} ${removal.element}`)).toEqual(removals);

/**
 * Figures built to be slow to sanitize or to draw: long runs of spaces inside values, markers at
 * every vertex and close, text in markers, tiny dashes, and sizes no article can lay out. Each is
 * cut down or refused as fast as a harmless figure, for its reason, so what it draws is counted.
 */
const WORST: [string, string, (made: SanitizedSvg) => void][] = [
  [
    'a fill with half a megabyte of spaces inside',
    `<svg><rect fill="1${SPACES}1"/></svg>`,
    cut('value rect'),
  ],
  [
    'spaces inside a transform',
    `<svg><rect transform="translate(1${SPACES}x)"/></svg>`,
    cut('value rect'),
  ],
  ['spaces inside a color', `<svg><rect fill="rgb(1${SPACES}1,2,3)"/></svg>`, cut('value rect')],
  [
    'spaces inside a marker reference',
    `<svg><marker id="m"/><path d="M0 0" marker-end="url(${SPACES}#m x)"/></svg>`,
    cut('reference path'),
  ],
  [
    'spaces around a color',
    `<svg><rect fill="${SPACES.slice(262_000)}red${SPACES.slice(262_000)}"/></svg>`,
    cut(),
  ],
  [
    'a marker at each of 400,000 closes',
    `<svg>${CIRCLES}<path d="M50 50${'z'.repeat(400_000)}" marker-mid="url(#m)"/></svg>`,
    refused('drawn'),
  ],
  [
    'a marker at each of 50,000 closes',
    `<svg>${CIRCLES}<path d="M50 50${'z'.repeat(50_000)}" marker-mid="url(#m)"/></svg>`,
    refused('drawn'),
  ],
  [
    'a marker at every vertex of a polygon',
    `<svg>${CIRCLES}<polygon points="${'1 1 '.repeat(5_000)}" marker-mid="url(#m)"/></svg>`,
    refused('drawn'),
  ],
  [
    'a marker holding half a megabyte of text, at 7,000 vertices',
    `<svg><marker id="m"><text>${'x'.repeat(480_000)}</text></marker><polyline points="${SEVEN_THOUSAND}" marker-mid="url(#m)"/></svg>`,
    cut('element text'),
  ],
  [
    'text in a group in a marker, at 7,000 vertices',
    `<svg><marker id="m"><g><text>${'x'.repeat(480_000)}</text></g></marker><polyline points="${SEVEN_THOUSAND}" marker-mid="url(#m)"/></svg>`,
    cut('element text'),
  ],
  [
    'a long title in a marker, at 7,000 vertices',
    `<svg><marker id="m"><title>${'x'.repeat(480_000)}</title></marker><polyline points="${SEVEN_THOUSAND}" marker-mid="url(#m)"/></svg>`,
    refused('drawn'),
  ],
  ['half a megabyte of text', `<svg><text>${'x'.repeat(500_000)}</text></svg>`, refused('drawn')],
  ['a viewBox a million tall', '<svg viewBox="0 0 1 1000000"><rect/></svg>', refused('aspect')],
  [
    '1,000 paths dashed every 0.002',
    `<svg>${'<path d="M0 10L860 10" stroke-dasharray="0.001 0.001"/>'.repeat(1_000)}</svg>`,
    refused('drawn'),
  ],
  [
    'one path dashed every 0.002',
    '<svg><path d="M0 10L860 10" stroke-dasharray="0.001 0.001"/></svg>',
    refused('drawn'),
  ],
  [
    'tiny dashes set on the figure, for 300 paths to inherit',
    `<svg stroke-dasharray="0.001 0.001">${'<path d="M0 10L860 10"/>'.repeat(300)}</svg>`,
    cut('attribute svg'),
  ],
  [
    'tiny dashes set on a group, for 300 paths to inherit',
    `<svg><g stroke-dasharray="0.001 0.001">${'<path d="M0 10L860 10"/>'.repeat(300)}</g></svg>`,
    cut('attribute g'),
  ],
  [
    'a dashed path in a marker drawn 200 times',
    `<svg><marker id="m"><path d="M0 0h100" stroke-dasharray="0.01 0.01"/></marker><polyline points="${'1 1 '.repeat(200)}" marker-mid="url(#m)"/></svg>`,
    refused('drawn'),
  ],
  [
    'a dashed path in a marker at 10,922 closes',
    `<svg><marker id="m"><path d="M0 0h10" stroke-dasharray="1 1"/></marker><path d="M50 50${'z'.repeat(10_922)}" marker-mid="url(#m)"/></svg>`,
    refused('drawn'),
  ],
  [
    'a tiny arc dashed, 4,000 times',
    `<svg>${TINY_ARC('1e-200 1e-200').repeat(4_000)}</svg>`,
    refused('drawn'),
  ],
  ['one tiny arc dashed', `<svg>${TINY_ARC('1e-200 1e-200')}</svg>`, refused('drawn')],
  ['an arc with only its x radius tiny', `<svg>${TINY_ARC('1e-200 5')}</svg>`, refused('drawn')],
  ['an arc with only its y radius tiny', `<svg>${TINY_ARC('5 1e-200')}</svg>`, refused('drawn')],
  [
    'an arc with radii a float32 holds only as subnormals',
    `<svg>${TINY_ARC('1e-40 1e-40')}</svg>`,
    refused('drawn'),
  ],
  [
    'an arc with radii as small as a float32 holds',
    `<svg>${TINY_ARC('1.2e-38 1.2e-38')}</svg>`,
    refused('drawn'),
  ],
  [
    'an arc with one radius tiny, one huge, and turned',
    `<svg>${TINY_ARC('1e-200 1000000', 45)}</svg>`,
    refused('drawn'),
  ],
  [
    'a dashed zigzag near a million, where float32 steps are a sixteenth',
    `<svg><path d="M999999.03 0${'L999999.04 0L999999.03 0'.repeat(1_000)}" stroke-dasharray="0.0005"/></svg>`,
    refused('drawn'),
  ],
  [
    'a figure sized a hundred thousand tall',
    '<svg viewBox="0 0 860 320" width="1" height="100000"><rect/></svg>',
    (made) => {
      cut()(made);
      expect(made.svg?.attributes).toEqual({ viewBox: '0 0 860 320' });
    },
  ],
  [
    'a figure sized in ems',
    '<svg viewBox="0 0 860 320" width="1em" height="100000em"><rect/></svg>',
    (made) => {
      cut()(made);
      expect(made.svg?.attributes).toEqual({ viewBox: '0 0 860 320' });
    },
  ],
];

test('an element with 40,000 attributes, each its own, sanitizes within budget', () => {
  const text = `<svg><rect ${Array.from({ length: 40_000 }, (_, i) => `a${i}="1"`).join(' ')}/></svg>`;
  expect(text.length).toBeLessThanOrEqual(SVG_LIMITS.size);
  const { made, elapsed } = timed('40,000 attributes', () => sanitizeSvg(text));
  expect(svgProblems(made)).toEqual([]);
  expect(made.svg?.children).toEqual([
    { kind: 'element', name: 'rect', attributes: {}, children: [] },
  ]);
  expect(made.removed).toHaveLength(MAX_DIAGNOSTICS);
  expect(elapsed, `took ${elapsed} ms`).toBeLessThan(FIGURE_LIMIT);
});

test.each(WORST)('%s is cut down or refused within budget', (name, text, outcome) => {
  expect(text.length).toBeLessThanOrEqual(SVG_LIMITS.size);
  const { made, elapsed } = timed(name, () => sanitizeSvg(text));
  expect(svgProblems(made)).toEqual([]);
  outcome(made);
  expect(elapsed, `took ${elapsed} ms`).toBeLessThan(FIGURE_LIMIT);
});
