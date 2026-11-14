// What an overview says of the lines it points at, for the diff's markers: code blocks with the
// prose around them, walkthrough steps, figure parts, and links to lines in prose, lists, tables,
// tabs, folds and the glossary, each under its section, as plain text; and the ids that bring the
// reader back to each.

import { parseArtifact, type OverviewBlock } from '@lo/artifact';
import { plainText } from '@lo/markdown';
import { describe, expect, it } from 'vitest';

import { explainedId, explanationsOf, NOTE_LIMIT, readExplainedId } from './explained.ts';

const HEADER = '---\nformat: 1\npr: 80\ncommit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87\n---\n';

/** The tree of an overview whose text, after its header, is `body`, whatever the check finds. */
function treeOf(body: string) {
  return parseArtifact(`${HEADER}${body}`).tree;
}

/** The words of `blocks`, as the plain text has them. */
function words(blocks: readonly OverviewBlock[]): string {
  return plainText({ blocks: [...blocks], notes: [], diagnostics: [] });
}

/** What each explanation points at and says, in short. */
function said(body: string): string[] {
  return explanationsOf(treeOf(body)).map(
    ({ block, step, target, section, text }) =>
      `${block}${step === undefined ? '' : `.${step}`} ${target.path}#${target.lines.start}-${target.lines.end} [${section}] ${text}`,
  );
}

describe('explanationsOf', () => {
  it('says each code block with the prose before it, or after it, in its section', () => {
    expect(
      said(`## tl;dr

Lines split on either ending.

## How it works

[The parser](code:src/parser.ts) now splits on either line ending:

:::code src/parser.ts#L7-L10
:::

:::code src/format.ts#L1-L3
:::

## Where to look

:::code src/format.ts#L5-L8
:::

How a **line** is written out hasn't changed.

## Alone

:::code README.md#L1-L4
:::
`),
    ).toEqual([
      // The link names a whole file, which marks nothing.
      '4 src/parser.ts#7-10 [How it works] The parser now splits on either line ending:',
      '5 src/format.ts#1-3 [How it works] The parser now splits on either line ending:',
      "7 src/format.ts#5-8 [Where to look] How a line is written out hasn't changed.",
      '10 README.md#1-4 [Alone] A code block in the overview shows these lines.',
    ]);
  });

  it('says each walkthrough step with its own words, and a link in one with them too', () => {
    expect(
      said(`## How it works

:::walkthrough From input to text
:::step src/parser.ts#L8-L10
\`parse\` splits the input, up to [the limit](code:src/config.ts#L3).
:::
:::step src/format.ts#L6-L8
\`format\` writes each line after its number.
:::
:::
`),
    ).toEqual([
      '1.0 src/parser.ts#8-10 [How it works] parse splits the input, up to the limit.',
      '1.1 src/format.ts#6-8 [How it works] format writes each line after its number.',
      '1.0 src/config.ts#3-3 [How it works] parse splits the input, up to the limit.',
    ]);
  });

  it('says a figure’s parts with its caption, and links in lists, tables, tabs, folds and the glossary with what holds them', () => {
    expect(
      said(`## How it works

:::figure figures/flow.svg
Input goes through parse, then format.

- [parse](code:src/parser.ts#L8-L10)
- [lines](term:line)
:::

- First, [the split](code:src/parser.ts#L9).
- Then [the format](code:src/format.ts#L7).

| File | What |
| --- | --- |
| [parser](code:src/parser.ts#L1-L5) | Splits lines |

:::tabs
:::tab Before
\`wrap\` sat in [format](code:src/format.ts#L10-L20).
:::
:::tab After
It moved.
:::
:::

:::fold Why legacy goes
Nothing imports [it](code:src/legacy.ts#L1-L2).
:::

## Glossary

- **Line**: one line of input, as [parse](code:src/parser.ts#L8) makes it.
`),
    ).toEqual([
      '1 src/parser.ts#8-10 [How it works] Input goes through parse, then format.',
      '2 src/parser.ts#9-9 [How it works] First, the split.',
      '2 src/format.ts#7-7 [How it works] Then the format.',
      // A table's row, cell by cell.
      '3 src/parser.ts#1-5 [How it works] parser Splits lines',
      '4 src/format.ts#10-20 [How it works] wrap sat in format.',
      '5 src/legacy.ts#1-2 [How it works] Nothing imports it.',
      '7 src/parser.ts#8-8 [Glossary] one line of input, as parse makes it.',
    ]);
  });

  it('says what a block points at once, and cuts long words at a word', () => {
    const long = `${'word '.repeat(200)}end`;
    const found = explanationsOf(
      treeOf(`## Long

${long} [here](code:a.ts#L1) and [here again](code:a.ts#L1).
`),
    );
    expect(found).toHaveLength(1);
    const text = found[0]?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(NOTE_LIMIT + 1);
    expect(text).toMatch(/^word word .* word…$/);
    // The same words as blocks, cut short alike, for a note to draw.
    expect(words(found[0]?.content ?? [])).toBe(text);
  });

  it('keeps the blocks the words are in, to draw as the overview does', () => {
    const [step, code] = explanationsOf(
      treeOf(`## How it works

:::walkthrough Steps
:::step src/a.ts#L1-L2
Splits **each** line on \`\\n\`.
:::
:::

:::code src/b.ts#L1
:::
`),
    );
    expect(step?.content).toEqual([
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', value: 'Splits ' },
          { kind: 'strong', children: [{ kind: 'text', value: 'each' }] },
          { kind: 'text', value: ' line on ' },
          { kind: 'inlineCode', value: '\\n' },
          { kind: 'text', value: '.' },
        ],
      },
    ]);
    expect(words(code?.content ?? [])).toBe(code?.text);
    expect(code?.text).toBe('A code block in the overview shows these lines.');
  });
});

describe('explained ids', () => {
  it('name the tree, the block and the step, and read back', () => {
    expect(explainedId(3, { block: 7 })).toBe('3.7');
    expect(explainedId(3, { block: 7, step: 2 })).toBe('3.7.2');
    expect(readExplainedId('3.7')).toEqual({ tree: 3, block: 7 });
    expect(readExplainedId('3.7.2')).toEqual({ tree: 3, block: 7, step: 2 });
    for (const other of ['', '3', '3.7.2.1', 'a.b', '3.-7', ' 3.7']) {
      expect(readExplainedId(other)).toBeUndefined();
    }
  });
});
