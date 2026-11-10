import { Replay, replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

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
  // GitHub's other refusals, with the statuses it may send them with.
  for (const [status, error] of [
    [200, 'invalid_grant'],
    [200, 'unauthorized_client'],
    [200, 'access_denied'],
    [200, 'incorrect_client_credentials'],
    [400, 'bad_refresh_token'],
    [401, 'bad_refresh_token'],
  ] as const) {
    expect({ status, error, kind: refusal(status, `{"error":"${error}"}`).kind }).toEqual({
      status,
      error,
      kind: 'refused',
    });
  }
  // GitHub can't answer, or something in the way answers instead of it: a redirect to a login
  // page, a firewall, a proxy that wants a password, or one that answers a bare 400 or 401.
  // None of that refuses the token.
  for (const [status, body] of [
    [400, '{}'],
    [401, '{}'],
    [400, ''],
    [401, '<html>Unauthorized</html>'],
    [502, '<html>Unicorn!</html>'],
    [429, '<html>Unicorn!</html>'],
    [301, '<html>Unicorn!</html>'],
    [302, '<html>Unicorn!</html>'],
    [307, '<html>Unicorn!</html>'],
    [403, '<html>Unicorn!</html>'],
    [404, '<html>Unicorn!</html>'],
    [407, '<html>Unicorn!</html>'],
  ] as const) {
    expect({ status, body, kind: refusal(status, body).kind }).toEqual({
      status,
      body,
      kind: 'unavailable',
    });
  }
  // Nor does an error Lo doesn't know.
  expect(refusal(200, '{"error":"temporarily_unavailable"}').kind).toBe('unavailable');
  expect(refusal(200, 'not json').kind).toBe('unavailable');
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

test('a refresh sends no client secret', async () => {
  const fetch = replayFetch(
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
  const before = nowSeconds();
  const grant = await refreshGrant({ fetch }, new Token('ghr_OLD'));
  const after = nowSeconds();
  expect(grant.token.expose()).toBe('gho_NEW');
  expect(grant.refresh?.token.expose()).toBe('ghr_NEW');
  const expiresAt = grant.refresh?.expiresAt ?? 0;
  expect(expiresAt).toBeGreaterThanOrEqual(before + 28800);
  expect(expiresAt).toBeLessThanOrEqual(after + 28800);
});
