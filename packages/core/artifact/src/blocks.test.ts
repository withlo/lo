import { describe, expect, test } from 'vitest';

import { collect, found, overview, PREAMBLE_LINES, textOf } from '../test/support.ts';
import { problems } from '../test/walker.ts';
import { parseArtifact, type ParsedArtifact } from './index.ts';

const LINE = PREAMBLE_LINES + 1;

/** `lines` as an overview's body, parsed. */
function parse(...lines: string[]): ParsedArtifact {
  return parseArtifact(overview(`${lines.join('\n')}\n`));
}

/** `lines`, parsed, with no findings and a tree the walker passes in full. */
function clean(...lines: string[]): ParsedArtifact {
  const parsed = parse(...lines);
  expect(parsed.findings).toEqual([]);
  expect(problems(parsed.tree, { counts: true })).toEqual([]);
  return parsed;
}

/** The blocks after the tl;dr. */
function body(parsed: ParsedArtifact): unknown[] {
  return parsed.tree.blocks.slice(2);
}

describe('code', () => {
  test('names its lines and is empty', () => {
    const parsed = clean(':::code src/cache.ts#L46-L51', ':::');
    expect(body(parsed)).toEqual([
      {
        kind: 'excerpt',
        target: { kind: 'code', path: 'src/cache.ts', lines: { start: 46, end: 51 } },
      },
    ]);
    expect(parsed.references).toEqual([
      {
        target: { kind: 'code', path: 'src/cache.ts', lines: { start: 46, end: 51 } },
        line: LINE,
        from: 'block',
      },
    ]);
  });

  test('takes a path with spaces inside < and >, or as it is', () => {
    const parsed = clean(
      ':::code <docs/read me.md#L1-L2>',
      ':::',
      ':::code docs/read me.md#L3',
      ':::',
    );
    expect(parsed.references.map(({ target }) => target.path)).toEqual([
      'docs/read me.md',
      'docs/read me.md',
    ]);
  });

  test('more colons, and spaces after them, are the same fence', () => {
    expect(collect(clean(':::::  code src/a.ts#L1  ', '::::::::'), 'excerpt')).toHaveLength(1);
  });

  test('a block without lines, or with too many, is left out', () => {
    const parsed = parse(
      ':::code',
      ':::',
      ':::code src/a.ts',
      ':::',
      ':::code src/a.ts#L1-L201',
      ':::',
      ':::code ../a.ts#L1',
      ':::',
    );
    expect(found(parsed)).toEqual([
      `block-argument@${LINE}`,
      `target-lines@${LINE + 2}`,
      `target-lines@${LINE + 4}`,
      `target-path@${LINE + 6}`,
    ]);
    expect(body(parsed)).toEqual([]);
    expect(parsed.references).toEqual([]);
  });

  test('is empty: Lo fills it in', () => {
    const parsed = parse(':::code src/a.ts#L1-L3', 'export const a = 1;', ':::');
    expect(found(parsed)).toEqual([`block-content@${LINE + 1}`]);
  });
});

describe('figures', () => {
  test('hold a caption and a list linking their parts', () => {
    const parsed = clean(
      '## Flow',
      '',
      ':::figure figures/flow.svg',
      'A request *waits* for a token.',
      '',
      '- [bucket](code:src/bucket.ts#L1-L30)',
      '- [_limiter.2](#flow)',
      ':::',
    );
    expect(collect(parsed, 'figure')).toEqual([
      {
        kind: 'figure',
        path: 'figures/flow.svg',
        caption: [
          {
            kind: 'paragraph',
            children: [
              { kind: 'text', value: 'A request ' },
              { kind: 'emphasis', children: [{ kind: 'text', value: 'waits' }] },
              { kind: 'text', value: ' for a token.' },
            ],
          },
        ],
        parts: [
          {
            id: 'bucket',
            target: { kind: 'code', path: 'src/bucket.ts', lines: { start: 1, end: 30 } },
          },
          { id: '_limiter.2', target: { kind: 'anchor', name: 'flow' } },
        ],
      },
    ]);
    expect(parsed.figures).toEqual([{ path: 'figures/flow.svg', line: LINE + 2 }]);
  });

  test('need no parts', () => {
    const parsed = clean(':::figure figures/shot.png', 'The settings page.', ':::');
    expect(collect(parsed, 'figure')[0]?.parts).toEqual([]);
  });

  test('need a caption', () => {
    expect(found(parse(':::figure figures/a.svg', ':::'))).toEqual([`figure-caption@${LINE}`]);
    expect(found(parse(':::figure figures/a.svg', '- [a](#tldr)', ':::'))).toEqual([
      `figure-caption@${LINE}`,
    ]);
    // A heading is no caption.
    expect(found(parse(':::figure figures/a.svg', '### A', ':::'))).toEqual([
      `figure-caption@${LINE}`,
    ]);
  });

  test('a part is one link, by a plain id, to code, a term or a section, once', () => {
    const parsed = parse(
      ':::figure figures/a.svg',
      'Caption.',
      '',
      '- [a](#tldr)',
      '- not a link',
      '- [b](#tldr) and more',
      '- [**c**](#tldr)',
      '- [1d](#tldr)',
      '- [e f](#tldr)',
      '- [g](https://example.com/)',
      '- [a](#tldr)',
      `- [${'h'.repeat(65)}](#tldr)`,
      '- [i](code:../x)',
      ':::',
    );
    expect(found(parsed)).toEqual([
      `figure-part@${LINE + 4}`,
      `figure-part@${LINE + 5}`,
      `figure-part@${LINE + 6}`,
      `figure-part@${LINE + 7}`,
      `figure-part@${LINE + 8}`,
      `figure-part@${LINE + 9}`,
      `figure-part@${LINE + 10}`,
      `figure-part@${LINE + 11}`,
      `target-path@${LINE + 12}`,
    ]);
    expect(collect(parsed, 'figure')[0]?.parts.map(({ id }) => id)).toEqual(['a']);
    expect(problems(parsed.tree)).toEqual([]);
  });

  test('name a file in figures/', () => {
    const parsed = parse(
      ':::figure',
      'A.',
      ':::',
      ':::figure flow.svg',
      'A.',
      ':::',
      ':::figure figures/../artifact.md',
      'A.',
      ':::',
    );
    expect(found(parsed)).toEqual([
      `block-argument@${LINE}`,
      `figure-path@${LINE + 3}`,
      `figure-path@${LINE + 6}`,
    ]);
    // Their captions still show, as text in their place.
    expect(collect(parsed, 'figure')).toEqual([]);
    expect(textOf(body(parsed))).toBe('A.A.A.');
  });

  test('hold no blocks', () => {
    const parsed = parse(':::figure figures/a.svg', 'A.', ':::fold B', 'C', ':::', ':::');
    expect(found(parsed)).toEqual([`block-content@${LINE + 2}`]);
  });
});

/** `count` steps, on lines 1 to `count` of `src/a.ts`, three lines each. */
function steps(count: number): string[] {
  return Array.from({ length: count }, (_, n) => [
    `:::step src/a.ts#L${n + 1}`,
    `Step ${n + 1}.`,
    ':::',
  ]).flat();
}

/** `count` tabs, three lines each. */
function tabs(count: number): string[] {
  return Array.from({ length: count }, (_, n) => [
    `:::tab Tab ${n + 1}`,
    `Body ${n + 1}.`,
    ':::',
  ]).flat();
}

describe('walkthroughs', () => {
  test('hold three or more steps, each with lines and text', () => {
    const parsed = clean(':::walkthrough Reading a request', ...steps(3), ':::');
    expect(collect(parsed, 'walkthrough')).toEqual([
      {
        kind: 'walkthrough',
        title: 'Reading a request',
        steps: [1, 2, 3].map((n) => ({
          target: { kind: 'code', path: 'src/a.ts', lines: { start: n, end: n } },
          children: [{ kind: 'paragraph', children: [{ kind: 'text', value: `Step ${n}.` }] }],
        })),
      },
    ]);
    expect(parsed.references.map(({ from, line }) => `${from}@${line}`)).toEqual([
      `step@${LINE + 1}`,
      `step@${LINE + 4}`,
      `step@${LINE + 7}`,
    ]);
  });

  test('with fewer than three steps, or more than fifty, are invalid', () => {
    expect(found(parse(':::walkthrough Short', ...steps(2), ':::'))).toEqual([
      `walkthrough-steps@${LINE}`,
    ]);
    expect(found(parse(':::walkthrough Long', ...steps(51), ':::'))).toEqual([
      `walkthrough-steps@${LINE + 1 + 50 * 3}`,
    ]);
    clean(':::walkthrough Fifty', ...steps(50), ':::');
  });

  test('need a title', () => {
    expect(found(parse(':::walkthrough', ...steps(3), ':::'))).toEqual([`block-argument@${LINE}`]);
  });

  test('hold only steps', () => {
    const parsed = parse(':::walkthrough W', 'Intro.', ...steps(3), '- a list', ':::');
    expect(found(parsed)).toEqual([`block-content@${LINE + 1}`]);
    // What isn't a step is left out of it.
    expect(collect(parsed, 'walkthrough')[0]?.steps).toHaveLength(3);
  });

  test('a step needs text, and holds no blocks', () => {
    const parsed = parse(
      ':::walkthrough W',
      ':::step a.ts#L1',
      ':::',
      ':::step a.ts#L2',
      '### Only a heading',
      ':::',
      ':::step a.ts#L3',
      'Text.',
      ':::code a.ts#L4',
      ':::',
      ':::',
      ':::',
    );
    expect(found(parsed)).toEqual([
      `step-text@${LINE + 1}`,
      `step-text@${LINE + 3}`,
      `block-content@${LINE + 8}`,
    ]);
  });

  test('a walkthrough left out takes its steps with it', () => {
    const parsed = parse(`:::walkthrough ${'w'.repeat(1_025)}`, ...steps(3), ':::');
    expect(found(parsed)).toEqual([`block-argument@${LINE}`]);
    expect(collect(parsed, 'walkthrough')).toEqual([]);
    // Their text still shows, in their place.
    expect(textOf(body(parsed))).toBe('Step 1.Step 2.Step 3.');
    expect(problems(parsed.tree)).toEqual([]);
    const tabbed = parse(`:::tabs ${'t'.repeat(1_025)}`, ...tabs(2), ':::');
    expect(found(tabbed)).toEqual([`block-argument@${LINE}`]);
    expect(textOf(body(tabbed))).toBe('Body 1.Body 2.');
  });

  test('a step sits directly inside a walkthrough', () => {
    expect(found(parse(':::step a.ts#L1', 'Alone.', ':::'))).toEqual([`block-misplaced@${LINE}`]);
    const inList = parse(':::walkthrough W', '- :::step a.ts#L1', '  In a list.', '  :::', ':::');
    expect(found(inList)).toEqual([
      `walkthrough-steps@${LINE}`,
      `block-content@${LINE + 1}`,
      `block-misplaced@${LINE + 1}`,
    ]);
    expect(problems(inList.tree)).toEqual([]);
  });

  test('a step needs lines, at most 200', () => {
    const parsed = parse(
      ':::walkthrough W',
      ':::step a.ts',
      'A.',
      ':::',
      ':::step a.ts#L1-L300',
      'B.',
      ':::',
      ':::step a.ts#L1',
      'C.',
      ':::',
      ':::',
    );
    expect(found(parsed)).toEqual([`target-lines@${LINE + 1}`, `target-lines@${LINE + 4}`]);
    // Only the valid step is kept; the count is of steps written.
    expect(collect(parsed, 'walkthrough')[0]?.steps).toHaveLength(1);
  });
});

describe('tabs', () => {
  test('hold two or more titled tabs', () => {
    const parsed = clean(':::tabs', ...tabs(2), ':::');
    expect(collect(parsed, 'tabs')).toEqual([
      {
        kind: 'tabs',
        tabs: [1, 2].map((n) => ({
          title: `Tab ${n}`,
          children: [{ kind: 'paragraph', children: [{ kind: 'text', value: `Body ${n}.` }] }],
        })),
      },
    ]);
  });

  test('with fewer than two tabs, or more than twelve, are invalid', () => {
    expect(found(parse(':::tabs', ...tabs(1), ':::'))).toEqual([`tabs-tabs@${LINE}`]);
    expect(found(parse(':::tabs', ...tabs(13), ':::'))).toEqual([`tabs-tabs@${LINE + 1 + 12 * 3}`]);
    clean(':::tabs', ...tabs(12), ':::');
  });

  test('take no title, and hold only tabs, each titled', () => {
    expect(found(parse(':::tabs Mine', ...tabs(2), ':::'))).toEqual([`block-argument@${LINE}`]);
    expect(found(parse(':::tabs', 'Text.', ...tabs(2), ':::'))).toEqual([
      `block-content@${LINE + 1}`,
    ]);
    expect(found(parse(':::tabs', ':::tab', 'A.', ':::', ...tabs(1), ':::'))).toEqual([
      `block-argument@${LINE + 1}`,
    ]);
  });

  test('a tab sits directly inside tabs', () => {
    expect(found(parse(':::tab Alone', 'A.', ':::'))).toEqual([`block-misplaced@${LINE}`]);
    expect(found(parse(':::fold F', ':::tab T', 'A.', ':::', ':::'))).toEqual([
      `block-misplaced@${LINE + 1}`,
    ]);
  });
});

describe('folds', () => {
  test('are closed details with their title', () => {
    const parsed = clean(':::fold Why not a queue', 'Because.', ':::');
    expect(body(parsed)).toEqual([
      {
        kind: 'details',
        open: false,
        summary: [{ kind: 'text', value: 'Why not a queue' }],
        children: [{ kind: 'paragraph', children: [{ kind: 'text', value: 'Because.' }] }],
      },
    ]);
  });

  test('a title is plain text', () => {
    const parsed = clean(':::fold *Not* <b>emphasis</b> [or](a link)', 'A.', ':::');
    expect(collect(parsed, 'details')[0]?.summary).toEqual([
      { kind: 'text', value: '*Not* <b>emphasis</b> [or](a link)' },
    ]);
  });

  test('need a title', () => {
    expect(found(parse(':::fold', 'A.', ':::'))).toEqual([`block-argument@${LINE}`]);
  });
});

describe('fences', () => {
  test('close the innermost block open', () => {
    const parsed = clean(
      ':::tabs',
      ':::tab A',
      ':::walkthrough W',
      ':::step a.ts#L1',
      'One.',
      ':::',
      ':::step a.ts#L2',
      'Two.',
      ':::',
      ':::step a.ts#L3',
      'Three.',
      ':::',
      ':::',
      ':::',
      ':::tab B',
      'B.',
      ':::',
      ':::',
    );
    expect(collect(parsed, 'tabs')[0]?.tabs.map(({ title }) => title)).toEqual(['A', 'B']);
    expect(collect(parsed, 'walkthrough')[0]?.steps).toHaveLength(3);
  });

  test('inside a code block are code', () => {
    const parsed = clean(':::fold F', '```', ':::', ':::code a.ts#L1', '```', ':::');
    expect(collect(parsed, 'code').map(({ text }) => text)).toEqual([':::\n:::code a.ts#L1']);
  });

  test('indented as code are code', () => {
    const parsed = clean(':::fold F', 'Text.', '', '    :::', ':::');
    expect(collect(parsed, 'code').map(({ text }) => text)).toEqual([':::']);
  });

  test('end a paragraph, a list and a quote, as a fenced code block does', () => {
    const parsed = clean(
      ':::fold F',
      'Text',
      ':::',
      ':::fold G',
      '- item',
      ':::',
      ':::fold H',
      '> quote',
      ':::',
    );
    expect(
      collect(parsed, 'details').map(({ children }) => children.map(({ kind }) => kind)),
    ).toEqual([['paragraph'], ['list'], ['quote']]);
  });

  test('work in a list item, closing there', () => {
    const parsed = clean('- An item.', '', '  :::fold F', '  Inside.', '  :::', '- Another.');
    expect(collect(parsed, 'details')).toHaveLength(1);
    expect(collect(parsed, 'list')[0]?.items).toHaveLength(2);
  });

  test('a block never closes in another list item or quote than it opened in', () => {
    const parsed = parse('- :::fold F', '  Inside.', '', ':::');
    expect(found(parsed)).toEqual([`block-unclosed@${LINE}`, `block-unopened@${LINE + 3}`]);
    // Each shows as its text.
    expect(textOf(body(parsed))).toContain(':::fold F');
    expect(problems(parsed.tree)).toEqual([]);
  });

  test('an unclosed block, and a closing fence with none open, are invalid', () => {
    expect(found(parse(':::fold F', 'Never closed.'))).toEqual([`block-unclosed@${LINE}`]);
    expect(found(parse(':::'))).toEqual([`block-unopened@${LINE}`]);
    // The fence closes the tabs, which then hold none, and the fold is left open.
    expect(found(parse(':::fold F', ':::tabs', ':::'))).toEqual([
      `block-unclosed@${LINE}`,
      `tabs-tabs@${LINE + 1}`,
    ]);
  });

  test('an unknown kind is invalid, and its contents show in its place', () => {
    const parsed = parse(
      ':::chart bars',
      'Data.',
      ':::',
      ':::Code a.ts#L1',
      ':::',
      '::: {.note}',
      'N.',
      ':::',
    );
    expect(found(parsed)).toEqual([
      `block-unknown@${LINE}`,
      `block-unknown@${LINE + 3}`,
      `block-unknown@${LINE + 5}`,
    ]);
    expect(parsed.findings[0]?.message).toBe(":::chart isn't a block Lo knows.");
    expect(textOf(body(parsed))).toBe('Data.N.');
  });

  test('blocks nest at most four deep', () => {
    clean(':::fold 1', ':::fold 2', ':::fold 3', ':::fold 4', 'Deep.', ':::', ':::', ':::', ':::');
    const parsed = parse(
      ':::fold 1',
      ':::fold 2',
      ':::fold 3',
      ':::fold 4',
      ':::fold 5',
      ':::fold 6',
      'Too deep.',
      ':::',
      ':::',
      ':::',
      ':::',
      ':::',
      ':::',
    );
    // Reported once, where it first goes too deep.
    expect(found(parsed)).toEqual([`block-nesting@${LINE + 4}`]);
  });

  test('a ## heading never sits in a block', () => {
    expect(found(parse(':::fold F', '## Inside', ':::'))).toEqual([`section-in-block@${LINE + 1}`]);
    // In a list or a quote it's no section, but it's allowed.
    clean('- ## In a list', '', '> ## In a quote');
  });

  test('an argument is at most 1,024 bytes', () => {
    expect(found(parse(`:::fold ${'a'.repeat(1_024)}`, 'A.', ':::'))).toEqual([]);
    expect(found(parse(`:::fold ${'a'.repeat(1_025)}`, 'A.', ':::'))).toEqual([
      `block-argument@${LINE}`,
    ]);
  });
});
