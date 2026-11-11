import { expect, test } from 'vitest';

import { type FetchFailure, GitError, type GitErrorDetail } from './errors.ts';

function fetchFailure(message: string): FetchFailure | undefined {
  const { detail } = GitError.fromGit('git fetch', message, 'pull request #1');
  return detail.kind === 'fetch' ? detail.failure : undefined;
}

test('classifies fetch failures from gits messages', () => {
  const cases: [string, FetchFailure][] = [
    [
      "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com",
      'network',
    ],
    [
      "fatal: unable to access 'https://github.com/a/b.git/': Failed to connect to github.com " +
        "port 443 after 75004 ms: Couldn't connect to server",
      'network',
    ],
    [
      'error: RPC failed; curl 56 Recv failure: Connection reset by peer\nfatal: early EOF',
      'network',
    ],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth'],
    // A token GitHub refused, as one a renewal revoked.
    [
      'remote: Invalid username or token. Password authentication is not supported for Git ' +
        "operations.\nfatal: Authentication failed for 'https://github.com/a/b.git/'",
      'tokenRefused',
    ],
    [
      "remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found",
      'repoNotFound',
    ],
    [
      "fatal: '/tmp/x/remote.git' does not appear to be a git repository\nfatal: Could not read " +
        'from remote repository.',
      'repoNotFound',
    ],
    ["fatal: couldn't find remote ref refs/pull/9/head", 'refNotFound'],
    // A commit GitHub no longer has, asked for by ID.
    [
      'fatal: remote error: upload-pack: not our ref 1234567890123456789012345678901234567890',
      'refNotFound',
    ],
    [
      'error: Server does not allow request for unadvertised object ' +
        '1234567890123456789012345678901234567890',
      'refNotFound',
    ],
    // Any 403 that isn't a rate limit is about the account: SSO, an IP allow list.
    [
      "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 403",
      'auth',
    ],
    [
      "remote: The 'org' organization has enabled or enforced SAML SSO.\nfatal: unable to access " +
        "'https://github.com/a/b.git/': The requested URL returned error: 403",
      'auth',
    ],
    // Rate and abuse limits wear off.
    [
      'remote: API rate limit exceeded for user ID 1.\nfatal: unable to access ' +
        "'https://github.com/a/b.git/': The requested URL returned error: 403",
      'rateLimited',
    ],
    [
      'remote: You have exceeded a secondary rate limit.\nfatal: unable to access ' +
        "'https://github.com/a/b.git/': The requested URL returned error: 403",
      'rateLimited',
    ],
    [
      'remote: You have triggered an abuse detection mechanism.\nfatal: unable to access ' +
        "'https://github.com/a/b.git/': The requested URL returned error: 403",
      'rateLimited',
    ],
    [
      "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 429",
      'rateLimited',
    ],
    // Only GitHub's own words for a missing repository.
    ["fatal: repository 'https://github.com/a/b.git/' not found", 'repoNotFound'],
    ["fatal: path 'src/x' not found", 'other'],
    ['error: object 1234 not found', 'other'],
    // A certificate that fails to verify won't verify next time either.
    [
      "fatal: unable to access 'https://github.com/a/b.git/': SSL certificate problem: unable to " +
        'get local issuer certificate',
      'certificate',
    ],
    [
      "fatal: unable to access 'https://github.com/a/b.git/': SSL: no alternative certificate " +
        "subject name matches target host name 'github.com'",
      'certificate',
    ],
    [
      "fatal: unable to access 'https://github.com/a/b.git/': server certificate verification " +
        'failed. CAfile: none CRLfile: none',
      'certificate',
    ],
    // A TLS connection that drops is the network.
    [
      "fatal: unable to access 'https://github.com/a/b.git/': LibreSSL SSL_connect: " +
        'SSL_ERROR_SYSCALL in connection to github.com:443',
      'network',
    ],
    ['fatal: something new', 'other'],
  ];
  expect(cases.map(([message]) => [message, fetchFailure(message)])).toEqual(cases);
});

const retryable = (failure: FetchFailure) =>
  new GitError({ kind: 'fetch', what: 'pull request #1', failure, message: '' }).isRetryable();

test('rate limits and the network are retryable and the rest isnt', () => {
  const failures: FetchFailure[] = [
    'network',
    'rateLimited',
    'tokenRefused',
    'other',
    'timedOut',
    'auth',
    'certificate',
    'repoNotFound',
    'refNotFound',
  ];
  expect(failures.filter((failure) => retryable(failure))).toEqual([
    'network',
    'rateLimited',
    'tokenRefused',
    'other',
    'timedOut',
  ]);
});

test('a full disk is its own error', () => {
  const error = GitError.fromGit(
    'git fetch',
    'error: unable to write file: No space left on device',
    'pull request #1',
  );
  expect(error.detail).toEqual({ kind: 'diskFull' });
  const full = Object.assign(new Error('ENOSPC: no space left on device, write'), {
    code: 'ENOSPC',
  });
  expect(GitError.io('writing', full).detail).toEqual({ kind: 'diskFull' });
});

test('a failed lazy download is a fetch error', () => {
  const error = GitError.fromGit(
    'git cat-file --batch',
    "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: " +
      'github.com\nfatal: could not fetch 6178079 from promisor remote',
  );
  expect(error.isRetryable()).toBe(true);
  expect(error.message).toMatch(/^can't fetch the files to show: the network failed/);
});

test('other git failures stay git errors', () => {
  const error = GitError.fromGit('git merge-base a b', 'fatal: Not a valid object name a');
  expect(error.detail.kind).toBe('git');
  expect(error.isRetryable()).toBe(false);
});

test('messages say what failed and why', () => {
  const error = GitError.fromGit(
    'git fetch',
    "remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found",
    'pull request #12',
  );
  expect(error.message).toBe(
    "can't fetch pull request #12: the repository doesn't exist, or the account can't see it " +
      "(fatal: repository 'https://github.com/a/b.git/' not found)",
  );
  const oid = '22c70acc6992c0c51cb68527b87adf114d01acbc';
  expect(new GitError({ kind: 'unavailable', oid }).message).toBe(
    'commit 22c70ac is no longer available',
  );
  expect(new GitError({ kind: 'notFetched', oid }).message).toBe(
    "commit 22c70ac isn't in the local copy",
  );
  const timedOut = new GitError({
    kind: 'fetch',
    what: 'pull request #11758',
    failure: 'timedOut',
    message:
      'GitHub took longer than 2 min to start sending, so Lo stopped it while GitHub was still ' +
      'working out what to send',
  });
  expect(timedOut.message).toBe(
    "can't fetch pull request #11758: GitHub took longer than 2 min to start sending, so Lo " +
      'stopped it while GitHub was still working out what to send',
  );
  const head = '6178079fd3a1b8f5f2a8a3e5c0b7a6a0f0e1d2c3';
  expect(new GitError({ kind: 'baseNotAncestor', base: oid, head }).message).toBe(
    "commit 22c70ac isn't an ancestor of 6178079, so it can't be its base",
  );
});

test('an error Lo can’t put in words keeps its detail and cause, with a plain message', () => {
  // A kind this build of Lo doesn't know, and a known one without what describing it reads.
  const details: GitErrorDetail[] = JSON.parse(
    '[{ "kind": "mystery" }, { "kind": "unavailable" }]',
  );
  for (const given of details) {
    const cause = new Error('the failure it reports');
    const error = new GitError(given, { cause });
    expect(error.message).toBe("git failed in a way Lo couldn't describe");
    expect(error.detail).toBe(given);
    expect(error.cause).toBe(cause);
  }
});
