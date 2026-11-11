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

/** The app's pull request, rozed-dev/e2e#78, as GitHub has it in the `app_e2e` cassette. */
const E2E = 'https://github.com/rozed-dev/e2e/pull/78';
const TITLE = "App: the pull request Lo's end-to-end tests open";

/** A `fetch` that fails the test if anything is asked of GitHub. */
const nothing: typeof globalThis.fetch = (input, init) => {
  throw new Error(`Nothing should be asked of GitHub, but ${new Request(input, init).url} was.`);
};

/** A `fetch` that never reaches GitHub, as when the computer is offline. */
const offline: typeof globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));

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

/** What `link` needs, with GitHub as given and a browser that keeps what it's handed. */
function options(github: LinkGithub) {
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
      log: (line: string) => logged.push(line),
    },
  };
}

const e2e = { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 78 } as const;

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
    'http://github.com/rozed-dev/e2e/pull/78',
    'lo://github.com/rozed-dev/e2e/pull/78',
    'LO://GitHub.com/rozed-dev/e2e/pull/78/files',
    'github.com/rozed-dev/e2e/pull/78',
    'www.github.com/rozed-dev/e2e/pull/78',
    `  ${E2E}\n`,
  ])('reads %j as rozed-dev/e2e#78', (text) => {
    expect(readLink(text)).toEqual({
      kind: 'pull',
      pull: { owner: 'rozed-dev', repo: 'e2e', number: 78 },
    });
  });

  it.each([
    ['https://github.com/rozed-dev/e2e/issues/12', 'That’s an issue, not a pull request'],
    ['https://github.com/rozed-dev/e2e', 'That isn’t a pull request'],
    [
      'https://github.com/rozed-dev/e2e/pulls',
      'That’s the list of pull requests, not a pull request',
    ],
    ['github.com/rozed-dev/e2e/commit/abc', 'That’s a commit, not a pull request'],
    ['https://example.com/rozed-dev/e2e/pull/78', 'That isn’t a link to GitHub'],
  ])('reads %j as a web link for the browser: %s', (text, title) => {
    const read = readLink(text);
    expect(read).toMatchObject({ kind: 'web', title });
    expect(read.kind === 'web' && read.message).toContain('This one goes to your browser.');
  });

  it.each([
    'rozed-dev/e2e#78',
    'not a link',
    'lo://github.com/rozed-dev/e2e/issues/12',
    'lo://example.com/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://github.com/../e2e/pull/78',
    'https://github.com/rozed-dev/e2e/pull/0',
    'https://github.com/rozed-dev/e2e/pull/99999999999',
    `${E2E}?${'x'.repeat(3000)}`,
  ])('reads no pull request in %j', (text) => {
    expect(['invalid', 'web']).toContain(readLink(text).kind);
  });

  it('says a bad link is not one, and what a good one looks like', () => {
    expect(readLink('rozed-dev/e2e#78')).toEqual({
      kind: 'invalid',
      message: 'Lo opens links to pull requests, such as https://github.com/owner/repo/pull/123.',
    });
    expect(readLink('lo://github.com/rozed-dev/e2e/issues/12')).toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('lo:// links to pull requests only'),
    });
    expect(readLink('   ')).toEqual({ kind: 'empty' });
  });
});

describe('the clipboard', () => {
  it('gives the window a pull request link, written as Lo writes one, and nothing of the rest', () => {
    expect(pullLinkIn(E2E)).toBe(E2E);
    expect(pullLinkIn(`  ${E2E}/files?token=secret#diff-1\n`)).toBe(E2E);
    expect(pullLinkIn('lo://github.com/rozed-dev/e2e/pull/78')).toBe(E2E);
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
    expect(await link('lo://github.com/rozed-dev/e2e/pull/78/files', made.options)).toEqual({
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
    expect(made.logged.join('\n')).toContain('choosing the account for rozed-dev/e2e#78');
  });

  it('hands any other web link to the browser, and opens nothing for what isn’t a link', async () => {
    const made = options(await signedIn([], nothing));
    expect(await link('https://github.com/rozed-dev/e2e/issues/12', made.options)).toEqual({
      kind: 'browser',
    });
    expect(made.browsed).toEqual(['https://github.com/rozed-dev/e2e/issues/12']);
    for (const text of ['rozed-dev/e2e#78', 'lo://example.com/', 'file:///etc/passwd', '']) {
      expect(await link(text, made.options)).toMatchObject({ kind: 'refused' });
    }
    expect(made.browsed).toHaveLength(1);
    expect(made.tabs.opened).toEqual([]);
  });
});

describe('look', () => {
  it('shows a pull request, its state and the account that opens it', async () => {
    const github = await signedIn(['rozed-bot'], replayFetch('app_e2e'));
    expect(await look(`${E2E}/files#diff-1`, github)).toEqual({
      kind: 'pull',
      owner: 'rozed-dev',
      repo: 'e2e',
      number: 78,
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
    ).toMatchObject({
      kind: 'blocked',
      title: 'GitHub has no public pull request rozed-dev/gone#1',
      message: 'If it’s private, sign in with an account that can see it.',
      signIn: true,
      openAnyway: false,
    });
    const github = await signedIn(['rozed-bot'], replayFetch('app_e2e'));
    expect(await look('https://github.com/rozed-dev/gone/pull/1', github)).toMatchObject({
      kind: 'blocked',
      title: 'None of your accounts can see rozed-dev/gone',
      message: 'It’s private, or it doesn’t exist. Sign in with an account that has access.',
      signIn: true,
    });
    expect(await look('https://github.com/rozed-dev/e2e/pull/9999', github)).toMatchObject({
      kind: 'blocked',
      title: 'GitHub has no pull request rozed-dev/e2e#9999',
      signIn: false,
    });
  });

  it('shows GitHub’s link to ask an organization that restricts Lo to approve it', async () => {
    const github = await signedIn(['rozed-bot'], replayFetch('rest_repo_oauth_restricted'));
    expect(await look('https://github.com/rozed-dev/restricted/pull/3', github)).toEqual({
      kind: 'blocked',
      owner: 'rozed-dev',
      repo: 'restricted',
      number: 3,
      title: 'rozed-dev hasn’t approved Lo',
      message:
        'rozed-dev restricts third-party apps, so GitHub hides its repositories from Lo. An owner has to approve Lo first: ask for it on GitHub, and GitHub emails rozed-dev’s owners.',
      links: [{ label: 'Request approval on GitHub', url: approvalUrl() }],
      signIn: true,
      openAnyway: false,
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
      as: { kind: 'ask', logins: ['rozed-bot', 'work-bot'] },
      title: TITLE,
    });
  });

  it('says GitHub couldn’t be asked, and that opening it tries again', async () => {
    expect(await look(E2E, await signedIn(['rozed-bot'], offline))).toMatchObject({
      kind: 'blocked',
      title: 'Lo couldn’t ask GitHub about rozed-dev/e2e#78',
      openAnyway: true,
    });
  });

  it('says what a link that isn’t a pull request is, and asks GitHub nothing', async () => {
    const github = await signedIn([], nothing);
    expect(await look('', github)).toEqual({ kind: 'empty' });
    expect(await look('https://github.com/rozed-dev/e2e/issues/12', github)).toMatchObject({
      kind: 'web',
      url: 'https://github.com/rozed-dev/e2e/issues/12',
      title: 'That’s an issue, not a pull request',
    });
    expect(await look('rozed-dev/e2e#78', github)).toMatchObject({ kind: 'invalid' });
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
    expect(await made.hand(ISSUE, { fromOutside: true })).toContain('came straight back');
    // Asked for in the window, it goes again.
    expect(await made.hand(ISSUE, { fromOutside: false })).toBeUndefined();
    later(COMES_BACK_WITHIN + 1);
    expect(await made.hand(ISSUE, { fromOutside: true })).toBeUndefined();
    expect(opened).toEqual([ISSUE, ISSUE, ISSUE]);
  });

  it('hands nothing on while Lo is the default browser', async () => {
    const { made, opened } = browser(true);
    expect(await made.hand(ISSUE, { fromOutside: false })).toContain('Lo is your default browser');
    expect(opened).toEqual([]);
  });
});
