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
  sanitizeSvg,
  SVG_LIMITS,
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
 * A figure at the caps takes about 30 ms on a laptop, a third of the whole test's 90 ms. On a Linux
 * CI runner the whole test took 540 ms, so some 200 ms to sanitize; this is three times 250 ms.
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

function timed<T>(make: () => T): { made: T; elapsed: number } {
  const started = performance.now();
  const made = make();
  return { made, elapsed: performance.now() - started };
}

test('a 64 KiB comment shows within budget', () => {
  const text = document(65_536);
  const { made, elapsed } = timed(() =>
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
  const { made, elapsed } = timed(() => markdownTree(text, { breaks: false, limits }));
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
  const { made, elapsed } = timed(() =>
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
  const { made, elapsed } = timed(() => sanitizeSvg(text));
  expect(made.removed).toEqual([]);
  expect(svgProblems(made)).toEqual([]);
  expect(walkSvg(made).elements).toBeGreaterThan(0.95 * SVG_LIMITS.elements);
  expect(elapsed, `took ${elapsed} ms for a figure at the caps`).toBeLessThan(FIGURE_LIMIT);
});
