/**
 * Reading the largest overview the format allows stays fast: `artifact.md` at its size limit,
 * pointing 500 times, with 100 figures. It's timed on its first run in a fresh module, as a
 * background job runs it.
 */

import { expect, test } from 'vitest';

import { LIMITS, parseArtifact } from '../src/index.ts';
import { HEADER, timed } from './support.ts';
import { problems, walk } from './walker.ts';

/**
 * How long it may take, in milliseconds: three times the slowest run on a Linux CI runner, which
 * runs test files side by side (about 310 ms, against 60 ms on a laptop).
 */
const LIMIT = 1_000;

/** Prose that points nowhere, about 1.2 KB of it, as long overviews hold. */
function filler(n: number): string {
  return `### Detail ${n}

The *cache* keeps each tenant's \`bucket\` in memory, so a request reads it without a round trip.
When the process restarts, the buckets start full, which lets a burst through once; that's
accepted, since **restarts are rare** and the quota still holds over a minute.

- Reads take the lock only to refill.
- Writes ~~never~~ rarely wait: the refill is one comparison.
  1. Take the time.
  2. Add what's due.

| Case | Before | After |
|:-----|-------:|:-----:|
| cold | 120 ms | 40 ms |
| warm | 30 ms | 12 ms |

\`\`\`ts
export function refill(bucket: Bucket, now: number): void {
  bucket.tokens = Math.min(bucket.size, bucket.tokens + (now - bucket.at) * bucket.rate);
}
\`\`\`

`;
}

/** The largest overview the format allows, with every kind of block and target. */
function largest(): string {
  const parts: string[] = [
    `${HEADER}\n## tl;dr\n\nBursts now wait in a [bucket](term:bucket).\n\n`,
  ];
  let targets = 1;
  parts.push('## How it works\n\n');
  // 100 figures, each with a part: 100 targets.
  for (let n = 0; n < LIMITS.figures; n++) {
    parts.push(
      `:::figure figures/f${n}.svg\nFigure ${n}: a request on its way through.\n\n- [box${n}](code:src/f${n}.ts#L1-L9)\n:::\n\n`,
    );
    targets += 1;
  }
  // 10 walkthroughs of 5 steps, and 50 code blocks: 100 targets.
  for (let w = 0; w < 10; w++) {
    parts.push(`:::walkthrough Walk ${w}\n`);
    for (let s = 0; s < 5; s++) {
      parts.push(
        `:::step src/w${w}.ts#L${s * 40 + 1}-L${s * 40 + 40}\nStep ${s} reads its lines.\n:::\n`,
      );
    }
    parts.push(':::\n\n');
    for (let c = 0; c < 5; c++)
      parts.push(`:::code src/c${w}.ts#L${c * 200 + 1}-L${c * 200 + 200}\n:::\n\n`);
    targets += 10;
  }
  parts.push(':::tabs\n:::tab Before\nIt failed.\n:::\n:::tab After\nIt waits.\n:::\n:::\n\n');
  parts.push(':::fold More\nThe rest.\n:::\n\n');
  // The rest are links: to code, to terms and to sections.
  parts.push('## Where to look\n\n');
  for (let n = 0; targets < LIMITS.targets; n++) {
    const kind = n % 3;
    if (kind === 0) parts.push(`See [line ${n}](code:src/l${n}.ts#L${n + 1}). `);
    else if (kind === 1) parts.push(`A [bucket](term:bucket) again. `);
    else parts.push(`As [above](#how-it-works). `);
    if (n % 10 === 9) parts.push('\n\n');
    targets += 1;
  }
  parts.push('\n\n## How it was checked\n\n');
  const glossary = '## Glossary\n\n- **Bucket**: the tokens a tenant has to spend.\n';
  let text = parts.join('');
  const room = (): number =>
    LIMITS.size - new TextEncoder().encode(text).length - glossary.length - 2_000;
  for (let n = 0; room() > 0; n++) text += filler(n);
  return text + glossary;
}

test('the largest overview the format allows is read within budget', () => {
  const text = largest();
  const size = new TextEncoder().encode(text).length;
  expect(size).toBeLessThanOrEqual(LIMITS.size);
  expect(size).toBeGreaterThan(LIMITS.size - 4_000);
  const { made, elapsed } = timed(() => parseArtifact(text));
  expect(made.findings).toEqual([]);
  expect(made.figures).toHaveLength(LIMITS.figures);
  const walked = walk(made.tree, { counts: true });
  expect(walked.problems).toEqual([]);
  expect(walked.targets).toBe(LIMITS.targets);
  expect(problems(made.tree)).toEqual([]);
  expect(elapsed, `took ${elapsed} ms for ${size} bytes`).toBeLessThan(LIMIT);
});
