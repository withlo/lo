import { expect, test } from 'vitest';

import { activityPath, unavailableReason } from './activity.ts';
import { nextLink } from './files.ts';
import { GithubError } from './errors.ts';
import { RepoRef } from './refs.ts';

test('reads the next page from a link header', () => {
  const link =
    '<https://api.github.com/repositories/1/activity?ref=refs%2Fheads%2Fmain&after=Y3V>; ' +
    'rel="next", <https://api.github.com/repositories/1/activity?before=X>; rel="prev"';
  expect(nextLink(link)).toBe(
    'https://api.github.com/repositories/1/activity?ref=refs%2Fheads%2Fmain&after=Y3V',
  );
  expect(nextLink('<https://api.github.com/x?before=X>; rel="prev"')).toBeUndefined();
  expect(nextLink('')).toBeUndefined();
});

function api(status: number): GithubError {
  return new GithubError({ kind: 'api', status, message: `HTTP ${status}`, errors: [] });
}

test('a repository gone or closed to the account is unavailable and a failure is not', () => {
  const unavailable = [
    new GithubError({ kind: 'notFound', message: 'Not Found' }),
    new GithubError({ kind: 'ssoRequired', message: 'SAML' }),
    new GithubError({ kind: 'oauthAppRestricted', message: 'restricted' }),
    api(403),
    api(409),
    api(410),
    api(451),
  ];
  expect(unavailable.map(unavailableReason)).toEqual([
    'Not Found',
    'SAML',
    'restricted',
    'HTTP 403',
    'HTTP 409',
    'HTTP 410',
    'HTTP 451',
  ]);
  const failures = [
    api(500),
    api(502),
    api(422),
    new GithubError({ kind: 'decode', message: 'no' }),
    new GithubError({ kind: 'network', failure: 'unknown', message: 'down' }),
  ];
  expect(failures.map(unavailableReason)).toEqual(failures.map(() => undefined));
});

test('asks for a branch by its full ref', () => {
  expect(activityPath(new RepoRef('voidsipp', 'fd'), 'fix/1822-explicit-jemalloc', 'asc')).toBe(
    '/repos/voidsipp/fd/activity?ref=refs%2Fheads%2Ffix%2F1822-explicit-jemalloc' +
      '&direction=asc&per_page=100',
  );
});
