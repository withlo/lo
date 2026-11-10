import { expect, test } from 'vitest';

import { PullRef, RepoRef } from './refs.ts';

test('owners and names match ignoring case', () => {
  const written = new PullRef('rozed-dev', 'playground', 1);
  const shouted = new PullRef('Rozed-Dev', 'PLAYGROUND', 1);
  expect(written.equals(shouted)).toBe(true);
  // Ordered as the same pull request, and keyed as one.
  expect(PullRef.compare(written, shouted)).toBe(0);
  expect(new Set([written.key, shouted.key]).size).toBe(1);
  // As written, for showing.
  expect(shouted.toString()).toBe('Rozed-Dev/PLAYGROUND#1');
  expect(written.equals(new PullRef('rozed-dev', 'playground', 2))).toBe(false);
  expect(new RepoRef('a-b', 'c').equals(new RepoRef('a', 'b-c'))).toBe(false);
  expect(RepoRef.compare(new RepoRef('A', 'b'), new RepoRef('a', 'C'))).toBeLessThan(0);
});
