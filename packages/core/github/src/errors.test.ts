import { expect, test } from 'vitest';

import {
  classifyNetworkError,
  GithubError,
  helpLink,
  MAX_RETRY_AFTER,
  parseSsoHeader,
  type GithubErrorDetail,
  type NetworkFailure,
} from './errors.ts';
import type { GraphQLError } from './graphql.ts';

const network = (failure: NetworkFailure) =>
  new GithubError({ kind: 'network', failure, message: 'x' });

/** What Node's `fetch` throws: a `TypeError` whose cause carries the system's error code. */
function nodeFailure(code: string, message = code): unknown {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(message), { code }),
  });
}

/** What Electron's `net.fetch` throws: Chromium's network error in the message. */
function chromiumFailure(name: string): unknown {
  return new Error(`net::${name}`);
}

const api = (status: number) => new GithubError({ kind: 'api', status, message: 'x', errors: [] });

test('only a failure to connect means github cant be reached', () => {
  // A proxy that's down, and no network at all.
  for (const thrown of [
    nodeFailure('ECONNREFUSED'),
    nodeFailure('ENETDOWN'),
    nodeFailure('EHOSTUNREACH'),
    nodeFailure('ENOTFOUND', 'getaddrinfo ENOTFOUND api.github.com'),
    nodeFailure('UND_ERR_CONNECT_TIMEOUT'),
    chromiumFailure('ERR_INTERNET_DISCONNECTED'),
    chromiumFailure('ERR_NAME_NOT_RESOLVED'),
    chromiumFailure('ERR_PROXY_CONNECTION_FAILED'),
  ]) {
    expect(classifyNetworkError(thrown)).toBe('offline');
  }
  expect(network('offline').isUnreachable()).toBe(true);
  expect(network('offline').isRetryable()).toBe(true);

  // Connected, and then slow, or cut off: worth trying again, but not offline.
  for (const thrown of [
    nodeFailure('ECONNRESET'),
    nodeFailure('UND_ERR_SOCKET'),
    nodeFailure('UND_ERR_HEADERS_TIMEOUT'),
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    chromiumFailure('ERR_CONNECTION_RESET'),
    chromiumFailure('ERR_TIMED_OUT'),
  ]) {
    expect(classifyNetworkError(thrown)).toBe('lost');
  }
  expect(network('lost').isUnreachable()).toBe(false);
  expect(network('lost').isRetryable()).toBe(true);

  // A TLS failure or a proxy's refusal: waiting doesn't fix them.
  for (const thrown of [
    nodeFailure('CERT_HAS_EXPIRED'),
    nodeFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
    chromiumFailure('ERR_CERT_AUTHORITY_INVALID'),
    chromiumFailure('ERR_PROXY_AUTH_UNSUPPORTED'),
  ]) {
    expect(classifyNetworkError(thrown)).toBe('refused');
  }
  expect(network('refused').isUnreachable()).toBe(false);
  expect(network('refused').isRetryable()).toBe(false);

  // A proxy that can't open the tunnel, as when it can't reach GitHub itself.
  expect(classifyNetworkError(chromiumFailure('ERR_TUNNEL_CONNECTION_FAILED'))).toBe('tunnel');
  expect(network('tunnel').isRetryable()).toBe(true);
  expect(network('tunnel').isUnreachable()).toBe(false);

  // Waiting fixes a server error or a rate limit, not a refusal.
  expect(api(502).isWaitable()).toBe(true);
  expect(api(429).isWaitable()).toBe(true);
  expect(api(403).isWaitable()).toBe(false);
  expect(new GithubError({ kind: 'ssoRequired', message: 'x' }).isWaitable()).toBe(false);
  // Any answer.
  expect(new GithubError({ kind: 'notFound', message: 'Not Found' }).isUnreachable()).toBe(false);
});

function graphqlError(message: string, type?: string): GithubError {
  return new GithubError({ kind: 'graphql', errors: [{ message, type, path: [] }] });
}

test('a write may have been done when its answer was lost', () => {
  const graphql = graphqlError;
  // Sent, and then no answer: it may have been done.
  expect(network('lost').mayHavePosted()).toBe(true);
  // As when Lo stops before the write's answer.
  expect(classifyNetworkError(new Error('Lo stopped before the write finished'))).toBe('unknown');
  expect(network('unknown').mayHavePosted()).toBe(true);
  // Never sent: no network, or a connection that never opened.
  expect(network('offline').mayHavePosted()).toBe(false);
  expect(network('refused').mayHavePosted()).toBe(false);
  expect(network('tunnel').mayHavePosted()).toBe(false);

  expect(api(502).mayHavePosted()).toBe(true);
  expect(api(422).mayHavePosted()).toBe(false);
  expect(
    new GithubError({ kind: 'decode', message: 'the response had no data' }).mayHavePosted(),
  ).toBe(true);
  const timeout =
    'Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.';
  expect(graphql(timeout).mayHavePosted()).toBe(true);
  expect(graphql('Resource not accessible by integration', 'FORBIDDEN').mayHavePosted()).toBe(
    false,
  );
  // Refused, or never run.
  expect(
    new GithubError({ kind: 'rateLimited', message: 'x', secondary: true }).mayHavePosted(),
  ).toBe(false);
  expect(
    new GithubError({ kind: 'unauthorized', message: 'Bad credentials' }).mayHavePosted(),
  ).toBe(false);
});

const RESTRICTED =
  'Although you appear to have the correct authorization credentials, the `rozed-dev` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited. For more information on these restrictions, including how to enable this app, visit https://docs.github.com/articles/restricting-access-to-your-organization-s-data/';

function detail(error: GithubError): GithubErrorDetail {
  return error.detail;
}

test('a 401 signs the account out', () => {
  const error = GithubError.fromResponse(
    401,
    new Headers(),
    '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}',
  );
  expect(error.isUnauthorized()).toBe(true);
  expect(error.message).toBe("GitHub didn't accept the token: Bad credentials");
});

test('an account Lo has no more is not a refused token', () => {
  const error = new GithubError({
    kind: 'unauthorized',
    message: "Lo isn't signed in to rozed-bot",
    missing: 'rozed-bot',
  });
  expect(error.isUnauthorized()).toBe(true);
  expect(error.message).toBe("Lo isn't signed in to rozed-bot");
});

test('sso keeps githubs link', () => {
  const error = GithubError.fromResponse(
    403,
    new Headers({
      'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=ABC',
    }),
    '{"message":"Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization."}',
  );
  expect(detail(error)).toMatchObject({
    kind: 'ssoRequired',
    url: 'https://github.com/orgs/acme/sso?authorization_request=ABC',
  });
  expect(error.helpLink()).toEqual(
    helpLink('Authorize on GitHub', 'https://github.com/orgs/acme/sso?authorization_request=ABC'),
  );
});

function ssoError(url: string): GithubError {
  return new GithubError({ kind: 'ssoRequired', message: 'SAML', url });
}

test('help links open only https pages on github', () => {
  const sso = ssoError;
  for (const url of [
    'file:///Applications/Calculator.app',
    'x-apple-systempreferences:com.apple.preference',
    'http://github.com/orgs/acme/sso',
    'https://github.com.evil.example/orgs/acme/sso',
    'https://evil.example/github.com/orgs/acme/sso',
    'https://gist.github.com/x',
    'https://user@github.com/orgs/acme/sso',
  ]) {
    expect(sso(url).helpLink()).toBeUndefined();
  }
  const link = sso('https://github.com/orgs/acme/sso?authorization_request=X').helpLink();
  expect(link).toEqual({
    label: 'Authorize on GitHub',
    url: 'https://github.com/orgs/acme/sso?authorization_request=X',
  });
});

test('an oauth restriction names the org and links to approval', () => {
  const body = JSON.stringify({
    message: RESTRICTED,
    documentation_url:
      'https://docs.github.com/articles/restricting-access-to-your-organization-s-data/',
  });
  const error = GithubError.fromResponse(403, new Headers(), body);
  expect(detail(error)).toMatchObject({ kind: 'oauthAppRestricted', org: 'rozed-dev' });
  expect(detail(error)).toHaveProperty('documentationUrl');
  expect(error.helpLink()?.url).toBe(
    'https://github.com/settings/connections/applications/Ov23liBORqwRdiPzqsPP',
  );
});

test('rate limits are primary or secondary', () => {
  const primary = GithubError.fromResponse(
    403,
    new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1762419600' }),
    '{"message":"API rate limit exceeded for user ID 1."}',
  );
  expect(detail(primary)).toMatchObject({
    kind: 'rateLimited',
    secondary: false,
    reset: 1762419600,
  });

  const secondary = GithubError.fromResponse(
    429,
    new Headers({ 'retry-after': '60', 'x-ratelimit-remaining': '4000' }),
    '{"message":"You have exceeded a secondary rate limit."}',
  );
  expect(detail(secondary)).toMatchObject({ kind: 'rateLimited', secondary: true, retryAfter: 60 });

  // A nonsense `retry-after`, as from a proxy, waits an hour at most.
  const nonsense = GithubError.fromResponse(
    429,
    new Headers({ 'retry-after': '10000000000000000000' }),
    '{"message":"You have exceeded a secondary rate limit."}',
  );
  expect(detail(nonsense)).toMatchObject({ kind: 'rateLimited', retryAfter: MAX_RETRY_AFTER });
});

/** GraphQL's rate limit error, with `remaining` of the limit left. */
function graphqlRateLimited(remaining: string): GithubError {
  return GithubError.fromGraphQL(
    [{ message: 'API rate limit exceeded', type: 'RATE_LIMITED', path: [] }],
    new Headers({ 'x-ratelimit-remaining': remaining, 'x-ratelimit-resource': 'graphql' }),
  );
}

test('rate limits name the limit hit', () => {
  const usedUp = GithubError.fromResponse(
    403,
    new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-resource': 'search' }),
    '{"message":"API rate limit exceeded for user ID 1."}',
  );
  expect(detail(usedUp)).toMatchObject({
    kind: 'rateLimited',
    resource: 'search',
    secondary: false,
  });
  const graphql = graphqlRateLimited;
  // GraphQL's limit used up, or GitHub's secondary limits with some of it left.
  expect(detail(graphql('0'))).toMatchObject({
    kind: 'rateLimited',
    resource: 'graphql',
    secondary: false,
  });
  expect(detail(graphql('4000'))).toMatchObject({ kind: 'rateLimited', secondary: true });
});

test('other errors keep githubs message and link', () => {
  const error = GithubError.fromResponse(
    422,
    new Headers(),
    '{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom"}],"documentation_url":"https://docs.github.com/rest/pulls"}',
  );
  expect(detail(error)).toEqual({
    kind: 'api',
    status: 422,
    message: 'Validation Failed',
    documentationUrl: 'https://docs.github.com/rest/pulls',
    errors: [{ resource: 'PullRequest', code: 'custom' }],
  });

  const notFound = GithubError.fromResponse(
    404,
    new Headers(),
    '{"message":"Not Found","status":"404"}',
  );
  expect(notFound.detail.kind).toBe('notFound');

  expect(GithubError.fromResponse(502, new Headers(), 'Bad gateway').message).toBe(
    'GitHub answered 502: Bad gateway',
  );

  // A whole web page isn't a message.
  const page = `<!DOCTYPE html>\n<html>${'<p>Unicorn!</p>'.repeat(500)}</html>`;
  expect(GithubError.fromResponse(503, new Headers(), page).message).toBe(
    'GitHub answered 503: (an HTML page)',
  );
  const long = GithubError.fromResponse(500, new Headers(), 'x '.repeat(500));
  expect(Array.from(long.message).length).toBeLessThan(250);
});

function graphqlErrors(json: string): GraphQLError[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('not a list');
  return parsed.map((value: Record<string, unknown>) => ({
    message: typeof value['message'] === 'string' ? value['message'] : '',
    type: typeof value['type'] === 'string' ? value['type'] : undefined,
    path: Array.isArray(value['path'])
      ? value['path'].filter((part) => typeof part === 'string')
      : [],
    extensions: value['extensions'],
  }));
}

test('graphql errors map by type and message', () => {
  const notFound = GithubError.fromGraphQL(
    graphqlErrors(
      `[{"type":"NOT_FOUND","path":["repository"],"message":"Could not resolve to a Repository with the name 'rozed-dev/nope'."}]`,
    ),
    new Headers(),
  );
  expect(notFound.detail.kind).toBe('notFound');

  const restricted = GithubError.fromGraphQL(
    graphqlErrors(JSON.stringify([{ type: 'FORBIDDEN', message: RESTRICTED }])),
    new Headers(),
  );
  expect(detail(restricted)).toMatchObject({ kind: 'oauthAppRestricted', org: 'rozed-dev' });

  const sso = GithubError.fromGraphQL(
    graphqlErrors(
      '[{"type":"FORBIDDEN","message":"Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization."}]',
    ),
    new Headers({ 'x-github-sso': 'required; url=https://github.com/orgs/a/sso' }),
  );
  expect(detail(sso)).toMatchObject({ kind: 'ssoRequired', url: 'https://github.com/orgs/a/sso' });

  const other = GithubError.fromGraphQL(
    graphqlErrors(
      `[{"path":["query","nope"],"extensions":{"code":"undefinedField"},"message":"Field 'nope' doesn't exist on type 'PullRequest'"}]`,
    ),
    new Headers(),
  );
  expect(other.message).toBe("Field 'nope' doesn't exist on type 'PullRequest'");
});

test('graphql errors are classified by all of them', () => {
  // An organization's restriction on a fork, after an unrelated error, still reads as the
  // restriction, with its link.
  const restricted = GithubError.fromGraphQL(
    [
      { type: 'NOT_FOUND', path: ['repository', 'pullRequest', 'author'], message: 'gone' },
      {
        type: 'FORBIDDEN',
        path: ['repository', 'pullRequest', 'headRepository'],
        message: RESTRICTED,
      },
    ],
    new Headers(),
  );
  expect(detail(restricted)).toMatchObject({ kind: 'oauthAppRestricted', org: 'rozed-dev' });
  // Single sign-on comes before a restriction.
  const sso = GithubError.fromGraphQL(
    [
      { type: 'FORBIDDEN', message: RESTRICTED, path: [] },
      {
        type: 'FORBIDDEN',
        message:
          'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
        path: [],
      },
    ],
    new Headers(),
  );
  expect(sso.detail.kind).toBe('ssoRequired');
  // A rate limit after another error, with how long GitHub asked to wait.
  const limited = GithubError.fromGraphQL(
    [
      { type: 'NOT_FOUND', message: 'gone', path: [] },
      { type: 'RATE_LIMITED', message: 'API rate limit exceeded', path: [] },
    ],
    new Headers({ 'retry-after': '30', 'x-ratelimit-reset': '1762419600' }),
  );
  expect(detail(limited)).toMatchObject({
    kind: 'rateLimited',
    message: 'API rate limit exceeded',
    retryAfter: 30,
    reset: 1762419600,
  });
});

test('parses the sso header', () => {
  expect(parseSsoHeader('partial-results; organizations=21955855,20582480')).toEqual({
    required: false,
    organizations: [21955855, 20582480],
  });
  expect(parseSsoHeader('something else')).toBeUndefined();
});

test('an error Lo can’t put in words keeps its detail and cause, with a plain message', () => {
  // A kind this build of Lo doesn't know, and a known one without what describing it reads.
  const details: GithubErrorDetail[] = JSON.parse('[{ "kind": "mystery" }, { "kind": "graphql" }]');
  for (const given of details) {
    const cause = new Error('the failure it reports');
    const error = new GithubError(given, { cause });
    expect(error.message).toBe("GitHub gave an error Lo couldn't describe");
    expect(error.detail).toBe(given);
    expect(error.cause).toBe(cause);
  }
});
