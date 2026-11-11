/**
 * `format.md`, the format's spec, against the parse: every example in it reads clean, and every
 * limit it lists is the parse's.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_LIMITS } from '@lo/markdown';
import { expect, test } from 'vitest';

import { FORMAT, LIMITS, MIN_STEPS, MIN_TABS, parseArtifact } from '../src/index.ts';
import { HEADER } from './support.ts';
import { problems } from './walker.ts';

const spec = readFileSync(new URL('../format.md', import.meta.url), 'utf8');

/** The examples: every block fenced as text. */
const examples = [...spec.matchAll(/^```text\n([\s\S]*?)^```$/gm)].map((match) => match[1]!);

test('format.md has a complete example, and more', () => {
  expect(examples.length).toBeGreaterThan(5);
  expect(examples[0]).toMatch(/^---\nformat: 1\n/);
});

test.each(examples.map((example, n) => [n + 1, example]))(
  'example %i reads clean',
  (_n, example) => {
    // An example that isn't a whole overview is shown inside one.
    const text = example.startsWith('---\n')
      ? example
      : `${HEADER}\n## tl;dr\n\nAn example.\n\n${example}`;
    const parsed = parseArtifact(text);
    expect(parsed.findings).toEqual([]);
    expect(problems(parsed.tree, { counts: true })).toEqual([]);
  },
);

/** `value` as format.md writes it. */
function number(value: number): string {
  return value.toLocaleString('en-US');
}

test('format.md gives the limits the parse keeps', () => {
  expect(spec).toContain(`This is format ${FORMAT}.`);
  for (const phrase of [
    `${LIMITS.size / 1024} KiB of UTF-8`,
    `${number(LIMITS.nodes)} pieces, nested ${LIMITS.depth} deep`,
    `| Targets                                | ${LIMITS.targets}`,
    `| Blocks inside blocks                   | ${LIMITS.nesting} deep`,
    `${number(LIMITS.argument)} bytes`,
    `| A code block's or a step's lines       | ${LIMITS.lines}`,
    `| Figures                                | ${LIMITS.figures}`,
    `${LIMITS.steps}, and at least ${MIN_STEPS}`,
    `${LIMITS.tabs}, and at least ${MIN_TABS}`,
    // The parse leaves Markdown's limit on addresses as it is.
    `${number(DEFAULT_LIMITS.addresses)} characters of addresses`,
  ]) {
    expect(spec).toContain(phrase);
  }
});
