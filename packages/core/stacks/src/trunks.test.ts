import type { RefNames } from '@lo/github';
import { expect, test } from 'vitest';

import type { PullRequest } from './stacks.ts';
import {
  ALL,
  covers,
  DEFAULT_BRANCH,
  fnmatch,
  isExact,
  isTrunk,
  NO_TRUNKS,
  trunksAmong,
  type Trunks,
} from './trunks.ts';

test('a star stops at slashes', () => {
  // GitHub's own examples (`about-fnmatch` in github/docs).
  expect(fnmatch('qa/*', 'qa/feature')).toBe(true);
  expect(fnmatch('qa/*', 'qa/foo/bar')).toBe(false);
  expect(fnmatch('qa/**/*', 'qa/foo/bar/foobar/hello-world')).toBe(true);
  expect(fnmatch('qa/**/*', 'qa/foo')).toBe(true);
  expect(fnmatch('qa**/**/*', 'qa/foo/bar')).toBe(true);
  expect(fnmatch('qa**/**/*', 'qa-team/foo')).toBe(true);
  expect(fnmatch('qa**/**/*', 'qa')).toBe(false);
  expect(fnmatch('*release*', 'pre-release-2')).toBe(true);
  expect(fnmatch('*release*', 'releases/2.0')).toBe(false);
  expect(fnmatch('*', 'main')).toBe(true);
  expect(fnmatch('*', 'user/topic')).toBe(false);
});

test('double stars match directories only before a slash', () => {
  expect(fnmatch('**/main', 'main')).toBe(true);
  expect(fnmatch('**/main', 'a/b/main')).toBe(true);
  expect(fnmatch('**/main', 'a/b/not-main')).toBe(false);
  // Anywhere else, `**` is `*`.
  expect(fnmatch('**', 'main')).toBe(true);
  expect(fnmatch('**', 'a/b')).toBe(false);
  expect(fnmatch('a/**', 'a/b/c')).toBe(false);
  expect(fnmatch('a**', 'abc')).toBe(true);
  expect(fnmatch('refs/heads/**/*', 'refs/heads/a/b/c')).toBe(true);
});

test('question marks sets and escapes', () => {
  expect(fnmatch('v?', 'v1')).toBe(true);
  expect(fnmatch('v?', 'v10')).toBe(false);
  expect(fnmatch('a?b', 'a/b')).toBe(false);
  // zed-industries/zed's release branches.
  const releases = 'refs/heads/v[0-9].[0-9]*.x';
  expect(fnmatch(releases, 'refs/heads/v1.27.x')).toBe(true);
  expect(fnmatch(releases, 'refs/heads/v0.203.x')).toBe(true);
  expect(fnmatch(releases, 'refs/heads/v1.27.0')).toBe(false);
  expect(fnmatch(releases, 'refs/heads/main')).toBe(false);
  expect(fnmatch('[!a-c]x', 'dx')).toBe(true);
  expect(fnmatch('[!a-c]x', 'bx')).toBe(false);
  expect(fnmatch('[a-]x', '-x')).toBe(true);
  // `[]` is an empty set.
  expect(fnmatch('[]]x', ']x')).toBe(false);
  // A set that never ends matches nothing.
  expect(fnmatch('[abc', 'a')).toBe(false);
  expect(fnmatch(String.raw`a\*`, 'a*')).toBe(true);
  expect(fnmatch(String.raw`a\*`, 'ab')).toBe(false);
  expect(fnmatch(String.raw`[\]]`, ']')).toBe(true);
  // GitHub doesn't complement with `^`, nor expand braces.
  expect(fnmatch('[^a]', '^')).toBe(true);
  expect(fnmatch('[^a]', 'a')).toBe(true);
  expect(fnmatch('[^a]', 'b')).toBe(false);
  expect(fnmatch('{main,dev}', 'main')).toBe(false);
  expect(fnmatch('Main', 'main')).toBe(false);
});

test('stars backtrack', () => {
  expect(fnmatch('*-*-x', 'a-b-c-x')).toBe(true);
  expect(fnmatch('*a*b', 'xaxxab')).toBe(true);
  expect(fnmatch('*a*b', 'xaxxa')).toBe(false);
  expect(fnmatch('enterprise-*.*.*-release', 'enterprise-3.18.1-release')).toBe(true);
  expect(fnmatch('enterprise-*.*.*-release', 'enterprise-3.18-release')).toBe(false);
});

/** A ruleset that gates merging. */
function refs(include: string[], exclude: string[]): RefNames {
  return { include, exclude, gatesMerging: true };
}

function trunks(defaultBranch: string, protectedBranches: string[], rulesets: RefNames[]): Trunks {
  return { defaultBranch, protected: protectedBranches, rulesets };
}

/** A ruleset with GitHub's defaults for a new one: no deletions, no force pushes. */
function defaults(include: string[]): RefNames {
  return { ...refs(include, []), gatesMerging: false };
}

test('a ruleset that names a branch exactly makes it a trunk whatever it enforces', () => {
  const repo = trunks(
    'main',
    [],
    [defaults(['refs/heads/develop', 'refs/heads/release/*']), defaults(['refs/heads/feature/*'])],
  );
  expect(isTrunk(repo, 'develop')).toBe(true);
  expect(isTrunk(repo, 'release/2.0')).toBe(false);
  expect(isTrunk(repo, 'feature/a')).toBe(false);
  expect(isExact('refs/heads/v1.x')).toBe(true);
  expect(isExact(DEFAULT_BRANCH)).toBe(true);
  expect(isExact('refs/heads/v[0-9].x')).toBe(false);
  expect(isExact(ALL)).toBe(false);
  expect(isExact('develop')).toBe(false);
});

test('a ruleset matches full ref names and its special names', () => {
  const main = 'main';
  expect(covers(refs(['refs/heads/release/*'], []), 'release/1.0', main)).toBe(true);
  // Patterns match `refs/heads/…`, so one without it names no branch.
  expect(covers(refs(['release/*'], []), 'release/1.0', main)).toBe(false);
  expect(covers(refs([DEFAULT_BRANCH], []), 'main', main)).toBe(true);
  expect(covers(refs([DEFAULT_BRANCH], []), 'develop', main)).toBe(false);
  expect(covers(refs([DEFAULT_BRANCH], []), 'main', undefined)).toBe(false);
  expect(covers(refs([ALL], []), 'anything/at/all', main)).toBe(true);
  // An exclude wins over an include.
  const notDev = refs(['refs/heads/main', 'refs/heads/master'], ['refs/heads/dev*']);
  expect(covers(notDev, 'master', main)).toBe(true);
  expect(covers(refs([ALL], ['refs/heads/dev*']), 'develop', main)).toBe(false);
  expect(covers(refs([ALL], [DEFAULT_BRANCH]), 'main', main)).toBe(false);
});

test('rules for every branch make no trunks', () => {
  // A large repository's rulesets as a reader sees them, cut down.
  const big = trunks(
    'main',
    [],
    [
      refs(['refs/heads/*'], []),
      refs(['refs/heads/*/**/*'], []),
      refs(['refs/heads/beta'], []),
      refs(['refs/heads/automation/bors/try'], []),
    ],
  );
  expect(isTrunk(big, 'main')).toBe(true);
  expect(isTrunk(big, 'beta')).toBe(true);
  expect(isTrunk(big, 'automation/bors/try')).toBe(true);
  expect(isTrunk(big, 'topic')).toBe(false);
  expect(isTrunk(big, 'user/topic')).toBe(false);
  // Copilot reviews on every branch, as in cli/cli.
  const cli = trunks('trunk', [], [refs([ALL], [])]);
  expect(isTrunk(cli, 'trunk')).toBe(true);
  expect(isTrunk(cli, 'stack-a')).toBe(false);
  // A catch-all include is skipped, but the ruleset's other includes still count.
  const mixed = trunks('main', ['*', '**/*'], [refs([ALL, 'refs/heads/next'], [])]);
  expect(isTrunk(mixed, 'next')).toBe(true);
  expect(isTrunk(mixed, 'feature')).toBe(false);
});

test('a rule for every branch but some names the rest', () => {
  // Pull requests on every branch but work branches: develop and release branches are trunks,
  // and so is anything else no rule excludes.
  const flow = trunks(
    'main',
    [],
    [refs([ALL], ['refs/heads/feature/**/*', 'refs/heads/users/**/*'])],
  );
  expect(isTrunk(flow, 'develop')).toBe(true);
  expect(isTrunk(flow, 'release/2.0')).toBe(true);
  expect(isTrunk(flow, 'feature/a')).toBe(false);
  expect(isTrunk(flow, 'feature/a/b')).toBe(false);
  expect(isTrunk(flow, 'users/me/topic')).toBe(false);
  // The same with wildcards for every branch.
  const wildcards = trunks('main', [], [refs(['refs/heads/**/*'], ['refs/heads/feature/*'])]);
  expect(isTrunk(wildcards, 'develop')).toBe(true);
  expect(isTrunk(wildcards, 'feature/a')).toBe(false);
});

test('protection patterns match branch names', () => {
  const repo = trunks('main', ['develop', 'release/*'], [refs(['refs/heads/production'], [])]);
  expect(isTrunk(repo, 'develop')).toBe(true);
  expect(isTrunk(repo, 'release/2.0')).toBe(true);
  expect(isTrunk(repo, 'release/2.0/hotfix')).toBe(false);
  expect(isTrunk(repo, 'production')).toBe(true);
  expect(isTrunk(repo, 'feature')).toBe(false);
  // Without a default branch, only the rules name trunks.
  expect(isTrunk(NO_TRUNKS, 'main')).toBe(false);
});

function pr(base: string, head: string, fromFork: boolean): PullRequest {
  return {
    number: 1,
    state: { kind: 'open' },
    baseRef: base,
    baseTip: undefined,
    headRef: head,
    headInBaseRepo: !fromFork,
    headOid: '',
    commits: [],
    createdAt: 0,
    nativeStack: undefined,
  };
}

test('trunks among pull requests list the default branch first', () => {
  const repo = trunks('main', ['develop', 'release/*'], []);
  const prs = [
    pr('main', 'develop', false),
    pr('release/2.0', 'fix', false),
    pr('develop', 'topic', false),
    // A fork's `release/1.0` isn't the repository's.
    pr('main', 'release/1.0', true),
    pr('main', 'develop', false),
  ];
  expect(trunksAmong(repo, prs)).toEqual(['main', 'develop', 'release/2.0']);
  expect(trunksAmong(NO_TRUNKS, prs)).toEqual([]);
});
