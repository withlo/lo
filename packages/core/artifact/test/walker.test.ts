/** The walker refuses whatever the format doesn't allow, so a tree that passes it holds only that. */

import { expect, test } from 'vitest';

import { LIMITS } from '../src/index.ts';
import { problems } from './walker.ts';

function document(...blocks: unknown[]): unknown {
  return {
    blocks: [{ kind: 'heading', level: 2, anchor: 'tldr', children: [] }, ...blocks],
    notes: [],
    diagnostics: [],
  };
}

const text = (value: string): unknown => ({ kind: 'text', value });
const paragraph = (...children: unknown[]): unknown => ({ kind: 'paragraph', children });
const link = (target: unknown): unknown => paragraph({ kind: 'link', target, children: [] });
const code = (path: unknown, lines?: unknown): unknown =>
  lines === undefined ? { kind: 'code', path } : { kind: 'code', path, lines };
const excerpt = (path: unknown, start: number, end: number): unknown => ({
  kind: 'excerpt',
  target: code(path, { start, end }),
});
const glossary = (...keys: string[]): unknown => ({
  kind: 'glossary',
  terms: keys.map((key) => ({ name: key, key, children: [] })),
});
const step = (line: number): unknown => ({
  target: code('a.ts', { start: line, end: line }),
  children: [paragraph(text('s'))],
});
const walkthrough = (count: number, title = 'W'): unknown => ({
  kind: 'walkthrough',
  title,
  steps: Array.from({ length: count }, (_, n) => step(n + 1)),
});
const tabs = (count: number): unknown => ({
  kind: 'tabs',
  tabs: Array.from({ length: count }, (_, n) => ({ title: `T${n}`, children: [] })),
});
const figure = (
  path: unknown,
  parts: unknown[] = [],
  caption = [paragraph(text('c'))],
): unknown => ({
  kind: 'figure',
  path,
  caption,
  parts,
});

test('a tree of the format’s kinds passes', () => {
  const tree = document(
    excerpt('src/a.ts', 1, 200),
    figure('figures/flow.svg', [
      { id: 'a', target: code('src/a.ts') },
      { id: 'b', target: { kind: 'term', key: 'hash map' } },
      { id: 'c', target: { kind: 'anchor', name: 'tldr' } },
    ]),
    walkthrough(3),
    tabs(2),
    { kind: 'details', open: false, summary: [text('More')], children: [] },
    link(code('src/a.ts', { start: 3, end: 3 })),
    link({ kind: 'web', url: 'https://example.com/' }),
    glossary('hash map'),
  );
  expect(problems(tree, { counts: true })).toEqual([]);
});

test('anything else fails', () => {
  const cases: [string, unknown][] = [
    ['a stand-in', document({ kind: 'lo:step', step: step(1) })],
    ['an unknown kind', document({ kind: 'chart' })],
    ['an absolute path', document(excerpt('/etc/passwd', 1, 1))],
    ['a path up', document(excerpt('a/../b', 1, 1))],
    ['a path into .git', document(link(code('.git/config')))],
    ['a backslash', document(link(code('a\\b')))],
    ['a control character', document(link(code('a\x1bb')))],
    ['an empty path', document(link(code('')))],
    ['a path too long', document(link(code('a'.repeat(LIMITS.argument + 1))))],
    ['line 0', document(excerpt('a.ts', 0, 1))],
    ['lines backwards', document(excerpt('a.ts', 5, 3))],
    ['201 lines', document(excerpt('a.ts', 1, 201))],
    ['a block without lines', document({ kind: 'excerpt', target: code('a.ts') })],
    ['a fractional line', document(link(code('a.ts', { start: 1.5, end: 2 })))],
    ['an extra field on lines', document(link(code('a.ts', { start: 1, end: 1, col: 2 })))],
    ['a term not normalized', document(link({ kind: 'term', key: 'Hash  Map' }))],
    ['an empty term', document(link({ kind: 'term', key: '' }))],
    ['a figure outside figures/', document(figure('flow.svg'))],
    ['a figure in a folder', document(figure('figures/a/flow.svg'))],
    ['a figure of another type', document(figure('figures/flow.pdf'))],
    ['a figure with only an ending', document(figure('figures/.svg'))],
    ['a part with a bad id', document(figure('figures/a.svg', [{ id: '1a', target: code('a') }]))],
    [
      'a part twice',
      document(
        figure('figures/a.svg', [
          { id: 'a', target: code('a') },
          { id: 'a', target: code('b') },
        ]),
      ),
    ],
    [
      'a part to a web page',
      document(
        figure('figures/a.svg', [{ id: 'a', target: { kind: 'web', url: 'https://e.com/' } }]),
      ),
    ],
    [
      'a step without a target',
      document({ kind: 'walkthrough', title: 'W', steps: [{ children: [] }] }),
    ],
    ['a web link not normalized', document(link({ kind: 'web', url: 'HTTPS://E.COM' }))],
    ['a dangling anchor', document(link({ kind: 'anchor', name: 'nowhere' }))],
    ['a term with an extra field', document(link({ kind: 'term', key: 'a', name: 'A' }))],
    [
      'a definition with the wrong key',
      document({ kind: 'glossary', terms: [{ name: 'A', key: 'b', children: [] }] }),
    ],
    ['a definition twice', document(glossary('a', 'a'))],
    [
      'an extra field on a tab',
      document({ kind: 'tabs', tabs: [{ title: 'T', children: [], id: 'x' }] }),
    ],
  ];
  expect(cases.filter(([, tree]) => problems(tree).length === 0).map(([what]) => what)).toEqual([]);
});

test('with counts, what the format counts fails too', () => {
  const cases: [string, unknown][] = [
    ['two steps', document(walkthrough(2))],
    ['51 steps', document(walkthrough(LIMITS.steps + 1))],
    ['a walkthrough without a title', document(walkthrough(3, ''))],
    ['one tab', document(tabs(1))],
    ['13 tabs', document(tabs(LIMITS.tabs + 1))],
    [
      'a fold without a title',
      document({ kind: 'details', open: false, summary: [], children: [] }),
    ],
    ['a figure without a caption', document(figure('figures/a.svg', [], []))],
    ['an undefined term', document(link({ kind: 'term', key: 'a' }))],
    ['two glossaries', document(glossary('a'), glossary('b'))],
    ['a # heading', document({ kind: 'heading', level: 1, anchor: 'x', children: [] })],
    [
      '101 figures',
      document(...Array.from({ length: LIMITS.figures + 1 }, () => figure('figures/a.svg'))),
    ],
    [
      '501 targets',
      document(...Array.from({ length: LIMITS.targets + 1 }, () => link(code('a.ts')))),
    ],
  ];
  for (const [what, tree] of cases) {
    expect(problems(tree), what).toEqual([]);
    expect(problems(tree, { counts: true }), what).not.toEqual([]);
  }
});
