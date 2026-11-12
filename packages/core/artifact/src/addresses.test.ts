import { describe, expect, test } from 'vitest';

import { collect, found, overview, PREAMBLE_LINES, timed } from '../test/support.ts';
import { problems } from '../test/walker.ts';
import { LIMITS, parseArtifact, type ParsedArtifact } from './index.ts';

const LINE = PREAMBLE_LINES + 1;

/** The messages of the findings about links Markdown doesn't read. */
function messages(parsed: ParsedArtifact): string[] {
  return parsed.findings
    .filter(({ code }) => code === 'link-address')
    .map(({ message }) => message);
}

describe('a link whose address Markdown can’t read', () => {
  test.each([
    [
      'a term with a space',
      '[a wake timer](term:wake timer)',
      "[a wake timer](term:wake timer) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [a wake timer](<term:wake timer>).",
    ],
    [
      'a path with a space',
      '[the doc](code:docs/read me.md#L1-L4)',
      "[the doc](code:docs/read me.md#L1-L4) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [the doc](<code:docs/read me.md#L1-L4>).",
    ],
    [
      'a section with a space',
      '[above](#how it works)',
      "[above](#how it works) isn't a link, a space ends a link's address, so it shows as text. A heading's anchor is its text in lower case, with - for spaces: [above](#how-it-works).",
    ],
    [
      'a section with a space and capitals',
      '[above](#How it works)',
      "[above](#How it works) isn't a link, a space ends a link's address, so it shows as text. A heading's anchor is its text in lower case, with - for spaces: [above](#how-it-works).",
    ],
    [
      'a term wrapped across lines',
      '[a wake timer](term:wake\ntimer)',
      "[a wake timer](term:wake timer) isn't a link, a line break ends a link's address, so it shows as text. Write the address on one line, in angle brackets: [a wake timer](<term:wake timer>).",
    ],
    [
      'a term with a tab',
      '[a wake timer](term:wake\ttimer)',
      "[a wake timer](term:wake timer) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [a wake timer](<term:wake timer>).",
    ],
    [
      'an address with space around it',
      '[a wake timer]( term:wake timer )',
      "[a wake timer]( term:wake timer ) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [a wake timer](<term:wake timer>).",
    ],
    [
      'a term in angle brackets, wrapped',
      '[a wake timer](<term:wake\ntimer>)',
      "[a wake timer](<term:wake timer>) isn't a link, a line break ends a link's address, so it shows as text. Write the address on one line, in angle brackets: [a wake timer](<term:wake timer>).",
    ],
    [
      'a label with emphasis',
      '[a **wake** timer](term:wake timer)',
      "[a wake timer](term:wake timer) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [text](<term:wake timer>).",
    ],
    [
      'an address with emphasis, which the fix can’t know',
      '[a timer](term:wake *timer* now)',
      "[a timer](term:wake… isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets, such as [a timer](<term:two words>).",
    ],
    [
      'a path with an open parenthesis',
      '[the limiter](code:src/limiter(1.ts)',
      "[the limiter](code:src/limiter(1.ts)… isn't a link, Markdown can't read its address, so it shows as text. Put the address in angle brackets, such as [the limiter](<code:docs/read me.md>).",
    ],
  ])('%s is an error, at its line, with how to write it', (_name, link, message) => {
    const parsed = parseArtifact(overview(`A ${link}\n`));
    expect(found(parsed)).toEqual([`link-address@${LINE}`]);
    expect(messages(parsed)).toEqual([message]);
    expect(parsed.findings[0]?.severity).toBe('error');
    expect(collect(parsed, 'link')).toEqual([]);
    expect(problems(parsed.tree)).toEqual([]);
  });

  test('the fix is a link Markdown reads, to the target the author meant', () => {
    const parsed = parseArtifact(
      overview(
        '[a](<term:wake timer>), [b](<code:docs/read me.md#L1>) and [c](#how-it-works).\n\n## How it works\n\nIt waits.\n\n## Glossary\n\n- **Wake timer**: a timer.\n',
      ),
    );
    expect(found(parsed)).toEqual([]);
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'term', key: 'wake timer' },
      { kind: 'code', path: 'docs/read me.md', lines: { start: 1, end: 1 } },
      { kind: 'anchor', name: 'how-it-works' },
    ]);
  });

  test('each is reported at the line its link starts on, in lists, quotes and tables too', () => {
    const parsed = parseArtifact(
      overview(
        [
          'First [one](term:a b),',
          'then [the second,',
          'wrapped](term:c d).',
          '',
          '- [in a list](#e f)',
          '',
          '> [in a quote](code:g h.ts)',
          '',
          '| A | B |',
          '|---|---|',
          '| [in a cell](term:i j) | x |',
          '',
          '### A [heading](term:k l)',
          '',
          'A `code` and <b>html</b> before [it](term:m n).',
          '',
        ].join('\n'),
      ),
    );
    expect(found(parsed).filter((each) => each.startsWith('link-address'))).toEqual(
      [0, 1, 4, 6, 10, 12, 14].map((n) => `link-address@${LINE + n}`),
    );
  });

  test('a link inside a glossary definition, a step, a tab and a caption is found too', () => {
    const parsed = parseArtifact(
      overview(
        [
          ':::figure figures/a.svg',
          'A [caption](term:a b).',
          ':::',
          '',
          ':::tabs',
          ':::tab One',
          'A [tab](#c d).',
          ':::',
          ':::tab Two',
          'Plain.',
          ':::',
          ':::',
          '',
          ':::walkthrough Steps',
          ':::step src/a.ts#L1',
          'A [step](code:e f.ts).',
          ':::',
          ':::step src/a.ts#L2',
          'Two.',
          ':::',
          ':::step src/a.ts#L3',
          'Three.',
          ':::',
          ':::',
          '',
          '## Glossary',
          '',
          '- **Term**: see [this](term:g h).',
          '',
        ].join('\n'),
      ),
    );
    const lines = parsed.findings
      .filter(({ code }) => code === 'link-address')
      .map(({ line }) => line);
    expect(lines).toEqual([LINE + 1, LINE + 6, LINE + 15, LINE + 27]);
  });

  test('a link in a figure’s list of parts is reported as well as the list', () => {
    const parsed = parseArtifact(
      overview(':::figure figures/a.svg\nA box.\n\n- [box](code:src/a b.ts)\n:::\n'),
    );
    expect(found(parsed)).toEqual([`link-address@${LINE + 3}`, `figure-part@${LINE + 3}`]);
  });

  test('a path that a fuzzy link would take for a web address is read whole', () => {
    // `me.md` looks like an address to Markdown's autolinks, which would cut the path in two.
    const parsed = parseArtifact(overview('A [doc](code:docs/read me.md#L1) here.\n'));
    expect(messages(parsed)).toEqual([
      "[doc](code:docs/read me.md#L1) isn't a link, a space ends a link's address, so it shows as text. Put the address in angle brackets: [doc](<code:docs/read me.md#L1>).",
    ]);
  });

  test('a long label or address is cut in what’s shown, and an address too long to repeat isn’t', () => {
    const label = 'long '.repeat(30);
    const path = `docs/${'folder '.repeat(40)}read me.md`;
    const parsed = parseArtifact(overview(`[${label}](code:${path})\n`));
    expect(messages(parsed)).toHaveLength(1);
    const [message] = messages(parsed);
    expect(message).toMatch(/^\[long long long .*… isn't a link, a space ends/);
    expect(message).toMatch(
      /Put the address in angle brackets, such as \[text\]\(<code:docs\/read me\.md>\)\.$/,
    );
  });

  test('what’s quoted in a message is never a control or invisible character', () => {
    const parsed = parseArtifact(
      overview('[a\u202E\x1b](term:b\u200B c\x07)\n\n[d](code:e\x1b[2J)\n'),
    );
    expect(messages(parsed)).toHaveLength(2);
    for (const message of messages(parsed)) {
      expect(message).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u);
    }
  });
});

describe('what is not a link whose address Markdown can’t read', () => {
  const GLOSSARY = '\n## Glossary\n\n- **Wake timer**: a timer.\n- **Wake-timer**: another.\n';

  test.each([
    ['a link in angle brackets', '[a](<term:wake timer>)'],
    ['a term with no space', '[a](term:wake-timer)'],
    ['a path with no space', '[a](code:src/limiter.ts#L1-L2)'],
    ['a path with balanced parentheses', '[a](code:src/limiter(1).ts)'],
    ['a section', '[a](#how-it-works)'],
    ['a link with a title', '[a](term:wake-timer "the timer")'],
    ['a link with space inside the brackets', '[a]( term:wake-timer )'],
    ['a link across lines', '[a\nlabel](term:wake-timer)'],
  ])('%s is a link', (_name, link) => {
    const parsed = parseArtifact(overview(`${link}\n\n## How it works\n\nIt waits.\n${GLOSSARY}`));
    expect(messages(parsed)).toEqual([]);
    expect(collect(parsed, 'link')).toHaveLength(1);
  });

  test.each([
    ['inline code', '`[a](term:wake timer)`'],
    ['a fenced code block', '```text\n[a](term:wake timer)\n```'],
    ['an indented code block', '    [a](term:wake timer)'],
    ['escaped brackets', '\\[a\\](term:wake timer)'],
    ['an escaped bracket', '[a\\](term:wake timer)'],
    ['an entity for a bracket', '[a&#93;(term:wake timer)'],
    ['an image', '![a](term:wake timer)'],
    ['raw HTML', '<span title="[a](term:wake timer)">x</span>'],
    ['a label with no link', 'The array [a] (term:wake timer) and a (term:wake timer).'],
    ['a web page', '[a](https://example.com/a b)'],
    ['a relative path', '[a](src/a b.ts)'],
    ['another scheme', '[a](Term:wake timer)'],
    ['a reference link', '[a][b]\n\n[b]: term:wake-timer'],
  ])('%s is left to Markdown', (_name, text) => {
    const parsed = parseArtifact(overview(`${text}\n${GLOSSARY}`));
    expect(messages(parsed)).toEqual([]);
  });

  test('a link Markdown reads, inside the label of one it can’t, is a link', () => {
    const parsed = parseArtifact(
      overview(`[an [inner](term:wake-timer) label](code:src/limiter.ts)\n${GLOSSARY}`),
    );
    expect(messages(parsed)).toEqual([]);
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'term', key: 'wake-timer' },
    ]);
  });
});

describe('many links Markdown can’t read', () => {
  test('at most as many findings as are kept, however many there are', () => {
    const parsed = parseArtifact(overview('[a](term:b c) '.repeat(1_000)));
    expect(messages(parsed)).toHaveLength(LIMITS.findings);
  });

  test.each([
    ['openers with no address', '[](#'],
    ['openers and parentheses', '[](#('],
    ['openers in angle brackets', '[](<#'],
    ['addresses that start the next', '[](code:'],
    ['labels that never close', '[a](code:b '],
  ])('%s are read in time', (_name, unit) => {
    const text = overview(unit.repeat(Math.floor(200_000 / unit.length)));
    const { elapsed } = timed(() => parseArtifact(text));
    expect(elapsed, `took ${elapsed} ms`).toBeLessThan(1_000);
  });
});
