import { Replay, replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import type { FetchInit } from './client.ts';
import { CLIENT_ID } from './errors.ts';
import { RenewalError, type Grant } from './grant.ts';
import {
  ACCESS_TOKEN_PATH,
  grantFrom,
  nowSeconds,
  parseRefresh,
  readTokenAnswer,
  refreshGrant,
  type TokenAnswer,
} from './refresh.ts';
import { Token } from './token.ts';

const NOW = 1_800_000_000;

/** A grant with its tokens shown, to compare: a {@link Token} hides itself from `toEqual`. */
function exposed(grant: Grant | undefined) {
  return (
    grant && {
      token: grant.token.expose(),
      refresh: grant.refresh && { ...grant.refresh, token: grant.refresh.token.expose() },
    }
  );
}

/** What renewing with `status` and `body` threw. */
function refusal(status: number, body: string): RenewalError {
  try {
    parseRefresh(status, body, NOW);
  } catch (error) {
    if (error instanceof RenewalError) return error;
    throw error;
  }
  throw new Error(`HTTP ${status} renewed the token`);
}

function answer(body: string): TokenAnswer {
  const read = readTokenAnswer(body);
  if (read === undefined) throw new Error(`not a token answer: ${body}`);
  return read;
}

test('a refresh answer renews both tokens', () => {
  const body =
    '{"access_token":"gho_NEW","expires_in":28800,"refresh_token":"ghr_NEW","refresh_token_expires_in":15638400,"scope":"read:org,repo,workflow","token_type":"bearer"}';
  expect(exposed(parseRefresh(200, body, NOW))).toEqual({
    token: 'gho_NEW',
    refresh: {
      token: 'ghr_NEW',
      issuedAt: NOW,
      expiresAt: NOW + 28800,
      refreshTokenExpiresAt: NOW + 15638400,
    },
  });
});

test('githubs refusals and failures are told apart', () => {
  const refused = refusal(
    200,
    '{"error":"bad_refresh_token","error_description":"The refresh token passed is incorrect or expired."}',
  );
  expect(refused.kind).toBe('refused');
  expect(refused.message).toBe(
    'GitHub refused to renew the token: The refresh token passed is incorrect or expired.',
  );
  // The codes GitHub documents for a renewal refuse it even on their own, with any status GitHub
  // may send them with.
  for (const status of [200, 400, 401]) {
    for (const error of [
      'bad_refresh_token',
      'unsupported_grant_type',
      'incorrect_client_credentials',
      'unverified_user_email',
    ]) {
      expect({ status, error, kind: refusal(status, `{"error":"${error}"}`).kind }).toEqual({
        status,
        error,
        kind: 'refused',
      });
    }
  }
  // GitHub can't answer, or something in the way answers instead of it: a redirect to a login
  // page, a firewall, a proxy that wants a password, or one that answers a bare 400 or 401, or an
  // error code GitHub doesn't document, on its own. None of that refuses the token.
  for (const [status, body] of [
    [400, '{}'],
    [401, '{}'],
    [400, ''],
    [401, '<html>Unauthorized</html>'],
    [401, '{"error":"invalid_token"}'],
    [200, '{"error":"invalid_grant"}'],
    [200, '{"error":"temporarily_unavailable"}'],
    [200, '{}'],
    [200, 'not json'],
    [502, '<html>Unicorn!</html>'],
    [429, '<html>Unicorn!</html>'],
    [301, '<html>Unicorn!</html>'],
    [302, '<html>Unicorn!</html>'],
    [307, '<html>Unicorn!</html>'],
    [403, '<html>Unicorn!</html>'],
    [404, '<html>Unicorn!</html>'],
    [407, '<html>Unicorn!</html>'],
    // GitHub's own words, but with a status it doesn't answer a renewal with.
    [
      403,
      '{"error":"bad_refresh_token","error_description":"The refresh token passed is incorrect or expired."}',
    ],
  ] as const) {
    expect({ status, body, kind: refusal(status, body).kind }).toEqual({
      status,
      body,
      kind: 'unavailable',
    });
  }
});

test('an unknown error in githubs own shape is refused', () => {
  // Linking into GitHub's docs, an error is GitHub's own word, and every error GitHub documents
  // for a renewal is for good. The description, if any, is the message.
  const docs =
    'https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors';
  expect(refusal(400, `{"error":"account_suspended","error_uri":"${docs}"}`)).toMatchObject({
    kind: 'refused',
    message: 'GitHub refused to renew the token: account_suspended',
  });
  expect(
    refusal(
      200,
      `{"error":"account_suspended","error_description":"The account is suspended.","error_uri":"${docs}"}`,
    ).message,
  ).toBe('GitHub refused to renew the token: The account is suspended.');
  // A portal's or a gateway's JSON can carry a description and a relative link of its own: only
  // a documented code or a link into GitHub's docs counts. Nor do OAuth's try-again codes.
  for (const body of [
    '{"error":"login_required","error_description":"Sign in to the network to continue."}',
    '{"error":"login_required","error_uri":"/help/login"}',
    '{"error":"account_suspended","error_uri":"/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors"}',
    '{"error":"account_suspended","error_uri":"https://proxy.example.com/help"}',
    '{"error":"account_suspended","error_uri":"//proxy.example.com/help"}',
    '{"error":"account_suspended","error_uri":"http://docs.github.com/apps"}',
    '{"error":"temporarily_unavailable","error_description":"Try again later."}',
    '{"error":"server_error","error_description":"Something went wrong."}',
    `{"error":"slow_down","error_uri":"${docs}"}`,
  ]) {
    for (const status of [200, 400, 401]) {
      expect({ body, status, kind: refusal(status, body).kind }).toEqual({
        body,
        status,
        kind: 'unavailable',
      });
    }
  }
});

test('a token that doesnt expire has nothing to renew it', () => {
  const grant = grantFrom(
    answer('{"access_token":"gho_X","token_type":"bearer","scope":"repo"}'),
    NOW,
  );
  expect(exposed(grant)).toEqual({ token: 'gho_X', refresh: undefined });
});

test('absurd lifetimes dont overflow', () => {
  const refresh = grantFrom(
    answer('{"access_token":"gho_X","refresh_token":"ghr_X","expires_in":18446744073709551615}'),
    NOW,
  )?.refresh;
  // Ten years at most, whatever GitHub says.
  expect(refresh?.expiresAt).toBe(NOW + 10 * 365 * 24 * 60 * 60);
  expect(refresh?.refreshTokenExpiresAt).toBeUndefined();
});

test('a refresh sends no client secret, and goes at most once', async () => {
  const sent: (boolean | undefined)[] = [];
  const replay = replayFetch(
    new Replay('synthetic', [
      {
        request: {
          method: 'POST',
          url: `https://github.com${ACCESS_TOKEN_PATH}`,
          body: `client_id=${CLIENT_ID}&grant_type=refresh_token&refresh_token=ghr_OLD`,
        },
        response: {
          status: 200,
          headers: {},
          body: {
            access_token: 'gho_NEW',
            expires_in: 28800,
            refresh_token: 'ghr_NEW',
            refresh_token_expires_in: 15638400,
          },
        },
      },
    ]),
  );
  const fetch: typeof globalThis.fetch = (input, init?: FetchInit) => {
    sent.push(init?.once);
    return replay(input, init);
  };
  const before = nowSeconds();
  const grant = await refreshGrant({ fetch }, new Token('ghr_OLD'));
  const after = nowSeconds();
  // It spends the refresh token.
  expect(sent).toEqual([true]);
  expect(grant.token.expose()).toBe('gho_NEW');
  expect(grant.refresh?.token.expose()).toBe('ghr_NEW');
  const expiresAt = grant.refresh?.expiresAt ?? 0;
  expect(expiresAt).toBeGreaterThanOrEqual(before + 28800);
  expect(expiresAt).toBeLessThanOrEqual(after + 28800);
});
