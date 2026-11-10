import { expect, test } from 'vitest';

import {
  displayPullLink,
  parsePullLink,
  PullLinkError,
  type PullLink,
  type PullLinkProblem,
} from './links.ts';

const FD_2212: PullLink = { owner: 'sharkdp', repo: 'fd', number: 2212 };

/** Why `link` isn't a pull request link, or nothing when it is one. */
function problemOf(link: string): PullLinkProblem | undefined {
  try {
    parsePullLink(link);
    return undefined;
  } catch (error) {
    if (error instanceof PullLinkError) return error.problem;
    throw error;
  }
}

test('parses a pull request link', () => {
  expect(parsePullLink('https://github.com/sharkdp/fd/pull/2212')).toEqual(FD_2212);
});

test('parses without a scheme or over http', () => {
  expect(parsePullLink('github.com/sharkdp/fd/pull/2212')).toEqual(FD_2212);
  expect(parsePullLink('http://github.com/sharkdp/fd/pull/2212')).toEqual(FD_2212);
  expect(parsePullLink('HTTPS://GitHub.com/sharkdp/fd/pull/2212')).toEqual(FD_2212);
  expect(parsePullLink('https://www.github.com/sharkdp/fd/pull/2212')).toEqual(FD_2212);
});

test('parses a lo link', () => {
  expect(parsePullLink('lo://github.com/sharkdp/fd/pull/2212')).toEqual(FD_2212);
  expect(parsePullLink('LO://github.com/sharkdp/fd/pull/2212/files')).toEqual(FD_2212);
});

test('parses with a trailing slash', () => {
  expect(parsePullLink('https://github.com/sharkdp/fd/pull/2212/')).toEqual(FD_2212);
});

test('parses links to a pull requests tabs', () => {
  for (const tab of ['files', 'commits', 'checks']) {
    expect(parsePullLink(`https://github.com/sharkdp/fd/pull/2212/${tab}`)).toEqual(FD_2212);
    expect(parsePullLink(`https://github.com/sharkdp/fd/pull/2212/${tab}/`)).toEqual(FD_2212);
  }
});

test('ignores a query and a fragment', () => {
  expect(parsePullLink('https://github.com/sharkdp/fd/pull/2212#issuecomment-1')).toEqual(FD_2212);
  expect(parsePullLink('https://github.com/sharkdp/fd/pull/2212/files?w=1')).toEqual(FD_2212);
  expect(parsePullLink('https://github.com/sharkdp/fd/pull/2212/files?w=1#diff-abc')).toEqual(
    FD_2212,
  );
});

test('ignores surrounding whitespace', () => {
  expect(parsePullLink('  https://github.com/sharkdp/fd/pull/2212\n')).toEqual(FD_2212);
});

test('keeps owner and repo as written', () => {
  expect(parsePullLink('https://github.com/rust-lang/rust.vim/pull/1')).toEqual({
    owner: 'rust-lang',
    repo: 'rust.vim',
    number: 1,
  });
  expect(parsePullLink('https://github.com/Some-Org/My_Repo-2/pull/77')).toEqual({
    owner: 'Some-Org',
    repo: 'My_Repo-2',
    number: 77,
  });
});

test('rejects other hosts', () => {
  for (const link of [
    'https://gitlab.com/sharkdp/fd/pull/2212',
    'https://github.com.evil.example/sharkdp/fd/pull/2212',
    'https://api.github.com/repos/sharkdp/fd/pulls/2212',
    'https://gist.github.com/sharkdp/fd/pull/2212',
    'https://github.com:8443/sharkdp/fd/pull/2212',
    'https://user@github.com/sharkdp/fd/pull/2212',
    'ftp://github.com/sharkdp/fd/pull/2212',
    'git@github.com:sharkdp/fd.git',
    'sharkdp/fd#2212',
    '',
  ]) {
    expect([link, problemOf(link)]).toEqual([link, 'notGithub']);
  }
});

test('rejects links to other github pages', () => {
  for (const link of [
    'https://github.com/sharkdp/fd/issues/2212',
    'https://github.com/sharkdp/fd/pulls',
    'https://github.com/sharkdp/fd/pulls/2212',
    'https://github.com/sharkdp/fd/pull',
    'https://github.com/sharkdp/fd/pull/',
    'https://github.com/sharkdp/fd',
    'https://github.com/sharkdp',
    'https://github.com/',
    'https://github.com',
    'https://github.com/sharkdp/fd/pull/2212/conflicts',
    'https://github.com/sharkdp/fd/pull/2212/files/extra',
    'https://github.com/sharkdp/fd/pull/2212//',
    'https://github.com/sharkdp//fd/pull/2212',
  ]) {
    expect([link, problemOf(link)]).toEqual([link, 'notAPullRequest']);
  }
});

test('rejects numbers that arent positive whole numbers', () => {
  for (const number of [
    'abc',
    '12a',
    '-1',
    '+1',
    '0',
    '1.5',
    ' 1',
    '99999999999999999999999',
    // Above what GitHub's API can hold.
    '9223372036854775808',
    '2147483648',
  ]) {
    const link = `https://github.com/sharkdp/fd/pull/${number}`;
    expect([link, problemOf(link)]).toEqual([link, 'invalidNumber']);
  }
  expect(parsePullLink('https://github.com/sharkdp/fd/pull/2147483647')).toEqual({
    ...FD_2212,
    number: 2147483647,
  });
});

test('rejects invalid owners', () => {
  for (const owner of ['-sharkdp', 'shark_dp', 'shark.dp', 'shärk', 'a'.repeat(40)]) {
    const link = `https://github.com/${owner}/fd/pull/1`;
    expect([link, problemOf(link)]).toEqual([link, 'invalidOwner']);
  }
});

test('rejects invalid repos', () => {
  // Owner and repo name a folder in Lo's cache, so `.`, `..` and anything outside GitHub's
  // characters must never get through.
  for (const repo of ['.', '..', 'f d', 'fd%2F..', 'fd\\..', 'fd:x', 'a'.repeat(101)]) {
    const link = `https://github.com/sharkdp/${repo}/pull/1`;
    expect([link, problemOf(link)]).toEqual([link, 'invalidRepo']);
  }
});

test('displays as owner repo number', () => {
  expect(displayPullLink(FD_2212)).toBe('sharkdp/fd#2212');
});

test('errors say why', () => {
  expect(new PullLinkError('notAPullRequest').message).toBe("it isn't a link to a pull request");
});
