/**
 * Showing text stays fast at the sizes Lo meets: a comment at GitHub's 64 KiB limit and a large
 * overview. Each is timed on its first run in a fresh module, as a background job runs it.
 */

import { expect, test } from 'vitest';

import { readFileSync } from 'node:fs';

import { DEFAULT_LIMITS, githubTree, markdownTree, plainText } from '../src/index.ts';
import { problems } from './walker.ts';

/**
 * How long each may take, in milliseconds: three times the slowest run on a Linux CI runner,
 * which runs test files side by side (about 200 ms for the comment, 350 ms for the overview and
 * 500 ms for the rendering, against 30, 60 and 90 ms on a laptop). Faster machines pass easily.
 */
const COMMENT_LIMIT = 600;
const OVERVIEW_LIMIT = 1_050;
const RENDERING_LIMIT = 1_500;

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
