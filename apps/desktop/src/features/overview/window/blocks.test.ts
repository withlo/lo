import { describe, expect, it, vi } from 'vitest';

import { parseArtifact, type OverviewBlock, type Walkthrough } from '@lo/artifact';

import { blockId, blockIn, codeOf, onHead, onStep, setStep, stepOf } from './blocks.ts';

const COMMIT = 'c'.repeat(40);

const { tree } = parseArtifact(
  [
    `---\nformat: 1\npr: 1\ncommit: ${COMMIT}\n---\n`,
    '## tl;dr\n',
    'A [term](term:bucket), then [the parser](code:src/parse.ts#L3-L5) and [the rest](code:src/rest.ts).\n',
    ':::code src/a.ts#L2-L4',
    ':::\n',
    ':::walkthrough Through it',
    ':::step src/a.ts#L2-L3',
    'First.',
    ':::',
    ':::step src/b.ts#L7',
    'Second.',
    ':::',
    ':::\n',
    ':::fold Why',
    'Because [it reads](code:src/why.ts#L1).',
    ':::\n',
    'Only [the rest](code:src/rest.ts).\n',
    'Words with no code, and [a page](https://example.com).\n',
    '## Glossary\n',
    '- **Bucket**: what a tenant spends.',
    '',
  ].join('\n'),
);

function first<K extends OverviewBlock['kind']>(kind: K): Extract<OverviewBlock, { kind: K }> {
  const found = tree.blocks.find((block): block is Extract<OverviewBlock, { kind: K }> =>
    isKind(block, kind),
  );
  if (!found) throw new Error(`No ${kind} block.`);
  return found;
}

function isKind<K extends OverviewBlock['kind']>(
  block: OverviewBlock,
  kind: K,
): block is Extract<OverviewBlock, { kind: K }> {
  return block.kind === kind;
}

describe('a block’s id', () => {
  it('names its place in one tree, and no block of another', () => {
    expect(blockId(3, 7)).toBe('3.7');
    expect(blockIn(blockId(3, 7), 3)).toBe(7);
    expect(blockIn(blockId(3, 7), 4)).toBeUndefined();
    expect(blockIn('src/a.ts', 3)).toBeUndefined();
    expect(blockIn('3.', 3)).toBeUndefined();
  });
});

describe('the code a block points at', () => {
  it('is a code block’s lines', () => {
    expect(codeOf(first('excerpt'))).toEqual({ path: 'src/a.ts', lines: { start: 2, end: 4 } });
  });

  it('is the first link to code in prose, in the order written, a whole file’s without lines', () => {
    const [paragraph, whole] = tree.blocks.filter((block) => block.kind === 'paragraph');
    expect(paragraph && codeOf(paragraph)).toEqual({
      path: 'src/parse.ts',
      lines: { start: 3, end: 5 },
    });
    expect(whole && codeOf(whole)).toEqual({ path: 'src/rest.ts' });
    expect(codeOf(first('details'))).toEqual({ path: 'src/why.ts', lines: { start: 1, end: 1 } });
  });

  it('is none for prose without a link to code, or a heading', () => {
    const last = tree.blocks.filter((block) => block.kind === 'paragraph').at(-1);
    expect(last && codeOf(last)).toBeUndefined();
    expect(codeOf(first('heading'))).toBeUndefined();
  });

  it('is the step a walkthrough shows, which the reader moves, telling those listening', () => {
    const walk: Walkthrough = first('walkthrough');
    expect(stepOf(walk)).toBe(0);
    expect(codeOf(walk)).toEqual({ path: 'src/a.ts', lines: { start: 2, end: 3 } });
    const heard = vi.fn<() => void>();
    const stop = onStep(heard);
    setStep(walk, 1);
    expect(heard).toHaveBeenCalledOnce();
    expect(codeOf(walk)).toEqual({ path: 'src/b.ts', lines: { start: 7, end: 7 } });
    // The same step again changes nothing.
    setStep(walk, 1);
    expect(heard).toHaveBeenCalledOnce();
    // Past its last step, it shows its last.
    setStep(walk, 9);
    expect(stepOf(walk)).toBe(1);
    stop();
    setStep(walk, 0);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('code at the head the diff shows', () => {
  it('is the overview’s own lines, its first line followed and every line picked out', () => {
    expect(onHead({ path: 'src/a.ts', lines: { start: 2, end: 4 } })).toEqual({
      path: 'src/a.ts',
      line: 2,
      lines: { from: 2, to: 4 },
    });
    expect(onHead({ path: 'src/rest.ts' })).toEqual({
      path: 'src/rest.ts',
      line: undefined,
      lines: undefined,
    });
  });
});
