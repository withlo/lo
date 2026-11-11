import { expect, test } from 'vitest';

import { findReferences } from './references.ts';

const REPO = { owner: 'octo', name: 'repo' };

test('references are found in time in proportion to the text', () => {
  // Each marker is searched for again only once it's behind, so a text full of one marker and
  // without the others is read once, not once per marker.
  for (const text of [
    '@'.repeat(1_000_000),
    '#'.repeat(1_000_000),
    'GH-'.repeat(300_000),
    '@#'.repeat(500_000),
  ]) {
    const started = performance.now();
    findReferences(text, REPO);
    expect(performance.now() - started).toBeLessThan(500);
  }
});

test('a cross-repository reference reads no further back than the longest names', () => {
  const owner = 'a'.repeat(39);
  const name = 'b'.repeat(100);
  expect(findReferences(`${owner}/${name}#1`, undefined)).toEqual([
    { kind: 'reference', start: 0, end: 142, url: `https://github.com/${owner}/${name}/issues/1` },
  ]);
  expect(findReferences(`${owner}a/${name}#1`, undefined)).toEqual([]);
  expect(findReferences(`${owner}/${name}b#1`, undefined)).toEqual([]);
});
