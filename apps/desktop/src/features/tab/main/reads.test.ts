import {
  approvalUrl,
  GithubClient,
  GithubError,
  PullRef,
  type PollStatus,
  type PullSummary,
  type RepoAccount,
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
  restrictedMessage,
  restrictingOrg,
  summaryState,
  withSummary,
} from './reads.ts';

const URLS = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};
const E2E = new PullRef('rozed-dev', 'e2e', 78);

const summary = (change: Partial<PullSummary> = {}): PullSummary => ({
  number: 78,
  title: 'A title',
  state: 'open',
  draft: false,
  updated_at: '2026-11-11T10:20:00Z',
  head: { ref: 'app/head', sha: 'a'.repeat(40) },
  base: { ref: 'app/base', sha: 'b'.repeat(40) },
  ...change,
});

describe('reading a pull request to open it', () => {
  it('reads both of GitHub’s views of it in one request, and its header from them', async () => {
    const fetch = replayFetch('app_e2e');
    const opened = await readPull(new GithubClient({ fetch, urls: URLS }), E2E);
    expect(fetch.seen.map(({ url }) => url)).toEqual([
      'https://api.github.com/repos/rozed-dev/e2e/pulls/78',
    ]);
    expect(opened.toOpen.base.repo.full_name).toBe('rozed-dev/e2e');
    expect(headerFromOpened(opened)).toEqual({
      title: "App: the pull request Lo's end-to-end tests open",
      state: 'open',
      author: 'rozed-bot',
      head: { branch: 'app/head', fork: null },
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
    expect(headerFromOpened(fork).head).toEqual({ branch: 'app/head', fork: 'someone/e2e' });
  });

  it("fails as GitHub's not found for a pull request it doesn't have", async () => {
    const error = await readPull(
      new GithubClient({ fetch: replayFetch('app_e2e'), urls: URLS }),
      new PullRef('rozed-dev', 'e2e', 9999),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GithubError);
    expect(problemOf(error, E2E, { kind: 'account', login: 'rozed-bot' }, undefined)).toEqual({
      kind: 'notFound',
      message: "GitHub has no pull request rozed-dev/e2e#78, or rozed-bot can't see it.",
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
      head: { branch: 'app/head', fork: 'someone/e2e' },
      base: { branch: 'app/base' },
    });
    expect(withSummary(undefined, summary()).author).toBe(null);
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
    expect(connectionOf('rozed-bot', status(), 1)).toEqual({ kind: 'live' });
  });

  it('says the worst of what is: signed out, then the limit used up, then offline, then a low limit', () => {
    const offline = { since: 1, retryAt: 2_000.4, error: 'GitHub can’t be reached' };
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
      connectionOf('rozed-bot', status({ signedOut: true, offline, rateLimit: paused }), 1),
    ).toEqual({ kind: 'signedOut', login: 'rozed-bot' });
    expect(connectionOf('rozed-bot', status({ offline, rateLimit: paused }), 1)).toEqual({
      kind: 'rateLimited',
      login: 'rozed-bot',
      until: 9_000,
      secondary: true,
    });
    expect(connectionOf('rozed-bot', status({ offline, rateLimit: low }), 1_500)).toEqual({
      kind: 'offline',
      savedAt: 1_500,
      retryAt: 2_000,
      error: 'GitHub can’t be reached',
    });
    expect(connectionOf('rozed-bot', status({ offline }), undefined)).toMatchObject({
      savedAt: null,
    });
    expect(connectionOf('rozed-bot', status({ rateLimit: low }), 1)).toEqual({
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
    expect(problemOf(missing, E2E, { kind: 'anonymous', canSignIn: true }, 5)).toEqual({
      kind: 'notFound',
      message:
        "GitHub has no public pull request rozed-dev/e2e#78. If it's private, sign in with an account that can see it.",
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
      message:
        "rozed-dev hasn't approved Lo, so GitHub hides its repositories from Lo. Ask for approval on GitHub, and GitHub emails rozed-dev's owners.",
      links: [{ label: 'Request approval on GitHub', url: approvalUrl() }],
    });
    const found = (choice: RepoAccount['choice'], login = 'rozed-bot'): RepoAccount => ({
      repo: E2E.repo,
      choice,
      visible: [],
      remembered: {},
      problems: [{ login, error: restricted }],
    });
    expect(restrictingOrg(found({ kind: 'none' }))).toBe('rozed-dev');
    expect(restrictingOrg(found({ kind: 'unavailable', login: 'rozed-bot' }))).toBe('rozed-dev');
    // The chosen account's own problem is what counts.
    expect(restrictingOrg(found({ kind: 'unavailable', login: 'work-bot' }))).toBeUndefined();
    expect(restrictedMessage('acme')).toContain("acme hasn't approved Lo");
  });

  it('says anything else failed, and when Lo tries again', () => {
    const error = new Error('the answer made no sense', {
      cause: new GithubError({ kind: 'decode', message: 'pull.title is missing' }),
    });
    expect(problemOf(error, E2E, account, 1234.6)).toEqual({
      kind: 'failed',
      message: "Lo couldn't read rozed-dev/e2e#78: the answer made no sense",
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
