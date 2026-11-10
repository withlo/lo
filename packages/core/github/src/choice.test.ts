import { expect, test } from 'vitest';

import {
  chooseAccount,
  chosenAccount,
  decideAccount,
  type AccountChoice,
  type AccountDecision,
  type AccountRefusal,
  type Remembered,
  type RepoAccount,
} from './choice.ts';
import { approvalUrl, GithubError } from './errors.ts';
import { RepoRef } from './refs.ts';

/** What's remembered when only the owner's account was chosen. */
function owner(login: string): Remembered {
  return { owner: login };
}

test('choosing an account', () => {
  expect(chooseAccount([], owner('a'))).toEqual({ kind: 'none' });
  expect(chooseAccount(['a'], owner('b'))).toEqual({ kind: 'account', login: 'a' });
  expect(chooseAccount(['a', 'b'], owner('B'))).toEqual({ kind: 'account', login: 'b' });
  expect(chooseAccount(['a', 'b'], owner('c'))).toEqual({ kind: 'ask', logins: ['a', 'b'] });
  expect(chooseAccount(['a', 'b'], {})).toEqual({ kind: 'ask', logins: ['a', 'b'] });
  // The repository's own account wins over its owner's, while it can see it.
  const both: Remembered = { repo: 'c', owner: 'a' };
  expect(chooseAccount(['a', 'b', 'c'], both)).toEqual({ kind: 'account', login: 'c' });
  expect(chooseAccount(['a', 'b'], both)).toEqual({ kind: 'account', login: 'a' });
  expect(chosenAccount(both)).toBe('c');
  expect(chosenAccount(owner('a'))).toBe('a');
});

function found(choice: AccountChoice, problems: [string, GithubError][]): RepoAccount {
  return {
    repo: new RepoRef('org', 'repo'),
    choice,
    visible: [],
    remembered: {},
    problems: problems.map(([login, error]) => ({ login, error })),
  };
}

function serverError(): GithubError {
  return new GithubError({ kind: 'api', status: 500, message: 'Server Error', errors: [] });
}

function sso(): GithubError {
  return new GithubError({
    kind: 'ssoRequired',
    message: 'Resource protected by organization SAML enforcement.',
    url: 'https://github.com/orgs/org/sso?authorization_request=abc',
  });
}

function oauthRestricted(): GithubError {
  return new GithubError({
    kind: 'oauthAppRestricted',
    message:
      'Although you appear to have the correct authorization credentials, the `org` organization has enabled OAuth App access restrictions.',
    org: 'org',
  });
}

function refusal(decision: AccountDecision): AccountRefusal {
  if (decision.kind !== 'refuse') throw new Error(`expected a refusal, got ${decision.kind}`);
  return decision.refusal;
}

test('without an accounts database it opens without signing in', () => {
  expect(decideAccount(undefined)).toEqual({ kind: 'open', acting: { kind: 'anonymous' } });
});

test('the account that can see the repository opens it', () => {
  const decision = decideAccount(found({ kind: 'account', login: 'rozed-bot' }, []));
  expect(decision).toEqual({ kind: 'open', acting: { kind: 'account', login: 'rozed-bot' } });
});

test('when no account can see it it opens without signing in', () => {
  const decision = decideAccount(found({ kind: 'none' }, []));
  expect(decision).toEqual({ kind: 'open', acting: { kind: 'anonymous' } });
});

test('several accounts with none chosen for the owner means asking', () => {
  const decision = decideAccount(found({ kind: 'ask', logins: ['a', 'b'] }, []));
  expect(decision).toEqual({ kind: 'ask', logins: ['a', 'b'] });
});

test('a remembered account that couldnt check refuses with githubs reason', () => {
  const decision = decideAccount(
    found({ kind: 'unavailable', login: 'Work' }, [
      ['other', serverError()],
      ['work', serverError()],
    ]),
  );
  expect(decision).toEqual({
    kind: 'refuse',
    refusal: {
      message:
        "Work, the account Lo uses for org, couldn't check org/repo: GitHub answered 500: Server Error",
      links: [],
      waitable: true,
    },
  });
});

test('a repositorys own account that couldnt check says its the repositorys', () => {
  const personal = found({ kind: 'unavailable', login: 'personal' }, [['personal', serverError()]]);
  personal.remembered = { repo: 'personal', owner: 'work' };
  expect(refusal(decideAccount(personal)).message).toBe(
    "personal, the account Lo uses for org/repo, couldn't check org/repo: GitHub answered 500: Server Error",
  );
});

test('messages name the repository as github does now', () => {
  const moved = found({ kind: 'unavailable', login: 'work' }, [['work', serverError()]]);
  moved.repo = new RepoRef('bigorg', 'tool');
  expect(refusal(decideAccount(moved)).message).toMatch(
    /^work, the account Lo uses for bigorg, couldn't check bigorg\/tool/,
  );
});

test('a remembered account that needs single sign on refuses with githubs link', () => {
  const said = refusal(
    decideAccount(found({ kind: 'unavailable', login: 'work' }, [['work', sso()]])),
  );
  expect(said.message).toBe(
    "work, the account Lo uses for org, couldn't check org/repo: Resource protected by organization SAML enforcement. (https://github.com/orgs/org/sso?authorization_request=abc)",
  );
  expect(said.links.map((link) => link.url)).toEqual([
    'https://github.com/orgs/org/sso?authorization_request=abc',
  ]);
  // Only authorizing fixes it, so Lo doesn't keep trying.
  expect(said.waitable).toBe(false);
});

test('a remembered account an organization restricts refuses with the approval link', () => {
  const said = refusal(
    decideAccount(found({ kind: 'unavailable', login: 'work' }, [['work', oauthRestricted()]])),
  );
  expect(said.message.endsWith(`(${approvalUrl()})`)).toBe(true);
  expect(said.links).toEqual([oauthRestricted().helpLink()]);
  expect(said.links[0]?.label).toBe('Request approval on GitHub');
});

test('when no account can check it and github said why it refuses rather than open anonymously', () => {
  const rateLimited = new GithubError({
    kind: 'rateLimited',
    message: 'API rate limit exceeded',
    secondary: false,
    resource: 'core',
  });
  const said = refusal(
    decideAccount(
      found({ kind: 'none' }, [
        ['home', rateLimited],
        ['work', sso()],
      ]),
    ),
  );
  expect(said.message).toBe(
    "No account Lo is signed in to could check org/repo, so it didn't open without signing in. home: GitHub's rate limit was hit: API rate limit exceeded; work: Resource protected by organization SAML enforcement. (https://github.com/orgs/org/sso?authorization_request=abc)",
  );
  expect(said.links).toEqual([sso().helpLink()]);
});

test('a token github refused during the check doesnt stop opening without signing in', () => {
  // GitHub refusing a token signs its account out, which then counts as not signed in.
  const refused = new GithubError({ kind: 'unauthorized', message: 'Bad credentials' });
  const decision = decideAccount(found({ kind: 'none' }, [['old', refused]]));
  expect(decision).toEqual({ kind: 'open', acting: { kind: 'anonymous' } });
});
