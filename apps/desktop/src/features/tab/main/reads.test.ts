import {
  approvalUrl,
  GithubClient,
  GithubError,
  PullRef,
  type PollStatus,
  type PullSummary,
} from '@lo/github';
import { replayFetch } from '@lo/testing';
import { describe, expect, it } from 'vitest';

import {
  connectionOf,
  detailsState,
  headerFromOpened,
  isUnreached,
  problemOf,
  rateLimitedUntil,
  readPull,
  summaryState,
  withSummary,
} from './reads.ts';

const URLS = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};
const E2E = new PullRef('rozed-dev', 'e2e', 80);

const summary = (change: Partial<PullSummary> = {}): PullSummary => ({
  number: 80,
  title: 'A title',
  state: 'open',
  draft: false,
  updated_at: '2026-11-11T10:20:00Z',
  head: { ref: 'app/feature', sha: 'a'.repeat(40) },
  base: { ref: 'app/base', sha: 'b'.repeat(40) },
  ...change,
});

describe('reading a pull request to open it', () => {
  it('reads both of GitHub’s views of it in one request, and its header from them', async () => {
    const fetch = replayFetch('app_e2e');
    const opened = await readPull(new GithubClient({ fetch, urls: URLS }), E2E);
    expect(fetch.seen.map(({ url }) => url)).toEqual([
      'https://api.github.com/repos/rozed-dev/e2e/pulls/80',
    ]);
    expect(opened.toOpen.base.repo.full_name).toBe('rozed-dev/e2e');
    expect(headerFromOpened(opened)).toEqual({
      title: "App: the pull request Lo's end-to-end tests open",
      state: 'open',
      author: 'rozed-bot',
      head: { branch: 'app/feature', fork: null },
      base: { branch: 'app/base' },
    });
  });

  it("names the fork a pull request's head is in", async () => {
    const opened = await readPull(
      new GithubClient({ fetch: replayFetch('app_e2e'), urls: URLS }),
      E2E,
    );
    const fork = {
      ...opened,
      toOpen: {
        ...opened.toOpen,
        head: { ...opened.toOpen.head, repo: { id: 1, full_name: 'someone/e2e' } },
      },
    };
    expect(headerFromOpened(fork).head).toEqual({ branch: 'app/feature', fork: 'someone/e2e' });
  });

  it("fails as GitHub's not found for a pull request it doesn't have", async () => {
    const error = await readPull(
      new GithubClient({ fetch: replayFetch('app_e2e'), urls: URLS }),
      new PullRef('rozed-dev', 'e2e', 9999),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GithubError);
    expect(problemOf(error, E2E, { kind: 'account', login: 'rozed-bot' }, undefined)).toEqual({
      kind: 'notFound',
      cause: { kind: 'hidden', login: 'rozed-bot' },
      details: 'Not Found',
    });
  });
});

describe('a pull request’s state', () => {
  it('reads merged, closed, draft and open from either view', () => {
    expect(summaryState(summary())).toBe('open');
    expect(summaryState(summary({ draft: true }))).toBe('draft');
    expect(summaryState(summary({ state: 'closed' }))).toBe('closed');
    expect(summaryState(summary({ state: 'closed', merged_at: '2026-11-11T11:00:00Z' }))).toBe(
      'merged',
    );
    expect(detailsState({ state: 'OPEN', isDraft: false })).toBe('open');
    expect(detailsState({ state: 'OPEN', isDraft: true })).toBe('draft');
    expect(detailsState({ state: 'CLOSED', isDraft: false })).toBe('closed');
    expect(detailsState({ state: 'MERGED', isDraft: true })).toBe('merged');
  });

  it("takes a poll's title, state and branches, and keeps who opened it", () => {
    const before = {
      title: 'Old',
      state: 'open' as const,
      author: 'rozed-bot',
      head: { branch: 'old', fork: 'someone/e2e' },
      base: { branch: 'main' },
    };
    expect(withSummary(before, summary({ title: 'New', state: 'closed' }))).toEqual({
      title: 'New',
      state: 'closed',
      author: 'rozed-bot',
      head: { branch: 'app/feature', fork: 'someone/e2e' },
      base: { branch: 'app/base' },
    });
    // With no header before it, the author isn't known yet, which isn't a deleted account.
    expect(withSummary(undefined, summary()).author).toBeUndefined();
    expect(withSummary({ ...before, author: null }, summary()).author).toBe(null);
  });
});

const status = (change: Partial<PollStatus> = {}): PollStatus => ({
  rateLimit: { kind: 'normal' },
  offline: undefined,
  signedOut: false,
  ...change,
});

describe('how a tab stands with GitHub', () => {
  it('is live when nothing is wrong', () => {
    expect(connectionOf('rozed-bot', status())).toEqual({ kind: 'live' });
  });

  it('says the worst of what is: signed out, then the limit used up, then no answer with why, then a low limit', () => {
    const offline = {
      since: 1,
      retryAt: 2_000.4,
      cause: { kind: 'timeout' as const },
      error: 'GitHub can’t be reached',
    };
    const paused = {
      kind: 'paused' as const,
      until: 9_000,
      reason: { kind: 'secondary' as const },
    };
    const low = {
      kind: 'slowed' as const,
      low: { resource: 'core', remaining: 50, limit: 5000, reset: 7_000 },
    };
    expect(
      connectionOf('rozed-bot', status({ signedOut: true, offline, rateLimit: paused })),
    ).toEqual({ kind: 'signedOut', login: 'rozed-bot' });
    expect(connectionOf('rozed-bot', status({ offline, rateLimit: paused }))).toEqual({
      kind: 'rateLimited',
      login: 'rozed-bot',
      until: 9_000,
      secondary: true,
    });
    expect(connectionOf('rozed-bot', status({ offline, rateLimit: low }))).toEqual({
      kind: 'offline',
      retryAt: 2_000,
      cause: { kind: 'timeout' },
      error: 'GitHub can’t be reached',
    });
    expect(connectionOf('rozed-bot', status({ rateLimit: low }))).toEqual({
      kind: 'limitLow',
      remaining: 50,
      reset: 7_000,
    });
  });
});

/** GitHub's refusal for a rate limit, with when to try again. */
const limited = (detail: { reset?: number; retryAfter?: number }) =>
  new GithubError({ kind: 'rateLimited', message: 'used up', secondary: false, ...detail });

describe('what reading it ran into', () => {
  const account = { kind: 'account' as const, login: 'rozed-bot' };

  it("says GitHub has no such pull request, or can't show it without signing in", () => {
    const missing = new GithubError({ kind: 'notFound', message: 'Not Found' });
    expect(problemOf(missing, E2E, { kind: 'anonymous', signedIn: false }, 5)).toEqual({
      kind: 'notFound',
      cause: { kind: 'private', signedIn: false },
      details: 'Not Found',
    });
    expect(problemOf(missing, E2E, { kind: 'anonymous', signedIn: true }, 5)).toMatchObject({
      cause: { kind: 'private', signedIn: true },
    });
    const gone = new GithubError({ kind: 'api', status: 410, message: 'Gone', errors: [] });
    expect(problemOf(gone, E2E, account, undefined).kind).toBe('notFound');
  });

  it("gives GitHub's link to fix single sign-on, and only a link on github.com", () => {
    const sso = new GithubError({
      kind: 'ssoRequired',
      message: 'Resource protected by organization SAML enforcement.',
      url: 'https://github.com/orgs/rozed-dev/sso?authorization_request=x',
    });
    expect(problemOf(sso, E2E, account, undefined)).toMatchObject({
      kind: 'blocked',
      links: [
        {
          label: 'Authorize on GitHub',
          url: sso.detail.kind === 'ssoRequired' ? sso.detail.url : '',
        },
      ],
    });
    const elsewhere = new GithubError({
      kind: 'ssoRequired',
      message: 'Resource protected by organization SAML enforcement.',
      url: 'https://evil.example/sso',
    });
    expect(problemOf(elsewhere, E2E, account, undefined).kind).toBe('failed');
  });

  it("says an organization that restricts Lo hasn't approved it, with GitHub's link to ask", () => {
    const restricted = new GithubError({
      kind: 'oauthAppRestricted',
      message:
        'Although you appear to have the correct authorization credentials, the `rozed-dev` organization has enabled OAuth App access restrictions',
      org: 'rozed-dev',
    });
    expect(problemOf(restricted, E2E, account, undefined)).toEqual({
      kind: 'blocked',
      cause: { kind: 'unapproved', org: 'rozed-dev' },
      details: restricted.detail.kind === 'oauthAppRestricted' ? restricted.detail.message : '',
      links: [{ label: 'Request approval on GitHub', url: approvalUrl() }],
    });
  });

  it('says anything else failed, and when Lo tries again', () => {
    const error = new Error('the answer made no sense', {
      cause: new GithubError({ kind: 'decode', message: 'pull.title is missing' }),
    });
    // An answer Lo couldn't read is GitHub's error, with what was wrong with it behind Details.
    expect(problemOf(error, E2E, account, 1234.6)).toEqual({
      kind: 'failed',
      cause: { kind: 'github' },
      details: "couldn't read GitHub's answer: pull.title is missing",
      retryAt: 1235,
    });
  });

  it('tells GitHub out of reach, and a rate limit, from an answer', () => {
    const network = new GithubError({ kind: 'network', failure: 'offline', message: 'offline' });
    expect(isUnreached(network)).toBe(true);
    expect(isUnreached(new Error('wrapped', { cause: network }))).toBe(true);
    expect(isUnreached(new GithubError({ kind: 'notFound', message: 'Not Found' }))).toBe(false);
    expect(rateLimitedUntil(limited({ reset: 100 }), 5)).toBe(100_000);
    expect(rateLimitedUntil(limited({ retryAfter: 30 }), 5)).toBe(30_005);
    expect(rateLimitedUntil(limited({}), 5)).toBe(60_005);
    expect(rateLimitedUntil(network, 5)).toBe(undefined);
  });
});
