import { expect, test } from 'vitest';

import {
  chooseAccount,
  chosenAccount,
  decideAccount,
  refusalCause,
  type AccountChoice,
  type AccountDecision,
  type AccountRefusal,
  type Remembered,
  type RepoAccount,
} from './choice.ts';
import { GithubError } from './errors.ts';
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

test('a remembered account that couldnt check refuses with githubs error', () => {
  const error = serverError();
  const decision = decideAccount(
    found({ kind: 'unavailable', login: 'Work' }, [
      ['other', serverError()],
      ['work', error],
    ]),
  );
  expect(decision).toEqual({
    kind: 'refuse',
    refusal: { problems: [{ login: 'work', error }], links: [], waitable: true },
  });
  expect(refusalCause(refusal(decision), 'org')).toEqual({
    cause: { kind: 'github' },
    details: 'work: 500 Internal Server Error\nServer Error',
  });
});

test('a remembered account that needs single sign on refuses with githubs link', () => {
  const said = refusal(
    decideAccount(found({ kind: 'unavailable', login: 'work' }, [['work', sso()]])),
  );
  expect(refusalCause(said, 'org').cause).toEqual({ kind: 'sso', org: 'org' });
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
  expect(refusalCause(said, 'org').cause.kind).toBe('unapproved');
  expect(said.links).toEqual([oauthRestricted().helpLink()]);
  expect(said.links[0]?.label).toBe('Request approval on GitHub');
});

test('a remembered account github said nothing of refuses with no cause', () => {
  const said = refusal(decideAccount(found({ kind: 'unavailable', login: 'work' }, [])));
  expect(refusalCause(said, 'org')).toEqual({ cause: { kind: 'unknown' }, details: undefined });
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
  // The organization's cause, since its link fixes it, and what GitHub said to each account.
  expect(refusalCause(said, 'org')).toEqual({
    cause: { kind: 'sso', org: 'org' },
    details:
      'home: API rate limit exceeded\nwork: Resource protected by organization SAML enforcement.',
  });
  expect(said.links).toEqual([sso().helpLink()]);
});

test('a token github refused during the check doesnt stop opening without signing in', () => {
  // GitHub refusing a token signs its account out, which then counts as not signed in.
  const refused = new GithubError({ kind: 'unauthorized', message: 'Bad credentials' });
  const decision = decideAccount(found({ kind: 'none' }, [['old', refused]]));
  expect(decision).toEqual({ kind: 'open', acting: { kind: 'anonymous' } });
});
