import { expect, test } from 'vitest';

import type { Paragraph } from '@lo/markdown';

import { problems } from '../test/walker.ts';
import { settle } from './map.ts';
import type { Overview } from './tree.ts';

test('a stand-in left in the tree is replaced by its contents, or by nothing', () => {
  const paragraph: Paragraph<Overview> = {
    kind: 'paragraph',
    children: [{ kind: 'text', value: 'kept' }],
  };
  const tree = settle({
    blocks: [
      {
        kind: 'lo:step',
        step: {
          target: { kind: 'code', path: 'a.ts', lines: { start: 1, end: 1 } },
          children: [paragraph],
        },
      },
      {
        kind: 'quote',
        children: [
          { kind: 'lo:tab', tab: { title: 'T', children: [paragraph] } },
          { kind: 'lo:parts', parts: [{ id: 'a', target: { kind: 'code', path: 'a.ts' } }] },
        ],
      },
      { kind: 'lo:definition', definition: { name: 'A', key: 'a', children: [paragraph] } },
      { kind: 'lo:part', part: { id: 'a', target: { kind: 'code', path: 'a.ts' } } },
    ],
    notes: [],
    diagnostics: [],
  });
  expect(tree.blocks).toEqual([paragraph, { kind: 'quote', children: [paragraph] }, paragraph]);
  expect(problems(tree)).toEqual([]);
});
