// Cutting what an overview says short for a note: whole while it fits; else at a word, with an
// ellipsis, no longer in words than the limit, its emphasis and code kept; a block that can't be
// cut part way whole or not at all; the overview's own blocks left out.

import type { OverviewBlock } from '@lo/artifact';
import { plainText } from '@lo/markdown';
import { describe, expect, it } from 'vitest';

import { cutBlocks } from './cut.ts';

function words(blocks: readonly OverviewBlock[]): string {
  return plainText({ blocks: [...blocks], notes: [], diagnostics: [] });
}

const SENTENCE = 'A query over the plan’s ceiling is refused before it touches the bucket.';

/** A list's item of one paragraph, of `value`. */
function item(value: string) {
  return {
    children: [{ kind: 'paragraph' as const, children: [{ kind: 'text' as const, value }] }],
  };
}

describe('cutBlocks', () => {
  it('keeps what fits as it is', () => {
    const blocks: OverviewBlock[] = [
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', value: 'Reads ' },
          { kind: 'inlineCode', value: 'cost.ts' },
          { kind: 'text', value: ' first.' },
        ],
      },
    ];
    expect(cutBlocks(blocks, 600)).toEqual(blocks);
  });

  it('cuts at a word, with an ellipsis, within the limit, keeping its emphasis', () => {
    const blocks: OverviewBlock[] = [
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', value: 'Every   query ' },
          { kind: 'emphasis', children: [{ kind: 'text', value: SENTENCE }] },
          { kind: 'inlineCode', value: 'refuse()' },
        ],
      },
      { kind: 'paragraph', children: [{ kind: 'text', value: 'Never shown.' }] },
    ];
    const cut = cutBlocks(blocks, 40);
    expect(words(cut)).toBe('Every query A query over the plan’s…');
    expect(words(cut).length).toBeLessThanOrEqual(40);
    expect(cut).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', value: 'Every   query ' },
          { kind: 'emphasis', children: [{ kind: 'text', value: 'A query over the plan’s…' }] },
        ],
      },
    ]);
  });

  it('cuts within a word rather than leave less than half the words', () => {
    const cut = cutBlocks(
      [{ kind: 'paragraph', children: [{ kind: 'text', value: `a ${'b'.repeat(50)}` }] }],
      20,
    );
    expect(words(cut)).toBe(`a ${'b'.repeat(17)}…`);
  });

  it('cuts a list between its items, and code in it as written', () => {
    const cut = cutBlocks(
      [
        {
          kind: 'list',
          ordered: true,
          start: 1,
          tight: true,
          items: [item('One.'), item('Two.'), item(SENTENCE)],
        },
        { kind: 'code', text: 'never()' },
      ],
      24,
    );
    expect(cut).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 1,
        tight: true,
        items: [item('One.'), item('Two.'), item('A query over…')],
      },
    ]);
    const code = cutBlocks([{ kind: 'code', text: 'const a =\n    b + c;' }], 12);
    expect(code).toEqual([{ kind: 'code', text: 'const a =…' }]);
  });

  it('keeps a table whole or not at all, and leaves out the overview’s own blocks', () => {
    const table: OverviewBlock = {
      kind: 'table',
      align: ['none'],
      head: [[{ kind: 'text', value: 'Limit' }]],
      rows: [[[{ kind: 'text', value: SENTENCE }]]],
    };
    const figure: OverviewBlock = {
      kind: 'figure',
      path: 'figures/flow.svg',
      caption: [{ kind: 'paragraph', children: [{ kind: 'text', value: 'The flow.' }] }],
      parts: [],
    };
    const first: OverviewBlock = { kind: 'paragraph', children: [{ kind: 'text', value: 'See:' }] };
    expect(cutBlocks([first, figure, table], 600)).toEqual([first, table]);
    expect(cutBlocks([first, table], 30)).toEqual([
      first,
      { kind: 'paragraph', children: [{ kind: 'text', value: '…' }] },
    ]);
  });
});
