import { describe, expect, test } from 'vitest';

import { collect, found, HEADER, overview, PREAMBLE_LINES } from '../test/support.ts';
import { problems } from '../test/walker.ts';
import { parseArtifact, type ParsedArtifact } from './index.ts';

const LINE = PREAMBLE_LINES + 1;

/** `lines` after the header alone, parsed: they start on line 6. */
function headed(...lines: string[]): ParsedArtifact {
  return parseArtifact(`${HEADER}${lines.join('\n')}\n`);
}

function parse(...lines: string[]): ParsedArtifact {
  return parseArtifact(overview(`${lines.join('\n')}\n`));
}

describe('sections', () => {
  test('start with a tl;dr holding text, then come in any order', () => {
    const parsed = headed(
      '## TL;DR',
      'Short.',
      '## Where to look',
      'Here.',
      '## How it works',
      'So.',
    );
    expect(parsed.findings).toEqual([]);
    expect(collect(parsed, 'heading').map(({ anchor }) => anchor)).toEqual([
      'tldr',
      'where-to-look',
      'how-it-works',
    ]);
  });

  test('nothing comes before the tl;dr', () => {
    expect(found(headed('Hello.', '', '## tl;dr', 'Short.'))).toEqual(['tldr-first@6']);
    expect(found(headed('## How it works', 'So.', '## tl;dr', 'Short.'))).toEqual(['tldr-first@6']);
    expect(found(headed(':::fold F', 'A.', ':::', '## tl;dr', 'Short.'))).toEqual(['tldr-first@6']);
    // Reported once.
    expect(found(headed('A.', '', 'B.', '', '## Other', 'C.'))).toEqual(['tldr-first@6']);
  });

  test('an overview without a tl;dr is invalid', () => {
    expect(found(headed())).toEqual(['tldr-first']);
    expect(found(headed('## How it works', 'So.'))).toEqual(['tldr-first@6']);
  });

  test('the tl;dr has text', () => {
    expect(found(headed('## tl;dr', '', '## Next', 'Text.'))).toEqual(['tldr-empty@6']);
    expect(found(headed('## tl;dr', ':::code a.ts#L1', ':::'))).toEqual(['tldr-empty@6']);
    expect(found(headed('## tl;dr', '### Only a heading'))).toEqual(['tldr-empty@6']);
    // Text in a list or a block counts.
    expect(headed('## tl;dr', '- It does this.').findings).toEqual([]);
  });

  test('the tl;dr and the glossary are each written once', () => {
    expect(found(parse('## TL;DR', 'Again.'))).toEqual([`tldr-twice@${LINE}`]);
    expect(
      found(parse('## Glossary', '- **A**: a. [a](term:a)', '## Glossary', '- **B**: b.')),
    ).toEqual([`glossary-twice@${LINE + 2}`]);
  });

  test('no # heading, anywhere', () => {
    expect(found(parse('# A title'))).toEqual([`title-heading@${LINE}`]);
    expect(found(parse('Also a title', '==='))).toEqual([`title-heading@${LINE}`]);
    expect(found(parse(':::fold F', '# In a block', ':::'))).toEqual([`title-heading@${LINE + 1}`]);
  });

  test('footnotes are gathered at the end, in no section', () => {
    const parsed = parse(
      'Text[^1].',
      '',
      '[^1]: A note.',
      '',
      '## Glossary',
      '',
      '- **A**: a. [a](term:a)',
    );
    expect(parsed.findings).toEqual([]);
    expect(parsed.tree.blocks.at(-1)?.kind).toBe('footnotes');
  });
});

describe('the glossary', () => {
  test('is a list of terms, each bold, then a colon and its definition', () => {
    const parsed = parse(
      'A [bucket](term:bucket), a [hash map](<term:Hash map>) and [`Cache`](term:cache).',
      '',
      '## Glossary',
      '',
      '- **Bucket**: the tokens a tenant has.',
      '- **Hash  map**:',
      '  a map by hash, *fast*.',
      '- **`Cache`**: a cache.',
      '',
      '  More about it.',
    );
    expect(parsed.findings).toEqual([]);
    expect(collect(parsed, 'glossary')).toEqual([
      {
        kind: 'glossary',
        terms: [
          {
            name: 'Bucket',
            key: 'bucket',
            children: [
              {
                kind: 'paragraph',
                children: [{ kind: 'text', value: 'the tokens a tenant has.' }],
              },
            ],
          },
          {
            name: 'Hash  map',
            key: 'hash map',
            children: [
              {
                kind: 'paragraph',
                children: [
                  { kind: 'text', value: 'a map by hash, ' },
                  { kind: 'emphasis', children: [{ kind: 'text', value: 'fast' }] },
                  { kind: 'text', value: '.' },
                ],
              },
            ],
          },
          {
            name: 'Cache',
            key: 'cache',
            children: [
              { kind: 'paragraph', children: [{ kind: 'text', value: 'a cache.' }] },
              { kind: 'paragraph', children: [{ kind: 'text', value: 'More about it.' }] },
            ],
          },
        ],
      },
    ]);
    // The list is gone: the glossary replaces it.
    expect(collect(parsed, 'list')).toEqual([]);
    expect(problems(parsed.tree, { counts: true })).toEqual([]);
  });

  test('an item that isn’t **Term**: definition is invalid', () => {
    const parsed = parse(
      '## Glossary',
      '',
      '- Bucket: no bold.',
      '- **Bucket:** colon inside.',
      '- **Bucket** - a dash.',
      '- **[Bucket](https://example.com/)**: a link.',
      '- **Bucket**:',
      '- *Bucket*: emphasis.',
      '- **Fine**: fine. [fine](term:fine)',
      '- ',
    );
    expect(found(parsed)).toEqual([
      `glossary-item@${LINE + 2}`,
      `glossary-item@${LINE + 3}`,
      `glossary-item@${LINE + 4}`,
      `glossary-item@${LINE + 5}`,
      `glossary-item@${LINE + 6}`,
      `glossary-item@${LINE + 7}`,
      `glossary-item@${LINE + 9}`,
    ]);
    expect(collect(parsed, 'glossary')[0]?.terms.map(({ key }) => key)).toEqual(['fine']);
    expect(problems(parsed.tree)).toEqual([]);
  });

  test('holds one list and nothing else', () => {
    expect(found(parse('## Glossary', '', 'Some text.', '', '- **A**: a. [a](term:a)'))).toEqual([
      `glossary-content@${LINE + 2}`,
    ]);
    expect(
      found(parse('## Glossary', '', '- **A**: a. [a](term:a)', '', 'Text.', '', '- **B**: b.')),
    ).toEqual([`glossary-content@${LINE + 4}`]);
    expect(found(parse('## Glossary'))).toEqual([`glossary-content@${LINE}`]);
  });

  test('every term linked is defined, and each is defined once', () => {
    const parsed = parse(
      '[a](term:a) [b](term:b) [c](term:__proto__) [d](term:constructor)',
      '',
      '## Glossary',
      '',
      '- **A**: one.',
      '- **a**: again, in another case.',
      '- **Unused**: never linked.',
      '- **\\_\\_proto\\_\\_**: a term like any other.',
    );
    expect(found(parsed)).toEqual([
      `term-undefined@${LINE}`,
      `term-undefined@${LINE}`,
      `term-twice@${LINE + 5}`,
      `term-unused@${LINE + 6}`,
    ]);
    expect(parsed.findings.map(({ message }) => message)).toEqual([
      'The glossary doesn\'t define "b". Define it there, or don\'t link it as a term.',
      'The glossary doesn\'t define "constructor". Define it there, or don\'t link it as a term.',
      '"a" is defined twice, here and on line 15. Define each term once.',
      'Nothing links to "Unused". Link its uses with term:, or leave it out.',
    ]);
    expect(parsed.findings.map(({ severity }) => severity)).toEqual([
      'error',
      'error',
      'error',
      'warning',
    ]);
    // No object's prototype was touched along the way.
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(collect(parsed, 'glossary')[0]?.terms.map(({ key }) => key)).toEqual([
      'a',
      'unused',
      '__proto__',
    ]);
  });

  test('a figure’s part counts as a use', () => {
    const parsed = parse(
      ':::figure figures/a.svg',
      'A.',
      '',
      '- [box](term:box)',
      ':::',
      '',
      '## Glossary',
      '',
      '- **Box**: a box.',
    );
    expect(parsed.findings).toEqual([]);
  });

  test('a term with a control character is invalid', () => {
    const parsed = parse('## Glossary', '', '- **A\x1bB**: an escape.');
    expect(found(parsed)).toEqual([`glossary-item@${LINE + 2}`]);
    expect(parsed.findings[0]?.message).not.toMatch(/\p{Cc}/u);
  });
});
