// What a type hover's docs become before they're drawn: marks for what hides, the address after each
// link, and the list of the links a key can open.

import { describe, expect, it } from 'vitest';

import { markdownTree, type Tree } from '@lo/markdown';

import { hoverLinks, showDocs } from './hoverDocs.ts';

/** The text of the first paragraph's nodes, as `[kind, value]`. */
function nodes(tree: Tree): [string, string][] {
  const [first] = tree.blocks;
  if (first?.kind !== 'paragraph') throw new Error('Not a paragraph.');
  return first.children.map((node) => [node.kind, 'value' in node ? node.value : '']);
}

describe('showDocs', () => {
  it('follows each link and image with the address it goes to, as code', () => {
    const docs: Tree = {
      ...markdownTree(''),
      blocks: [
        {
          kind: 'paragraph',
          children: [
            {
              kind: 'link',
              target: { kind: 'web', url: 'https://example.com/limits' },
              children: [{ kind: 'text', value: 'the limits' }],
            },
            { kind: 'text', value: ' and ' },
            { kind: 'image', url: 'https://example.com/c.png', alt: 'A chart' },
          ],
        },
      ],
    };
    expect(nodes(showDocs(docs))).toEqual([
      ['link', ''],
      ['text', ' ('],
      ['inlineCode', 'https://example.com/limits'],
      ['text', ')'],
      ['text', ' and '],
      ['image', ''],
      ['text', ' ('],
      ['inlineCode', 'https://example.com/c.png'],
      ['text', ')'],
    ]);
  });

  it('says no address twice, and none for a link that goes nowhere a page is', () => {
    const docs = markdownTree(
      '<https://example.com/x> and [here](#top) and [call](javascript:alert(1))',
    );
    const kinds = nodes(showDocs(docs)).map(([kind]) => kind);
    expect(kinds).not.toContain('inlineCode');
  });

  it('shows a lookalike host as the address it is, and an http page as it is written', () => {
    const docs = markdownTree('[github.com](https://githuб.com/a) [x](http://example.com/b)');
    const shown = nodes(showDocs(docs)).filter(([kind]) => kind === 'inlineCode');
    expect(shown).toEqual([
      ['inlineCode', 'https://xn--githu-fwe.com/a'],
      ['inlineCode', 'http://example.com/b'],
    ]);
  });

  it('shows hidden characters as marks in prose, as code beside the text they were in', () => {
    const docs = markdownTree('a​b ‍c ‮d');
    expect(nodes(showDocs(docs))).toEqual([
      ['text', 'a'],
      ['inlineCode', 'U+200B'],
      ['text', 'b ‍c '],
      ['inlineCode', 'U+202E'],
      ['text', 'd'],
    ]);
  });

  it('shows them in inline code as written out, and leaves a code block for the card to mark', () => {
    const docs = markdownTree('`a​b`\n\n```\nc​d\n```');
    const shown = showDocs(docs);
    expect(nodes(shown)).toEqual([['inlineCode', 'a‹U+200B›b']]);
    expect(shown.blocks[1]).toEqual({ kind: 'code', text: 'c​d' });
  });

  it('builds a new tree, and leaves the one it was given as it was', () => {
    const docs = markdownTree('[a](https://example.com/) ​');
    const before = JSON.stringify(docs);
    const shown = showDocs(docs);
    expect(JSON.stringify(docs)).toBe(before);
    expect(shown).not.toBe(docs);
  });
});

describe('hoverLinks', () => {
  it('lists the links in the order they come, each address once, images as links to them', () => {
    const docs = markdownTree(
      [
        'See [a](https://example.com/a).',
        '| t |\n| - |\n| [b](https://example.com/b) |',
        '> [again](https://example.com/a) and [c](https://example.com/c)',
      ].join('\n\n'),
    );
    const image: Tree = {
      ...docs,
      blocks: [
        {
          kind: 'paragraph',
          children: [
            { kind: 'image', url: 'https://example.com/p.png', alt: 'pic' },
            {
              kind: 'link',
              target: { kind: 'web', url: 'https://example.com/q' },
              // An image inside a link: both are links, the outer one first.
              children: [{ kind: 'image', url: 'https://example.com/i.png', alt: '' }],
            },
          ],
        },
        ...docs.blocks,
      ],
    };
    expect(hoverLinks(image)).toEqual([
      { text: 'pic', url: 'https://example.com/p.png', image: true },
      { text: '', url: 'https://example.com/q', image: false },
      { text: 'Image', url: 'https://example.com/i.png', image: true },
      { text: 'a', url: 'https://example.com/a', image: false },
      { text: 'b', url: 'https://example.com/b', image: false },
      { text: 'c', url: 'https://example.com/c', image: false },
    ]);
  });

  it('lists only what Lo can open, with the address as a page reads it', () => {
    const docs = markdownTree(
      '[plain](http://example.com/p) [here](#top) [safe](https://EXAMPLE.com/s)',
    );
    expect(hoverLinks(docs)).toEqual([
      { text: 'safe', url: 'https://example.com/s', image: false },
    ]);
    expect(hoverLinks(markdownTree('no links here'))).toEqual([]);
  });

  it('lists a mention as the page it links to', () => {
    const docs: Tree = {
      ...markdownTree(''),
      blocks: [
        {
          kind: 'paragraph',
          children: [{ kind: 'mention', name: 'octocat', url: 'https://github.com/octocat' }],
        },
      ],
    };
    expect(hoverLinks(docs)).toEqual([
      { text: '@octocat', url: 'https://github.com/octocat', image: false },
    ]);
  });
});
