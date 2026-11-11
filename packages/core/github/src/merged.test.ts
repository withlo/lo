import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

/** The query file `name` in `graphql/`. */
function query(name: string): string {
  return readFileSync(new URL(`../graphql/${name}.graphql`, import.meta.url), 'utf8');
}

/** `source` from its `MergedPullRequestFields` fragment on, where both queries have it. */
function fragment(source: string): string {
  return source.slice(source.indexOf('fragment MergedPullRequestFields'));
}

test('both queries read merged pull requests alike', () => {
  expect(fragment(query('merged_pull_requests'))).toContain('fragment MergedPullRequestFields');
  expect(fragment(query('merged_pull_requests'))).toBe(fragment(query('open_pull_requests')));
});
