import {
  Accounts,
  approvalUrl,
  GithubClient,
  Token,
  type Account,
  type Grant,
  type RepoRef,
} from '@lo/github';
import { MemoryAccountRows, MemorySecrets, replayFetch } from '@lo/testing';
import { describe, expect, it } from 'vitest';

import type { Opening } from '../../tab/contract.ts';
import {
  Browser,
  COMES_BACK_WITHIN,
  link,
  look,
  pullLinkIn,
  readLink,
  type LinkGithub,
} from './link.ts';

/** The app's pull request, rozed-dev/e2e#80, as GitHub has it in the `app_e2e` cassette. */
const E2E = 'https://github.com/rozed-dev/e2e/pull/80';
const TITLE = "App: the pull request Lo's end-to-end tests open";

/** A `fetch` that fails the test if anything is asked of GitHub. */
const nothing: typeof globalThis.fetch = (input, init) => {
  throw new Error(`Nothing should be asked of GitHub, but ${new Request(input, init).url} was.`);
};

/** A `fetch` that never reaches GitHub, as when the computer is offline. */
const offline: typeof globalThis.fetch = () =>
  Promise.reject(
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), {
        code: 'ENOTFOUND',
      }),
    }),
  );

/** GitHub's answer that a repository or pull request isn't there, or the token can't see it. */
const notFound: typeof globalThis.fetch = () =>
  Promise.resolve(
    new Response('{"message":"Not Found","status":"404"}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  );

/** A `fetch` that sends each account's requests by its token, and anonymous ones to `others`. */
function byToken(
  tokens: Readonly<Record<string, typeof globalThis.fetch>>,
  others: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (input, init) => {
    const authorization = new Request(input, init).headers.get('authorization') ?? '';
    const found = Object.entries(tokens).find(([login]) => authorization.endsWith(tokenOf(login)));
    return (found?.[1] ?? others)(input, init);
  };
}

/** An account's stand-in token, never a real one. */
function tokenOf(login: string): string {
  return `gho_FAKE_${login.toUpperCase().replaceAll('-', '_')}`;
}

/**
 * GitHub as the accounts feature provides it, signed in to `logins` through the accounts' own
 * code, so which account sees a repository is asked of GitHub as Lo asks it, through `fetch`.
 */
async function signedIn(
  logins: readonly string[],
  fetch: typeof globalThis.fetch,
): Promise<LinkGithub & { remember(owner: string, login: string): Promise<void> }> {
  const accounts = await Accounts.load({
    rows: new MemoryAccountRows<Account>(),
    secrets: new MemorySecrets<Grant>(),
    renew: () => Promise.reject(new Error('Nothing is renewed here.')),
    fetch,
    now: () => 1_793_000_000,
  });
  for (const [index, login] of logins.entries()) {
    await accounts.add(
      {
        user: { login, id: index + 1, name: null, avatar_url: null },
        scopes: ['read:org', 'repo', 'workflow'],
      },
      { token: new Token(tokenOf(login)) },
      'deviceFlow',
    );
  }
  return {
    anonymous: new GithubClient({ fetch }),
    accounts: () =>
      Promise.resolve(
        accounts.accounts.map((account) => ({
          account,
          signedOut: accounts.signedOut(account.login),
          cantSave: false,
          needsKeyring: false,
        })),
      ),
    client: (login) => accounts.client(login),
    accountForRepo: (repo: RepoRef) => accounts.accountForRepo(repo),
    remember: (owner, login) => accounts.rememberAccountForOwner(owner, login),
  };
}

/** The tabs, as far as opening a link needs them: what was opened, and as whom. */
function tabs() {
  const opened: { opening: Opening; as: { login: string } | undefined }[] = [];
  return {
    opened,
    open(opening: Opening, as?: { login: string }) {
      opened.push({ opening, as });
      return `t${opened.length}`;
    },
  };
}

/**
 * What `link` needs, with GitHub as given and a browser that keeps what it's handed: for links
 * from the window unless said otherwise, which hand the browser `https` links only.
 */
function options(github: LinkGithub, { httpsOnly = true }: { httpsOnly?: boolean } = {}) {
  const browsed: string[] = [];
  const logged: string[] = [];
  const opened = tabs();
  return {
    browsed,
    logged,
    tabs: opened,
    options: {
      github,
      tabs: opened,
      browse: (url: string) => {
        browsed.push(url);
        return Promise.resolve(undefined);
      },
      httpsOnly,
      log: (line: string) => logged.push(line),
    },
  };
}

const e2e = { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 } as const;

describe('readLink', () => {
  it.each([
    E2E,
    `${E2E}/`,
    `${E2E}/files`,
    `${E2E}/commits/`,
    `${E2E}/checks?check_run_id=1#step:2`,
    `${E2E}/files#diff-4b1e`,
    `${E2E}/commits/0123456789abcdef0123456789abcdef01234567`,
    `${E2E}/files/0123456789abcdef..fedcba9876543210`,
    'http://github.com/rozed-dev/e2e/pull/80',
    'lo://github.com/rozed-dev/e2e/pull/80',
    'LO://GitHub.com/rozed-dev/e2e/pull/80/files',
    'github.com/rozed-dev/e2e/pull/80',
    'www.github.com/rozed-dev/e2e/pull/80',
    `  ${E2E}\n`,
  ])('reads %j as rozed-dev/e2e#80', (text) => {
    expect(readLink(text)).toEqual({
      kind: 'pull',
      pull: { owner: 'rozed-dev', repo: 'e2e', number: 80 },
    });
  });

  it.each([
    ['https://github.com/rozed-dev/e2e/issues/12', true, 'issue'],
    ['https://github.com/rozed-dev/e2e', true, null],
    ['https://github.com/rozed-dev/e2e/pulls', true, 'pulls'],
    ['github.com/rozed-dev/e2e/commit/abc', true, 'commit'],
    ['https://github.com/rozed-dev/e2e/tree/main/src', true, 'folder'],
    ['https://example.com/rozed-dev/e2e/pull/80', false, null],
  ])('reads %j as a web link for the browser', (text, github, page) => {
    expect(readLink(text)).toMatchObject({ kind: 'web', github, page, secure: true });
  });

  it('reads a web link over plain http as one it won’t hand on', () => {
    expect(readLink('http://example.com/x')).toMatchObject({ kind: 'web', secure: false });
  });

  it.each([
    'rozed-dev/e2e#80',
    'not a link',
    'lo://github.com/rozed-dev/e2e/issues/12',
    'lo://example.com/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://github.com/../e2e/pull/80',
    'https://github.com/rozed-dev/e2e/pull/0',
    'https://github.com/rozed-dev/e2e/pull/99999999999',
    `${E2E}?${'x'.repeat(3000)}`,
  ])('reads no pull request in %j', (text) => {
    expect(['invalid', 'web']).toContain(readLink(text).kind);
  });

  it('says why a bad link is not one', () => {
    expect(readLink('rozed-dev/e2e#80')).toEqual({ kind: 'invalid', why: 'link' });
    expect(readLink('lo://github.com/rozed-dev/e2e/issues/12')).toEqual({
      kind: 'invalid',
      why: 'loLink',
    });
    expect(readLink(`${E2E}?${'x'.repeat(3000)}`)).toEqual({ kind: 'invalid', why: 'long' });
    expect(readLink('   ')).toEqual({ kind: 'empty' });
  });
});

describe('the clipboard', () => {
  it('gives the window a pull request link, written as Lo writes one, and nothing of the rest', () => {
    expect(pullLinkIn(E2E)).toBe(E2E);
    expect(pullLinkIn(`  ${E2E}/files?token=secret#diff-1\n`)).toBe(E2E);
    expect(pullLinkIn('lo://github.com/rozed-dev/e2e/pull/80')).toBe(E2E);
  });

  it.each([
    'gho_FAKE_TOKEN_SOMEONE_COPIED',
    `see ${E2E}`,
    `${E2E}\n${E2E}`,
    `${E2E} and my password`,
    'https://github.com/rozed-dev/e2e/issues/12',
    'https://example.com/',
    '',
    `${E2E}?${'x'.repeat(3000)}`,
  ])('gives the window nothing for %j', (text) => {
    expect(pullLinkIn(text)).toBeNull();
  });
});

describe('link', () => {
  it('opens a pull request without asking GitHub anything when Lo has no account, as nobody', async () => {
    const made = options(await signedIn([], nothing));
    expect(await link(E2E, made.options)).toEqual({ kind: 'tab', id: 't1', choice: 'none' });
    expect(made.tabs.opened).toEqual([{ opening: e2e, as: undefined }]);
  });

  it('opens a private pull request with the account that can see it', async () => {
    const made = options(await signedIn(['rozed-bot'], replayFetch('app_e2e')));
    expect(await link('lo://github.com/rozed-dev/e2e/pull/80/files', made.options)).toEqual({
      kind: 'tab',
      id: 't1',
      choice: 'account',
    });
    expect(made.tabs.opened).toEqual([{ opening: e2e, as: { login: 'rozed-bot' } }]);
  });

  it('opens a row with its account while it can see the repository, and with another once it can’t', async () => {
    const seeing = replayFetch('app_e2e');
    const github = await signedIn(
      ['old-bot', 'rozed-bot', 'work-bot'],
      byToken({ 'old-bot': notFound, 'rozed-bot': seeing, 'work-bot': seeing }, nothing),
    );
    await github.remember('rozed-dev', 'rozed-bot');
    const made = options(github);
    await link(E2E, made.options, { login: 'work-bot' });
    // The row's account lost access: Lo opens it with the one it would choose.
    await link(E2E, made.options, { login: 'old-bot' });
    expect(made.tabs.opened.map(({ as }) => as)).toEqual([
      { login: 'work-bot' },
      { login: 'rozed-bot' },
    ]);
  });

  it('leaves the question to the tab when several accounts can see the repository', async () => {
    const seeing = replayFetch('app_e2e');
    const made = options(
      await signedIn(
        ['rozed-bot', 'work-bot'],
        byToken({ 'rozed-bot': seeing, 'work-bot': seeing }, nothing),
      ),
    );
    expect(await link(E2E, made.options)).toMatchObject({ kind: 'tab', choice: 'ask' });
    expect(made.tabs.opened).toEqual([{ opening: e2e, as: undefined }]);
  });

  it('opens the tab, which says why, when an organization restricts Lo', async () => {
    const made = options(await signedIn(['rozed-bot'], replayFetch('rest_repo_oauth_restricted')));
    const opened = await link('https://github.com/rozed-dev/restricted/pull/3', made.options);
    expect(opened).toMatchObject({ kind: 'tab', choice: 'none' });
    expect(made.tabs.opened).toEqual([
      {
        opening: { kind: 'pull', owner: 'rozed-dev', repo: 'restricted', number: 3 },
        as: undefined,
      },
    ]);
  });

  it('opens the tab, which tries again, when GitHub can’t be asked', async () => {
    const made = options(await signedIn(['rozed-bot'], offline));
    expect(await link(E2E, made.options)).toMatchObject({ kind: 'tab', choice: 'unavailable' });
    expect(made.tabs.opened).toEqual([{ opening: e2e, as: undefined }]);
    expect(made.logged.join('\n')).toContain('choosing the account for rozed-dev/e2e#80');
  });

  it('opens a row with its own account while GitHub can’t be asked, if it’s signed in', async () => {
    const made = options(await signedIn(['rozed-bot'], offline));
    await link(E2E, made.options, { login: 'Rozed-Bot' });
    await link(E2E, made.options, { login: 'gone-bot' });
    expect(made.tabs.opened.map(({ as }) => as)).toEqual([{ login: 'rozed-bot' }, undefined]);
  });

  it('hands any other web link to the browser, and opens nothing for what isn’t a link', async () => {
    const made = options(await signedIn([], nothing));
    expect(await link('https://github.com/rozed-dev/e2e/issues/12', made.options)).toEqual({
      kind: 'browser',
    });
    expect(made.browsed).toEqual(['https://github.com/rozed-dev/e2e/issues/12']);
    for (const text of ['rozed-dev/e2e#80', 'lo://example.com/', 'file:///etc/passwd', '']) {
      expect(await link(text, made.options)).toMatchObject({ kind: 'refused' });
    }
    expect(made.browsed).toHaveLength(1);
    expect(made.tabs.opened).toEqual([]);
  });

  it('hands the browser no plain http link from the window, but opens an http pull request link', async () => {
    const made = options(await signedIn([], nothing));
    for (const text of ['http://example.com/', 'http://github.com/rozed-dev/e2e/issues/12']) {
      expect(await link(text, made.options)).toEqual({ kind: 'refused', why: 'insecure' });
    }
    expect(made.browsed).toEqual([]);
    expect(await link('http://github.com/rozed-dev/e2e/pull/80', made.options)).toMatchObject({
      kind: 'tab',
    });
    // From another app, as a link router hands it back, it goes on to the browser.
    const outside = options(await signedIn([], nothing), { httpsOnly: false });
    expect(await link('http://example.com/', outside.options)).toEqual({ kind: 'browser' });
    expect(outside.browsed).toEqual(['http://example.com/']);
  });
});

describe('look', () => {
  it('shows a pull request, its state and the account that opens it', async () => {
    const github = await signedIn(['rozed-bot'], replayFetch('app_e2e'));
    expect(await look(`${E2E}/files#diff-1`, github)).toEqual({
      kind: 'pull',
      owner: 'rozed-dev',
      repo: 'e2e',
      number: 80,
      as: { kind: 'account', login: 'rozed-bot' },
      title: TITLE,
      state: 'open',
    });
  });

  it('shows a public pull request read only, without signing in', async () => {
    const github = await signedIn([], replayFetch('app_e2e'));
    expect(await look(E2E, github)).toMatchObject({
      kind: 'pull',
      as: { kind: 'anonymous' },
      title: TITLE,
    });
  });

  it('says when GitHub has no such public pull request, or none of the accounts can see it', async () => {
    expect(
      await look(
        'https://github.com/rozed-dev/gone/pull/1',
        await signedIn([], replayFetch('app_e2e')),
      ),
    ).toMatchObject({ kind: 'blocked', why: { kind: 'hidden', signedIn: false } });
    const github = await signedIn(['rozed-bot'], replayFetch('app_e2e'));
    expect(await look('https://github.com/rozed-dev/gone/pull/1', github)).toMatchObject({
      kind: 'blocked',
      why: { kind: 'hidden', signedIn: true },
    });
    expect(await look('https://github.com/rozed-dev/e2e/pull/9999', github)).toMatchObject({
      kind: 'blocked',
      why: { kind: 'missing' },
    });
  });

  it('shows GitHub’s link to ask an organization that restricts Lo to approve it', async () => {
    const github = await signedIn(['rozed-bot'], replayFetch('rest_repo_oauth_restricted'));
    expect(await look('https://github.com/rozed-dev/restricted/pull/3', github)).toEqual({
      kind: 'blocked',
      owner: 'rozed-dev',
      repo: 'restricted',
      number: 3,
      why: {
        kind: 'refused',
        cause: { kind: 'unapproved', org: 'rozed-dev' },
        links: [{ label: 'Request approval on GitHub', url: approvalUrl() }],
        openAnyway: false,
      },
      details: expect.any(String),
    });
    expect(approvalUrl()).toMatch(/^https:\/\/github\.com\/settings\/connections\/applications\//);
  });

  it('asks which account when several can see the repository', async () => {
    const seeing = replayFetch('app_e2e');
    const github = await signedIn(
      ['rozed-bot', 'work-bot'],
      byToken({ 'rozed-bot': seeing, 'work-bot': seeing }, nothing),
    );
    expect(await look(E2E, github)).toMatchObject({
      kind: 'pull',
      as: { kind: 'ask', logins: ['rozed-bot', 'work-bot'], remember: 'owner' },
      title: TITLE,
    });
  });

  it('remembers the choice for the repository alone when the owner’s account can’t see it', async () => {
    const seeing = replayFetch('app_e2e');
    const github = await signedIn(
      ['old-bot', 'rozed-bot', 'work-bot'],
      byToken({ 'old-bot': notFound, 'rozed-bot': seeing, 'work-bot': seeing }, nothing),
    );
    await github.remember('rozed-dev', 'old-bot');
    expect(await look(E2E, github)).toMatchObject({
      kind: 'pull',
      as: { kind: 'ask', logins: ['rozed-bot', 'work-bot'], remember: 'repo' },
    });
  });

  it('says when GitHub’s rate limit resets, for a 403 that says the limit was reached', async () => {
    const resets = 1_793_001_800;
    const limited: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response('{"message":"API rate limit exceeded for user ID 1."}', {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resets),
            'retry-after': '1800',
          },
        }),
      );
    const preview = await look(
      'https://github.com/rozed-dev/limited/pull/1',
      await signedIn(['rozed-bot'], limited),
    );
    expect(preview).toMatchObject({
      kind: 'blocked',
      why: { kind: 'refused', cause: { kind: 'rateLimit', resets: resets * 1000 } },
    });
  });

  it('says GitHub couldn’t be asked, and that opening it tries again', async () => {
    expect(await look(E2E, await signedIn(['rozed-bot'], offline))).toMatchObject({
      kind: 'blocked',
      why: { kind: 'unchecked', cause: { kind: 'offline' } },
    });
  });

  it('says what a link that isn’t a pull request is, and asks GitHub nothing', async () => {
    const github = await signedIn([], nothing);
    expect(await look('', github)).toEqual({ kind: 'empty' });
    expect(await look('https://github.com/rozed-dev/e2e/issues/12', github)).toEqual({
      kind: 'web',
      url: 'https://github.com/rozed-dev/e2e/issues/12',
      github: true,
      page: 'issue',
      secure: true,
    });
    expect(await look('rozed-dev/e2e#80', github)).toEqual({ kind: 'invalid', why: 'link' });
    // Plain http goes nowhere: the box offers to copy it.
    expect(await look('http://example.com/x', github)).toEqual({
      kind: 'web',
      url: 'http://example.com/x',
      github: false,
      page: null,
      secure: false,
    });
  });
});

/** A browser that keeps what it's handed, on a clock the test moves on. */
function browser(isDefault = false) {
  let now = 1_000;
  const opened: string[] = [];
  const made = new Browser({
    open: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    isDefault: () => isDefault,
    now: () => now,
  });
  return { made, opened, later: (ms: number) => (now += ms) };
}

describe('Browser', () => {
  const ISSUE = 'https://github.com/rozed-dev/e2e/issues/12';

  it('hands a link to the browser, and not one that came straight back from it', async () => {
    const { made, opened, later } = browser();
    expect(await made.hand(ISSUE, { fromOutside: true })).toBeUndefined();
    expect(await made.hand(ISSUE, { fromOutside: true })).toBe('cameBack');
    // Asked for in the window, it goes again.
    expect(await made.hand(ISSUE, { fromOutside: false })).toBeUndefined();
    later(COMES_BACK_WITHIN + 1);
    expect(await made.hand(ISSUE, { fromOutside: true })).toBeUndefined();
    expect(opened).toEqual([ISSUE, ISSUE, ISSUE]);
  });

  it('hands nothing on while Lo is the default browser', async () => {
    const { made, opened } = browser(true);
    expect(await made.hand(ISSUE, { fromOutside: false })).toBe('defaultBrowser');
    expect(opened).toEqual([]);
  });
});
