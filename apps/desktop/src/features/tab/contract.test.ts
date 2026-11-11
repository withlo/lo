import { describe, expect, it } from 'vitest';

import { choice, COPY_LIMIT, contract, isGithubPage, opening, pull } from './contract.ts';

describe("the tab feature's contract", () => {
  it('opens a pull request by an owner, repository and number GitHub allows, or Settings', () => {
    const fd = { kind: 'pull', owner: 'sharkdp', repo: 'fd', number: 2212 };
    expect(opening.parse(fd)).toEqual(fd);
    expect(opening.parse({ kind: 'settings' })).toEqual({ kind: 'settings' });
    const refused = [
      // Names that would leave the cache's folders, or that GitHub doesn't allow.
      { ...fd, repo: '..' },
      { ...fd, repo: 'fd/pull/1' },
      { ...fd, owner: '-sharkdp' },
      { ...fd, owner: 'shark dp' },
      // Numbers GitHub can't hold.
      { ...fd, number: 0 },
      { ...fd, number: 2 ** 31 },
      { ...fd, number: 1.5 },
      // Recent opens by itself, and nothing else is a kind.
      { kind: 'recent' },
      { kind: 'file' },
      // Keys it doesn't name.
      { ...fd, title: 'Honor explicit use-jemalloc requests' },
      { kind: 'settings', section: 'keys' },
    ];
    expect(refused.filter((input) => opening.safeParse(input).success)).toEqual([]);
  });

  it('shows a tab by its id, its place, the last or a step, one at a time', () => {
    for (const input of [{ id: 't1' }, { position: 1 }, { last: true }, { step: -1 }]) {
      expect(choice.parse(input)).toEqual(input);
    }
    const refused = [{ position: 0 }, { step: 2 }, { last: false }, { id: 't1', position: 1 }, {}];
    expect(refused.filter((input) => choice.safeParse(input).success)).toEqual([]);
  });

  it('closes a tab by its id, or the one on screen', () => {
    const { input } = contract.requests.close;
    expect(input.parse({})).toEqual({});
    expect(input.parse({ id: 't1' })).toEqual({ id: 't1' });
    expect(input.safeParse({ id: '' }).success).toBe(false);
  });

  it('opens only pages on github.com, over HTTPS, in the browser', () => {
    const { input } = contract.requests.openExternal;
    const allowed = [
      'https://github.com/rozed-dev/e2e/pull/78',
      'https://github.com/orgs/rozed-dev/sso?authorization_request=x',
      'https://github.com',
    ];
    for (const url of allowed) {
      expect(isGithubPage(url), url).toBe(true);
      expect(input.safeParse({ url }).success, url).toBe(true);
    }
    const refused = [
      'http://github.com/rozed-dev/e2e',
      'https://github.com.evil.example/',
      'https://evil.example/https://github.com/',
      'https://api.github.com/user',
      'https://gist.github.com/x',
      'https://github.com:8443/x',
      'https://user:pass@github.com/x',
      'https://user@github.com/x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'lo://github.com/rozed-dev/e2e/pull/78',
      'not a url',
      '',
    ];
    expect(refused.filter(isGithubPage)).toEqual([]);
    expect(refused.filter((url) => input.safeParse({ url }).success)).toEqual([]);
    expect(input.safeParse({ url: allowed[0], then: 'more' }).success).toBe(false);
  });

  it('copies 1 MiB of text at most, as UTF-8', () => {
    const { input } = contract.requests.copy;
    expect(input.safeParse({ text: 'a'.repeat(COPY_LIMIT) }).success).toBe(true);
    expect(input.safeParse({ text: 'a'.repeat(COPY_LIMIT + 1) }).success).toBe(false);
    // Each of these is 3 bytes in UTF-8, so a third as many fit.
    expect(input.safeParse({ text: '…'.repeat(COPY_LIMIT / 2) }).success).toBe(false);
    expect(input.safeParse({ text: '' }).success).toBe(true);
    expect(input.safeParse({ text: 1 }).success).toBe(false);
  });

  it('asks about, reloads, retries and chooses for a tab by its id, and an account by its login', () => {
    for (const name of ['state', 'reload', 'retry'] as const) {
      const { input } = contract.requests[name];
      expect(input.parse({ id: 't1' })).toEqual({ id: 't1' });
      expect(input.safeParse({}).success).toBe(false);
    }
    const { input } = contract.requests.choose;
    expect(input.parse({ id: 't1', login: 'rozed-bot' })).toEqual({ id: 't1', login: 'rozed-bot' });
    expect(input.safeParse({ id: 't1', login: 'not a login' }).success).toBe(false);
  });

  it('sends a pull request’s tab as main has it, refusing what it doesn’t name', () => {
    const view = {
      id: 't1',
      loading: false,
      acting: { kind: 'account', login: 'rozed-bot' },
      header: {
        title: 'A title',
        state: 'open',
        author: null,
        head: { branch: 'app/head', fork: null },
        base: { branch: 'app/base' },
      },
      connection: { kind: 'offline', savedAt: 1, retryAt: null, error: 'offline' },
      problem: null,
      shown: '5530830f535b2947f1b50a184dc58a9c7b2845ad',
      newer: null,
    };
    expect(pull.parse(view)).toEqual(view);
    expect(pull.safeParse({ ...view, token: 'x' }).success).toBe(false);
    expect(pull.safeParse({ ...view, shown: 'main' }).success).toBe(false);
  });
});
