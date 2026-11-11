import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { MergeSnapshotDocument } from './generated/graphql.ts';
import { fieldPath } from './merge.ts';
import { PAGE_SIZE } from './pager.ts';

/** The query file `name` in `graphql/`. */
function query(name: string): string {
  return readFileSync(new URL(`../graphql/${name}.graphql`, import.meta.url), 'utf8');
}

/** `source` from its `MergeCheck` fragment on. */
function fragment(source: string): string {
  return source.slice(source.indexOf('fragment MergeCheck'));
}

test('both queries read a check the same way', () => {
  expect(fragment(query('merge_snapshot'))).toContain('fragment MergeCheck');
  expect(fragment(query('merge_snapshot'))).toBe(fragment(query('merge_checks')));
});

test('check suites and a teams members are read a full page', () => {
  // More suites than the page reads keeps every missing required check waiting, and the search
  // for your login among a team's members matches others' logins and names too.
  const document = String(MergeSnapshotDocument);

  expect(document).toContain(`checkSuites(first: ${PAGE_SIZE})`);
  expect(document).toContain(`members(query: $login, first: ${PAGE_SIZE})`);
});

test('an errors path names the field from the repository', () => {
  expect(fieldPath(['repository', 'pullRequest', 'statusCheckRollup'])).toBe(
    'pullRequest.statusCheckRollup',
  );
  expect(
    fieldPath(['repository', 'pullRequest', 'statusCheckRollup', 'contexts', 'nodes', 5]),
  ).toBe('pullRequest.statusCheckRollup.contexts.nodes.5');
});
