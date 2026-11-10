/**
 * Signing in with GitHub's device flow: Lo shows a code, the user enters it on GitHub, and Lo
 * polls until GitHub hands over a token.
 *
 * GitHub answers every poll with HTTP 200 and an `error` field while it waits
 * (`authorization_pending`), when polled too fast (`slow_down`, with a new, longer interval), and
 * when the flow ends without a token (`expired_token`, `access_denied` and misconfigurations).
 * See [GitHub's docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
 */

import { GITHUB_URLS, GithubClient } from './client.ts';
import { CLIENT_ID, GithubError } from './errors.ts';
import type { Grant } from './grant.ts';
import { isRecord } from './graphql.ts';
import {
  abortReason,
  ACCESS_TOKEN_PATH,
  grantFrom,
  httpError,
  nowSeconds,
  postForm,
  readTokenAnswer,
  webAddress,
  type WebOptions,
} from './refresh.ts';
import type { Token } from './token.ts';
import { missingScopes, SCOPES, type AuthenticatedUser, type Scope } from './user.ts';

/** Where a sign-in asks for its codes, on GitHub's website. */
const DEVICE_CODE_PATH = '/login/device/code';
/** Where the user enters the code, on GitHub's website. */
const VERIFICATION_PATH = '/login/device';
/**
 * What a sign-in asks for: Lo's scopes, and `offline_access`, for a token that expires with a
 * refresh token to renew it. Lo's OAuth app predates GitHub's opt-in for expiring tokens, so
 * without it no sign-in gets a refresh token. GitHub doesn't grant `offline_access` as a scope, so
 * it isn't in {@link SCOPES}, which a new token's scopes are checked against.
 */
const REQUESTED_SCOPES = [...SCOPES, 'offline_access'].join(' ');
/**
 * Where the user enters the code on github.com. Lo opens this rather than the `verification_uri`
 * GitHub's answer names, so an answer from anything posing as GitHub can't open another page or
 * app.
 */
export const VERIFICATION_URL = `${GITHUB_URLS.web}${VERIFICATION_PATH}`;
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
/** GitHub's shortest gap between polls, in seconds. */
const MIN_INTERVAL = 5;
/**
 * The longest gap between polls Lo accepts, in seconds. GitHub's are seconds; a bigger number is a
 * broken answer.
 */
const MAX_INTERVAL = 5 * 60;
/** The longest a code is waited for, in seconds. GitHub's codes last 15 minutes. */
const MAX_EXPIRES_IN = 60 * 60;
/** The longest wait after polls that failed in a row, in milliseconds. */
const MAX_BACKOFF_MS = 60_000;
/**
 * How long before the code expires the last poll goes, when the next one would be too late, in
 * milliseconds.
 */
const LAST_POLL_MARGIN_MS = 1000;
/** How much `slow_down` adds when it doesn't say the new interval, in seconds. */
const SLOW_DOWN_STEP = 5;
/** Polls wait a little longer than the interval, so clock drift never earns a `slow_down`. */
const INTERVAL_MARGIN = 1.2;

/** What a sign-in talks to GitHub with. */
export interface SignInOptions extends WebOptions {
  /** Stops the sign-in: no more requests are sent, and it rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
}

/** The codes GitHub issued for one sign-in, as GitHub gave them. */
export interface IssuedCodes {
  deviceCode: string;
  userCode: string;
  /** In seconds. */
  expiresIn: number;
  /** In seconds. */
  interval: number;
  /** Where the user enters the code: {@link VERIFICATION_URL} unless said otherwise. */
  verificationUrl?: string | undefined;
}

/**
 * The codes GitHub issued for one sign-in. Printing them or turning them into JSON leaves out the
 * device code: whoever has it gets the token once the user enters the user code.
 */
export class DeviceCodes {
  readonly #deviceCode: string;
  /** The code the user types on GitHub, such as `50B0-5666`, at {@link DeviceCodes.verificationUrl}. */
  readonly userCode: string;
  /** How long the codes are good for, in seconds: at most an hour. */
  readonly expiresIn: number;
  /** The shortest gap between polls, in seconds: between 5 seconds and 5 minutes. */
  readonly interval: number;
  /** Where the user enters the code, on GitHub's website. */
  readonly verificationUrl: string;

  constructor(codes: IssuedCodes) {
    this.#deviceCode = codes.deviceCode;
    this.userCode = codes.userCode;
    this.expiresIn = Math.min(codes.expiresIn, MAX_EXPIRES_IN);
    this.interval = clampInterval(codes.interval);
    this.verificationUrl = codes.verificationUrl ?? VERIFICATION_URL;
  }

  /** The code each poll sends. */
  deviceCode(): string {
    return this.#deviceCode;
  }

  toString(): string {
    return `DeviceCodes(${this.userCode}, expires in ${this.expiresIn} s, every ${this.interval} s)`;
  }

  toJSON(): { userCode: string; expiresIn: number; interval: number; verificationUrl: string } {
    const { userCode, expiresIn, interval, verificationUrl } = this;
    return { userCode, expiresIn, interval, verificationUrl };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/** Why a sign-in ended without an account. */
export type DeviceFlowFailure =
  /** The code expired before it was entered. */
  | { kind: 'expired' }
  /** The user cancelled on GitHub. */
  | { kind: 'denied' }
  /** GitHub refused the sign-in, as when Lo's app is misconfigured, saying why. */
  | { kind: 'refused'; message: string }
  /** The token GitHub handed over lacks scopes Lo needs. */
  | { kind: 'missingScopes'; scopes: Scope[] };

/**
 * A sign-in that ended without an account. {@link DeviceFlowError.detail} says why. When GitHub
 * can't be reached, a sign-in throws a {@link GithubError} instead.
 */
export class DeviceFlowError extends Error {
  override name = 'DeviceFlowError';
  readonly detail: DeviceFlowFailure;

  constructor(detail: DeviceFlowFailure, options?: ErrorOptions) {
    super(describeFailure(detail), options);
    this.detail = detail;
  }
}

function describeFailure(detail: DeviceFlowFailure): string {
  switch (detail.kind) {
    case 'expired':
      return 'The code expired before it was entered on GitHub.';
    case 'denied':
      return 'The sign-in was cancelled on GitHub.';
    case 'refused':
      return `GitHub refused the sign-in: ${detail.message}`;
    case 'missingScopes': {
      const plural = detail.scopes.length === 1 ? '' : 's';
      return `The token is missing the ${detail.scopes.join(', ')} scope${plural}.`;
    }
    default:
      return detail satisfies never;
  }
}

/** What one poll said. */
export type Poll =
  | { kind: 'pending' }
  /** Poll less often: every `interval` seconds, or 5 s more than now if GitHub didn't say. */
  | { kind: 'slowDown'; interval?: number | undefined }
  | { kind: 'token'; grant: Grant }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'refused'; message: string }
  /** GitHub didn't answer this time (a 5xx, a 429, or no answer at all): poll again later. */
  | { kind: 'unavailable'; message: string };

/** A poll interval GitHub gave, in seconds, kept between 5 seconds and 5 minutes. */
function clampInterval(interval: number): number {
  return Math.min(Math.max(interval, MIN_INTERVAL), MAX_INTERVAL);
}

/**
 * Asks GitHub for a device code and the user code to show. Throws a {@link DeviceFlowError} when
 * GitHub refuses, and a {@link GithubError} when it can't be reached or its answer can't be read.
 */
export async function requestCodes(options: SignInOptions): Promise<DeviceCodes> {
  const { status, body } = await postForm(
    options,
    DEVICE_CODE_PATH,
    [
      ['client_id', CLIENT_ID],
      ['scope', REQUESTED_SCOPES],
    ],
    options.signal,
  );
  if (status !== 200) {
    throw new DeviceFlowError({ kind: 'refused', message: httpError(status, body) });
  }
  const refusal = readTokenAnswer(body);
  if (refusal?.error !== undefined) {
    throw new DeviceFlowError({
      kind: 'refused',
      message: refusal.errorDescription ?? refusal.error,
    });
  }
  return new DeviceCodes({
    ...readCodes(body),
    verificationUrl: `${webAddress(options.urls)}${VERIFICATION_PATH}`,
  });
}

/** The codes in GitHub's answer to a request for them. */
function readCodes(body: string): IssuedCodes {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    throw codesUnreadable(String(error));
  }
  if (!isRecord(json)) throw codesUnreadable("it isn't an object");
  const { device_code: deviceCode, user_code: userCode, expires_in: expiresIn, interval } = json;
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string') {
    throw codesUnreadable('it has no device code or user code');
  }
  if (!isSeconds(expiresIn) || !isSeconds(interval)) {
    throw codesUnreadable('it has no expiry or interval');
  }
  return { deviceCode, userCode, expiresIn, interval };
}

function codesUnreadable(message: string): GithubError {
  return new GithubError({ kind: 'decode', message: `the device code response: ${message}` });
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * What a poll's answer says. `now` is when it came, in seconds since the Unix epoch, which a token
 * that expires counts from.
 */
export function parsePoll(status: number, body: string, now: number): Poll {
  if (status >= 500 || status === 429) return { kind: 'unavailable', message: `HTTP ${status}` };
  if (status !== 200) return { kind: 'refused', message: httpError(status, body) };
  const answer = readTokenAnswer(body);
  if (answer === undefined) return { kind: 'refused', message: "GitHub's answer wasn't JSON" };
  const grant = grantFrom(answer, now);
  if (grant) return { kind: 'token', grant };
  switch (answer.error) {
    case undefined:
      return { kind: 'refused', message: "GitHub's answer had neither a token nor an error" };
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slowDown', interval: answer.interval };
    case 'expired_token':
    case 'token_expired':
      return { kind: 'expired' };
    case 'access_denied':
      return { kind: 'denied' };
    default:
      return { kind: 'refused', message: answer.errorDescription ?? answer.error };
  }
}

/**
 * Polls until the user enters the code on GitHub, and returns the token, with its refresh token
 * when it expires. Each poll waits the interval × 1.2; a `slow_down` adopts the interval GitHub
 * returns. A poll that gets no answer, or a server error, doesn't end the flow: the wait doubles
 * with each such poll in a row, up to a minute. When the next poll would come after the codes
 * expire, a last one goes a second before they do, if that's at least an interval after the
 * previous one; then the flow ends without waiting for GitHub to say so. Aborting `signal` stops
 * it.
 *
 * Throws a {@link DeviceFlowError} when the sign-in ends without a token.
 */
export async function waitForToken(options: SignInOptions, codes: DeviceCodes): Promise<Grant> {
  const { signal } = options;
  const now = options.now ?? nowSeconds;
  const deadline = Date.now() + Math.min(codes.expiresIn, MAX_EXPIRES_IN) * 1000;
  let interval = clampInterval(codes.interval);
  let failures = 0;
  for (;;) {
    let wait = backoff(Math.round(interval * 1000 * INTERVAL_MARGIN), failures);
    const at = Date.now();
    const last = at + wait >= deadline;
    if (last) {
      wait = deadline - at - LAST_POLL_MARGIN_MS;
      if (wait < interval * 1000) throw new DeviceFlowError({ kind: 'expired' });
    }
    await sleep(wait, signal);
    const poll = await pollOnce(options, codes, now);
    switch (poll.kind) {
      case 'pending':
        failures = 0;
        break;
      case 'slowDown':
        failures = 0;
        interval = clampInterval(poll.interval ?? interval + SLOW_DOWN_STEP);
        break;
      case 'unavailable':
        failures += 1;
        break;
      case 'token':
        return poll.grant;
      case 'expired':
        throw new DeviceFlowError({ kind: 'expired' });
      case 'denied':
        throw new DeviceFlowError({ kind: 'denied' });
      case 'refused':
        throw new DeviceFlowError({ kind: 'refused', message: poll.message });
      default:
        return poll satisfies never;
    }
    if (last) throw new DeviceFlowError({ kind: 'expired' });
  }
}

/** Sends one poll and reads what it says. A poll that gets no answer is `unavailable`. */
async function pollOnce(
  options: SignInOptions,
  codes: DeviceCodes,
  now: () => number,
): Promise<Poll> {
  try {
    const { status, body } = await postForm(
      options,
      ACCESS_TOKEN_PATH,
      [
        ['client_id', CLIENT_ID],
        ['device_code', codes.deviceCode()],
        ['grant_type', GRANT_TYPE],
      ],
      options.signal,
    );
    return parsePoll(status, body, now());
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'network') {
      return { kind: 'unavailable', message: error.message };
    }
    throw error;
  }
}

/**
 * `wait` doubled for each of `failures` polls in a row that failed, up to a minute (or `wait`, if
 * that's longer). In milliseconds.
 */
function backoff(wait: number, failures: number): number {
  if (failures === 0) return wait;
  return Math.min(wait * 2 ** Math.min(failures, 16), Math.max(MAX_BACKOFF_MS, wait));
}

/** Waits `ms` milliseconds, or rejects with `signal`'s reason once it's aborted. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Reads who a new token belongs to (`GET /user`) and checks it has every scope Lo needs. Throws a
 * {@link DeviceFlowError} for a missing scope, and a {@link GithubError} when GitHub refuses the
 * token or can't be reached.
 */
export async function checkToken(options: WebOptions, token: Token): Promise<AuthenticatedUser> {
  const client = new GithubClient({
    fetch: options.fetch,
    token,
    urls: options.urls,
    userAgent: options.userAgent,
  });
  const user = await client.user();
  const missing = missingScopes(user.scopes);
  if (missing.length > 0) throw new DeviceFlowError({ kind: 'missingScopes', scopes: missing });
  return user;
}
