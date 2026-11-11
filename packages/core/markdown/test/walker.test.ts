/** The walker refuses whatever Lo's rules don't allow, so a tree that passes it holds only that. */

import { expect, test } from 'vitest';

import { DEFAULT_LIMITS } from '../src/index.ts';
import { problems } from './walker.ts';

function document(...blocks: unknown[]): unknown {
  return { blocks, notes: [], diagnostics: [] };
}

function paragraph(...children: unknown[]): unknown {
  return { kind: 'paragraph', children };
}

test('a tree of Lo’s kinds passes', () => {
  expect(
    problems(
      document(
        { kind: 'heading', level: 2, anchor: 'a', children: [{ kind: 'text', value: 'A' }] },
        paragraph(
          { kind: 'link', target: { kind: 'anchor', name: 'a' }, children: [] },
          { kind: 'link', target: { kind: 'web', url: 'https://e.com/' }, children: [] },
          { kind: 'image', url: 'https://camo.githubusercontent.com/a', alt: '' },
          { kind: 'mention', name: 'octocat', url: 'https://github.com/octocat' },
          { kind: 'footnoteReference', name: 'fn-1', number: 1 },
        ),
        { kind: 'footnotes', items: [{ name: 'fn-1', number: 1, children: [] }] },
      ),
    ),
  ).toEqual([]);
});

test('anything else fails', () => {
  const cases: [string, unknown][] = [
    ['an unknown kind', document({ kind: 'html', value: '<script>' })],
    ['an inline as a block', document({ kind: 'text', value: 'x' })],
    ['a block as an inline', document(paragraph({ kind: 'paragraph', children: [] }))],
    ['an extra field', document(paragraph({ kind: 'text', value: 'x', className: 'evil' }))],
    ['a missing field', document({ kind: 'heading', level: 1, children: [] })],
    [
      'a script link',
      document(
        paragraph({ kind: 'link', target: { kind: 'web', url: 'javascript:x' }, children: [] }),
      ),
    ],
    [
      'an unnormalized link',
      document(
        paragraph({ kind: 'link', target: { kind: 'web', url: 'HTTPS://E.COM' }, children: [] }),
      ),
    ],
    [
      'a link with a user',
      document(
        paragraph({ kind: 'link', target: { kind: 'web', url: 'https://a@e.com/' }, children: [] }),
      ),
    ],
    [
      'an unknown target',
      document(paragraph({ kind: 'link', target: { kind: 'file', path: '/' }, children: [] })),
    ],
    [
      'a dangling anchor',
      document(
        paragraph({ kind: 'link', target: { kind: 'anchor', name: 'nowhere' }, children: [] }),
      ),
    ],
    ['a remote image', document(paragraph({ kind: 'image', url: 'https://e.com/a.png', alt: '' }))],
    [
      'a data image',
      document(paragraph({ kind: 'image', url: 'data:image/png;base64,AA', alt: '' })),
    ],
    [
      'a mention elsewhere',
      document(paragraph({ kind: 'mention', name: 'a', url: 'https://e.com/a' })),
    ],
    [
      'a dangling reference',
      document(paragraph({ kind: 'footnoteReference', name: 'fn-9', number: 9 })),
    ],
    ['a level out of range', document({ kind: 'heading', level: 7, anchor: 'x', children: [] })],
    [
      'a repeated anchor',
      document(
        { kind: 'heading', level: 1, anchor: 'x', children: [] },
        { kind: 'heading', level: 1, anchor: 'x', children: [] },
      ),
    ],
    ['a language that is markup', document({ kind: 'code', language: '"><script>', text: '' })],
    ['an undefined field', document({ kind: 'code', language: undefined, text: '' })],
    [
      'a class instance',
      document(Object.assign(Object.create({ kind: 'rule' }), { kind: 'rule' })),
    ],
    ['a lone surrogate', document(paragraph({ kind: 'text', value: '\ud800' }))],
    ['an unknown note', { blocks: [], notes: ['why'], diagnostics: [] }],
    ['an extra key', { blocks: [], notes: [], diagnostics: [], html: '' }],
    [
      'a list item field',
      document({
        kind: 'list',
        ordered: false,
        start: 1,
        tight: true,
        items: [{ id: 'x', children: [] }],
      }),
    ],
  ];
  expect(cases.filter(([, tree]) => problems(tree).length === 0).map(([what]) => what)).toEqual([]);
});

test('the limits fail too', () => {
  let deep: unknown = { kind: 'text', value: 'x' };
  for (let i = 0; i < DEFAULT_LIMITS.depth; i++) deep = { kind: 'emphasis', children: [deep] };
  expect(problems(document(paragraph(deep)))).not.toEqual([]);
  const images = Array.from({ length: DEFAULT_LIMITS.images + 1 }, () => ({
    kind: 'image',
    url: 'https://camo.githubusercontent.com/a',
    alt: '',
  }));
  expect(problems(document(paragraph(...images)))).not.toEqual([]);
  expect(
    problems(document(paragraph({ kind: 'text', value: 'x' })), { ...DEFAULT_LIMITS, nodes: 1 }),
  ).not.toEqual([]);
});
