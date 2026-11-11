/**
 * Each of the format's limits, tried at itself and just past it. The size, a block's lines and
 * argument, the steps, the tabs and the nesting of blocks are tried where they're read, beside
 * the rest of their rules.
 */

import { expect, test } from 'vitest';

import { LIMITS, parseArtifact } from '../src/index.ts';
import { errors, found, overview, PREAMBLE_LINES } from './support.ts';
import { walk } from './walker.ts';

const LINE = PREAMBLE_LINES + 1;

/** `count` links to code, one a line. */
function links(count: number): string {
  return Array.from({ length: count }, (_, n) => `[${n}](code:src/a.ts#L${n + 1})`).join('\n');
}

test('an overview points at most 500 times', () => {
  const at = parseArtifact(overview(`${links(LIMITS.targets)}\n`));
  expect(at.findings).toEqual([]);
  expect(at.references).toHaveLength(LIMITS.targets);
  const past = parseArtifact(overview(`${links(LIMITS.targets + 1)}\n`));
  // At the target past the limit, which isn't kept.
  expect(found(past)).toEqual([`target-count@${LINE + LIMITS.targets}`]);
  expect(past.references).toHaveLength(LIMITS.targets);
});

test('the limit is passed at the 501st target in the document, wherever blocks and links sit', () => {
  const block = ':::code a.ts#L1\n:::';
  // Blocks are read before links, but the finding is where the document passes the limit.
  const last = parseArtifact(overview(`${links(LIMITS.targets)}\n\n${block}\n`));
  expect(found(last)).toEqual([`target-count@${LINE + LIMITS.targets + 1}`]);
  const first = parseArtifact(overview(`${block}\n\n${links(LIMITS.targets)}\n`));
  expect(found(first)).toEqual([`target-count@${LINE + LIMITS.targets + 2}`]);
  for (const parsed of [last, first]) expect(parsed.references).toHaveLength(LIMITS.targets);
});

test('targets of every kind count, from blocks, steps, parts and links', () => {
  const blocks = [
    ':::code a.ts#L1',
    ':::',
    ':::walkthrough W',
    ...[1, 2, 3].flatMap((n) => [`:::step a.ts#L${n}`, 'S.', ':::']),
    ':::',
    ':::figure figures/a.svg',
    'C.',
    '',
    '- [p](#tldr)',
    '- [q](term:t)',
    ':::',
    '',
    '[s](#tldr) [t](term:t)',
    '',
    '## Glossary',
    '',
    '- **T**: t.',
  ].join('\n');
  // Eight targets: a block, three steps, two parts and two links; the rest are links to code.
  const at = parseArtifact(overview(`${links(LIMITS.targets - 8)}\n\n${blocks}\n`));
  expect(at.findings).toEqual([]);
  const past = parseArtifact(overview(`${links(LIMITS.targets - 7)}\n\n${blocks}\n`));
  expect(errors(past)).toEqual(['target-count']);
});

/** `count` figures, three lines each. */
function figures(count: number): string {
  return Array.from(
    { length: count },
    (_, n) => `:::figure figures/f${n}.svg\nFigure ${n}.\n:::`,
  ).join('\n');
}

/** `count` list items of a word each: three nodes apiece. */
function items(count: number): string {
  return '- a\n'.repeat(count);
}

/** A paragraph in `depth` quotes. */
function quotes(depth: number): string {
  return `${'> '.repeat(depth)}deep\n`;
}

test('an overview shows at most 100 figures', () => {
  const at = parseArtifact(overview(`${figures(LIMITS.figures)}\n`));
  expect(at.findings).toEqual([]);
  expect(at.figures).toHaveLength(LIMITS.figures);
  const past = parseArtifact(overview(`${figures(LIMITS.figures + 1)}\n`));
  expect(found(past)).toEqual([`figure-count@${LINE + 3 * LIMITS.figures}`]);
});

test('an overview holds at most 65,536 nodes', () => {
  const under = parseArtifact(overview(items(21_000)));
  expect(under.findings).toEqual([]);
  const { nodes } = walk(under.tree);
  expect(nodes).toBeGreaterThan(60_000);
  expect(nodes).toBeLessThanOrEqual(LIMITS.nodes);
  const over = parseArtifact(overview(items(22_000)));
  expect(errors(over)).toEqual(['too-many-nodes']);
  expect(walk(over.tree).nodes).toBeLessThanOrEqual(LIMITS.nodes);
});

test('an overview nests at most 16 deep', () => {
  const at = parseArtifact(overview(quotes(15)));
  expect(at.findings).toEqual([]);
  expect(walk(at.tree).depth).toBe(LIMITS.depth);
  const past = parseArtifact(overview(quotes(16)));
  expect(errors(past)).toEqual(['too-deep']);
  expect(walk(past.tree).depth).toBeLessThanOrEqual(LIMITS.depth);
});
