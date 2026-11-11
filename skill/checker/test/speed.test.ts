/**
 * The built checker checks the largest overview the format allows within budget: `artifact.md` at
 * its size limit, pointing 500 times, with 100 figures, its code read from a repository.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, test } from 'vitest';

import { LIMITS } from '@lo/artifact';

import { header, repositoryOf, runChecker, scratch } from './support.ts';

/**
 * How long it may take, in milliseconds, starting Node and git included: more than three times the
 * slowest run on a Linux CI runner, which runs test files side by side (160 ms on a laptop).
 */
const LIMIT = 3_000;

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('speed');
});

afterAll(() => root.remove());

/** `count` lines of code. */
function lines(count: number): string {
  return Array.from({ length: count }, (_, n) => `export const line${n} = ${n};\n`).join('');
}

/** Prose that points nowhere, about 1 KB of it, as long overviews hold. */
function filler(n: number): string {
  return `### Detail ${n}

The *cache* keeps each tenant's \`bucket\` in memory, so a request reads it without a round trip.
When the process restarts, the buckets start full, which lets a burst through once; that's
accepted, since **restarts are rare** and the quota still holds over a minute.

- Reads take the lock only to refill.
- Writes rarely wait: the refill is one comparison.

| Case | Before | After |
|:-----|-------:|:-----:|
| cold | 120 ms | 40 ms |

`;
}

test('the largest overview the format allows is checked within budget', () => {
  // The code: a file for each figure's part, and files of 1,000 lines for blocks and steps.
  const code: Record<string, string> = {};
  for (let n = 0; n < LIMITS.figures; n++) code[`src/f${n}.ts`] = lines(10);
  for (let n = 0; n < 10; n++) code[`src/w${n}.ts`] = lines(1_000);
  for (let n = 0; n < 300; n++) code[`src/l${n}.ts`] = lines(n + 1);
  const repo = join(root.dir, 'repo');
  mkdirSync(repo);
  const commit = repositoryOf(repo, code);

  const dir = join(root.dir, 'overview');
  mkdirSync(join(dir, 'figures'), { recursive: true });
  const parts: string[] = [
    `${header(commit)}\n## tl;dr\n\nBursts now wait in a [bucket](term:bucket).\n\n`,
  ];
  let targets = 1;
  parts.push('## How it works\n\n');
  for (let n = 0; n < LIMITS.figures; n++) {
    writeFileSync(
      join(dir, `figures/f${n}.svg`),
      `<svg viewBox="0 0 860 320"><g id="box${n}"><rect x="10" y="10" width="200" height="80" rx="6" fill="var(--fig-panel)" stroke="var(--fig-line)"/><text x="24" y="54" fill="var(--fig-ink)">Step ${n}</text></g><path d="M210 50h120" stroke="var(--fig-muted)"/></svg>\n`,
    );
    parts.push(
      `:::figure figures/f${n}.svg\nFigure ${n}: a request on its way.\n\n- [box${n}](code:src/f${n}.ts#L1-L9)\n:::\n\n`,
    );
    targets += 1;
  }
  for (let w = 0; w < 10; w++) {
    parts.push(`:::walkthrough Walk ${w}\n`);
    for (let s = 0; s < 5; s++) {
      parts.push(
        `:::step src/w${w}.ts#L${s * 40 + 1}-L${s * 40 + 40}\nStep ${s} reads its lines.\n:::\n`,
      );
    }
    parts.push(':::\n\n');
    for (let c = 0; c < 5; c++)
      parts.push(`:::code src/w${w}.ts#L${c * 200 + 1}-L${c * 200 + 200}\n:::\n\n`);
    targets += 10;
  }
  parts.push('## Where to look\n\n');
  for (let n = 0; targets < LIMITS.targets; n++) {
    const kind = n % 3;
    if (kind === 0) parts.push(`See [line ${n}](code:src/l${n % 300}.ts#L${(n % 300) + 1}). `);
    else if (kind === 1) parts.push('A [bucket](term:bucket) again. ');
    else parts.push('As [above](#how-it-works). ');
    if (n % 10 === 9) parts.push('\n\n');
    targets += 1;
  }
  parts.push('\n\n## How it was checked\n\n');
  const glossary = '## Glossary\n\n- **Bucket**: the tokens a tenant has to spend.\n';
  let text = parts.join('');
  const room = (): number => LIMITS.size - Buffer.byteLength(text) - glossary.length - 1_500;
  for (let n = 0; room() > 0; n++) text += filler(n);
  text += glossary;
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LIMITS.size);
  expect(Buffer.byteLength(text)).toBeGreaterThan(LIMITS.size - 3_000);
  writeFileSync(join(dir, 'artifact.md'), text);

  const started = performance.now();
  const ran = runChecker(['check', dir, '--pr', '4797'], repo);
  const elapsed = performance.now() - started;
  expect(ran).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
  expect(elapsed, `took ${Math.round(elapsed)} ms`).toBeLessThan(LIMIT);
});
