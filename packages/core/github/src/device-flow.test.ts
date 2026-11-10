import { inspect } from 'node:util';

import { Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { afterEach, expect, test, vi } from 'vitest';

import {
  DeviceCodes,
  DeviceFlowError,
  parsePoll,
  requestCodes,
  VERIFICATION_URL,
  waitForToken,
  type Poll,
} from './device-flow.ts';
import { CLIENT_ID } from './errors.ts';
import { missingScopes, SCOPES } from './user.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** A poll with its tokens shown, to compare: a token hides itself from `toEqual`. */
function shown(poll: Poll) {
  if (poll.kind !== 'token') return poll;
  const { token, refresh } = poll.grant;
  return {
    kind: poll.kind,
    grant: {
      token: token.expose(),
      refresh: refresh && { ...refresh, token: refresh.token.expose() },
    },
  };
}

/** What a refused poll said. */
function refusedWith(poll: Poll): string {
  if (poll.kind !== 'refused') throw new Error(`the poll wasn't refused: ${poll.kind}`);
  return poll.message;
}

test('parses every poll answer', () => {
  const poll = (body: string) => shown(parsePoll(200, body, 0));
  expect(
    poll(
      '{"error":"authorization_pending","error_description":"The authorization request is still pending."}',
    ),
  ).toEqual({ kind: 'pending' });
  expect(
    poll('{"error":"slow_down","error_description":"Too many requests.","interval":10}'),
  ).toEqual({ kind: 'slowDown', interval: 10 });
  expect(poll('{"error":"slow_down"}')).toEqual({ kind: 'slowDown', interval: undefined });
  expect(poll('{"error":"expired_token"}')).toEqual({ kind: 'expired' });
  expect(poll('{"error":"access_denied"}')).toEqual({ kind: 'denied' });
  expect(
    poll(
      '{"error":"incorrect_device_code","error_description":"The device_code provided is not valid."}',
    ),
  ).toEqual({ kind: 'refused', message: 'The device_code provided is not valid.' });
  expect(poll('{"error":"device_flow_disabled"}')).toEqual({
    kind: 'refused',
    message: 'device_flow_disabled',
  });
  expect(
    poll('{"access_token":"gho_FAKE","token_type":"bearer","scope":"read:org,repo,workflow"}'),
  ).toEqual({ kind: 'token', grant: { token: 'gho_FAKE', refresh: undefined } });
  // An app whose tokens expire hands over a refresh token with each.
  expect(
    shown(
      parsePoll(
        200,
        '{"access_token":"gho_FAKE","expires_in":28800,"refresh_token":"ghr_FAKE","refresh_token_expires_in":15638400,"scope":"read:org,repo,workflow","token_type":"bearer"}',
        1_000,
      ),
    ),
  ).toEqual({
    kind: 'token',
    grant: {
      token: 'gho_FAKE',
      refresh: {
        token: 'ghr_FAKE',
        issuedAt: 1_000,
        expiresAt: 1_000 + 28800,
        refreshTokenExpiresAt: 1_000 + 15638400,
      },
    },
  });
  expect(poll('error=slow_down&interval=20').kind).toBe('refused');
  expect(parsePoll(502, '<!DOCTYPE html><html>Unicorn!</html>', 0)).toEqual({
    kind: 'unavailable',
    message: 'HTTP 502',
  });
  expect(parsePoll(429, '', 0).kind).toBe('unavailable');
  // A refusal's page is summed up, not shown whole.
  expect(refusedWith(parsePoll(404, `<html>${'x'.repeat(5000)}</html>`, 0))).toBe(
    'HTTP 404: (an HTML page)',
  );
  const message = refusedWith(parsePoll(400, 'nope '.repeat(100), 0));
  expect(Array.from(message).length).toBeLessThan(220);
  expect(message.endsWith('…')).toBe(true);
});

test('codes never show the device code', () => {
  const codes = new DeviceCodes({
    deviceCode: 'secret-device-code',
    userCode: '50B0-5666',
    expiresIn: 899,
    interval: 5,
  });
  for (const shownAs of [String(codes), JSON.stringify(codes), inspect(codes)]) {
    expect(shownAs).not.toContain('secret');
    expect(shownAs).toContain('50B0-5666');
  }
});

/** A form post to `path` on github.com with `body`, answered with `answer`. */
function interaction(path: string, body: string, answer: Json): Interaction {
  return {
    request: { method: 'POST', url: `https://github.com${path}`, body },
    response: { status: 200, headers: {}, body: answer },
  };
}

/** A replay answering the device code request, then every poll, with these bodies. */
function githubAnswering(codes: Json, polls: readonly Json[]): Replay {
  return new Replay('synthetic', [
    interaction(
      '/login/device/code',
      `client_id=${CLIENT_ID}&scope=repo+read%3Aorg+workflow+offline_access`,
      codes,
    ),
    ...polls.map((poll) =>
      interaction(
        '/login/oauth/access_token',
        `client_id=${CLIENT_ID}&device_code=d&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code`,
        poll,
      ),
    ),
  ]);
}

/** Runs the fake clock until `promise` settles, and gives what it threw, or nothing. */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  const settled = promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  const state = { done: false };
  void settled.then(() => {
    state.done = true;
  });
  while (!state.done) await vi.advanceTimersToNextTimerAsync();
  return settled;
}

test('absurd numbers from github are clamped', async () => {
  vi.useFakeTimers();
  // The largest 64-bit number, as near as a JavaScript number gets.
  const huge = 2 ** 64;
  const fetch = replayFetch(
    githubAnswering(
      {
        device_code: 'd',
        user_code: 'FAKE-1234',
        verification_uri: 'file:///Applications/Calculator.app',
        expires_in: huge,
        interval: huge,
      },
      [{ error: 'slow_down', interval: huge }],
    ),
  );
  const codes = await requestCodes({ fetch });
  expect(codes.expiresIn).toBe(60 * 60);
  expect(codes.interval).toBe(5 * 60);
  // Waiting gives up when the clamped code expires.
  const error = await errorOf(waitForToken({ fetch }, codes));
  expect(error).toBeInstanceOf(DeviceFlowError);
  expect(error).toMatchObject({ detail: { kind: 'expired' } });
});

test('lo opens only githubs page', async () => {
  expect(VERIFICATION_URL).toBe('https://github.com/login/device');
  // Whatever page GitHub's answer names.
  const fetch = replayFetch(
    githubAnswering(
      {
        device_code: 'd',
        user_code: 'FAKE-1234',
        verification_uri: 'file:///Applications/Calculator.app',
        expires_in: 899,
        interval: 5,
      },
      [],
    ),
  );
  expect((await requestCodes({ fetch })).verificationUrl).toBe(VERIFICATION_URL);
});

test('a sign-in asks for a token that renews', async () => {
  const fetch = replayFetch(
    githubAnswering({ device_code: 'd', user_code: 'FAKE-1234', expires_in: 899, interval: 5 }, []),
  );
  await requestCodes({ fetch });
  const form = new URLSearchParams(new TextDecoder().decode(fetch.seen[0]?.body));
  // `offline_access` gets a refresh token with each token.
  expect(form.get('scope')?.split(' ')).toEqual([...SCOPES, 'offline_access']);
  // GitHub doesn't grant it as a scope, and a token without it lacks nothing.
  expect(missingScopes(['read:org', 'repo', 'workflow'])).toEqual([]);
});

test('missing scopes read well', () => {
  expect(new DeviceFlowError({ kind: 'missingScopes', scopes: ['workflow'] }).message).toBe(
    'The token is missing the workflow scope.',
  );
  expect(new DeviceFlowError({ kind: 'missingScopes', scopes: ['repo', 'workflow'] }).message).toBe(
    'The token is missing the repo, workflow scopes.',
  );
});
