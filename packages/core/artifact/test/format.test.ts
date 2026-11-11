/**
 * `format.md`, the format's spec, against the parse: every example in it reads clean, and every
 * limit it lists is the parse's.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_LIMITS, SVG_LIMITS } from '@lo/markdown';
import { expect, test } from 'vitest';

import { BINARY_WINDOW, FORMAT, LIMITS, MIN_STEPS, MIN_TABS, parseArtifact } from '../src/index.ts';
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

const MIB = 1024 * 1024;

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
    `${LIMITS.commit / MIB} MiB, ${LIMITS.entries} files and folders`,
    `first ${BINARY_WINDOW / 1024} KiB is a NUL byte`,
  ]) {
    expect(spec).toContain(phrase);
  }
  expect(spec).toMatch(
    new RegExp(`\\| A file a target names +\\| ${LIMITS.file / MIB} MiB of text`),
  );
  expect(spec).toMatch(
    new RegExp(`\\| The files targets name, together +\\| ${LIMITS.code / MIB} MiB `),
  );
});

test('format.md gives the limits figures are checked under', () => {
  // An SVG's limit in bytes is sanitizeSvg's in characters, which it never has more of.
  expect(LIMITS.svg).toBe(SVG_LIMITS.size);
  const row = (what: string, limit: string) =>
    expect(spec).toMatch(new RegExp(`\\| ${what} +\\| ${limit} +\\|`));
  row(
    'An image',
    `${LIMITS.image / MIB} MiB, ${number(LIMITS.side)} pixels a side, ${LIMITS.pixels / 1_000_000} MP`,
  );
  row(
    'An SVG',
    `${LIMITS.svg / 1024} KiB, ${number(SVG_LIMITS.elements)} elements, ${SVG_LIMITS.depth} deep`,
  );
  row('The SVGs figures show, together', `${LIMITS.svgs / MIB} MiB`);
  expect(LIMITS.drawn).toBe(4 * SVG_LIMITS.drawn);
  row('What SVG figures draw, together', '4 times what one SVG may draw');
  expect(spec.replace(/\s+/g, ' ')).toContain(
    `no taller than ${SVG_LIMITS.tallest} times its width or wider than ${SVG_LIMITS.widest} times its height`,
  );
});
