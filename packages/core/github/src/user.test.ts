import { expect, test } from 'vitest';

import { missingScopes, parseScopes } from './user.ts';

test('parses the scopes header', () => {
  expect(parseScopes('read:org, repo, workflow')).toEqual(['read:org', 'repo', 'workflow']);
  expect(parseScopes('')).toEqual([]);
  expect(parseScopes(undefined)).toEqual([]);
});

test('finds missing scopes', () => {
  expect(missingScopes(parseScopes('read:org, repo, workflow'))).toEqual([]);
  expect(missingScopes(parseScopes('gist, read:org, repo'))).toEqual(['workflow']);
  expect(missingScopes(parseScopes('admin:org, repo, workflow'))).toEqual([]);
  expect(missingScopes(parseScopes(''))).toEqual(['repo', 'read:org', 'workflow']);
});
