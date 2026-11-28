import { describe, expect, test } from 'vitest';

import { overview } from '../test/support.ts';
import { definitionBlocks, parseArtifact, type Definition } from './index.ts';

/** The glossary item an overview defining `bucket` as `definition` holds. */
function asOverviewHolds(definition: string): Definition {
  const parsed = parseArtifact(
    overview(`A [bucket](term:bucket).\n\n## Glossary\n\n- **Bucket**: ${definition}\n`),
  );
  const glossary = parsed.tree.blocks.find((block) => block.kind === 'glossary');
  if (glossary?.kind !== 'glossary') throw new Error('No glossary.');
  const [term] = glossary.terms;
  if (!term) throw new Error('No term.');
  return term;
}

describe("a definition as the repository's definitions hold it", () => {
  test('reads as the same definition in an overview’s glossary', () => {
    for (const definition of [
      'The tokens a tenant has.',
      'The tokens a [tenant](term:tenant) has, spent in `take()`.',
      'Kept in [the limiter](code:src/limits.ts#L12-L40) and [its tests](code:src/limits.test.ts).',
      'A [`Bucket`](term:bucket) of \\*stars\\*, &amp; more.',
      // Block syntax at its start reads as text, as it does after a glossary item's colon.
      '# Not a heading',
      '> Not a quote',
      '1. Not a list',
    ]) {
      expect({ definition, blocks: definitionBlocks(definition) }).toEqual({
        definition,
        blocks: asOverviewHolds(definition).children,
      });
    }
  });

  test('is one paragraph, its links to code and terms with their targets', () => {
    expect(
      definitionBlocks('The [tenant](term:Tenant)’s `keys`, in [cost](code:src/cost.ts#L4).'),
    ).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', value: 'The ' },
          {
            kind: 'link',
            target: { kind: 'term', key: 'tenant' },
            children: [{ kind: 'text', value: 'tenant' }],
          },
          { kind: 'text', value: '’s ' },
          { kind: 'inlineCode', value: 'keys' },
          { kind: 'text', value: ', in ' },
          {
            kind: 'link',
            target: { kind: 'code', path: 'src/cost.ts', lines: { start: 4, end: 4 } },
            children: [{ kind: 'text', value: 'cost' }],
          },
          { kind: 'text', value: '.' },
        ],
      },
    ]);
    expect(definitionBlocks('')).toEqual([]);
  });

  test('is none when it holds what the store refuses', () => {
    for (const definition of [
      'Some **bold** text.',
      'A [web link](https://example.com).',
      'See #4.',
      'A [reference][r].',
      'A tab\tinside.',
      'An image ![alt](https://example.com/a.png).',
      'A [bad path](code:/etc/passwd).',
    ]) {
      expect({ definition, blocks: definitionBlocks(definition) }).toEqual({
        definition,
        blocks: undefined,
      });
    }
  });
});
