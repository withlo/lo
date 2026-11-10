/**
 * Renewing a token that expires, and what renewing shares with signing in: posting a form to
 * GitHub's website, and reading GitHub's answer when asked for a token.
 *
 * Lo's OAuth app issues expiring tokens. Each sign-in gets an access token that lasts 8 hours and a
 * refresh token that lasts six months without use. A renewal trades the refresh token for a new
 * pair, and from then on neither old token works, so the new pair must be kept before the new
 * access token is used. GitHub renews a device-flow token without a client secret, which an app on
 * the user's computer can't keep secret. An app that turns expiring tokens off gets tokens that
 * never expire and no refresh token, so Lo never assumes there is one.
 * See [GitHub's docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#refreshing-an-access-token-with-a-refresh-token).
 */

import { GITHUB_URLS, USER_AGENT, type GitHubUrls } from './client.ts';
import { CLIENT_ID, classifyNetworkError, GithubError, summarizeBody } from './errors.ts';
import { RenewalError, type Grant, type Refresh } from './grant.ts';
import { isRecord } from './graphql.ts';
import { Token } from './token.ts';

/** Where GitHub hands over tokens on its website, to a sign-in's polls and to renewals. */
export const ACCESS_TOKEN_PATH = '/login/oauth/access_token';

/** How long a form post waits for its whole answer, in milliseconds. */
const TIMEOUT_MS = 30_000;

/**
 * The longest lifetime Lo believes GitHub gives a token, in seconds, so a broken answer can't put
 * an expiry centuries away.
 */
const MAX_LIFETIME = 10 * 365 * 24 * 60 * 60;

/** What a request to GitHub's website, to sign in or to renew a token, goes through. No token goes with it. */
export interface WebOptions {
  /** The `fetch` the request goes through. */
  fetch: typeof globalThis.fetch;
  /** GitHub's addresses, if not github.com's. Only `web` is posted to. */
  urls?: Partial<GitHubUrls> | undefined;
  /**
   * Seconds since the Unix epoch, now: what the expiry of a token GitHub hands over counts from.
   * The computer's clock unless said otherwise.
   */
  now?: (() => number) | undefined;
  /** The `User-Agent` to send, such as `lo/1.2.0`. */
  userAgent?: string | undefined;
}

/** Seconds since the Unix epoch, now, by the computer's clock. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** GitHub's website's address, without a trailing slash. */
export function webAddress(urls: Partial<GitHubUrls> | undefined): string {
  return (urls?.web ?? GITHUB_URLS.web).replace(/\/+$/, '');
}

/** The answer to a form post: its status and its body. */
export interface FormAnswer {
  status: number;
  body: string;
}

/**
 * Posts `form` to `path` on GitHub's website and reads the whole answer, whatever its status.
 * Redirects aren't followed. The fields are sent in the order given. Throws a `network`
 * {@link GithubError} when no answer comes, or `signal`'s reason once it's aborted.
 */
export async function postForm(
  options: WebOptions,
  path: string,
  form: readonly (readonly [string, string])[],
  signal?: AbortSignal,
): Promise<FormAnswer> {
  const body = new URLSearchParams();
  for (const [name, value] of form) body.append(name, value);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await options.fetch(`${webAddress(options.urls)}${path}`, {
      method: 'POST',
      headers: {
        // Without it GitHub answers form-encoded.
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': options.userAgent ?? USER_AGENT,
      },
      body: body.toString(),
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    throw new GithubError(
      { kind: 'network', failure: classifyNetworkError(error), message: describeThrown(error) },
      { cause: error },
    );
  }
}

/** Why `signal` was aborted, as an error to throw. */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('stopped', { cause: reason });
}

/** What `fetch` threw, in a few words, with its cause's. */
function describeThrown(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`;
}

/** `HTTP <status>: <what the body says>`, for an answer that isn't what was asked for. */
export function httpError(status: number, body: string): string {
  const summary = summarizeBody(body);
  return summary === undefined ? `HTTP ${status}` : `HTTP ${status}: ${summary}`;
}

/** GitHub's answer when asked for a token, by a sign-in's poll or a renewal. */
export interface TokenAnswer {
  accessToken?: string | undefined;
  /** How long the access token lasts, in seconds. */
  expiresIn?: number | undefined;
  refreshToken?: string | undefined;
  /** How long the refresh token lasts unused, in seconds. */
  refreshTokenExpiresIn?: number | undefined;
  error?: string | undefined;
  errorDescription?: string | undefined;
  /** A page in GitHub's docs about the error. */
  errorUri?: string | undefined;
  /** With `slow_down`: the new shortest gap between polls, in seconds. */
  interval?: number | undefined;
}

/**
 * `body` read as GitHub's answer to a request for a token, or nothing when it isn't a JSON object.
 * A field of the wrong type is taken as missing.
 */
export function readTokenAnswer(body: string): TokenAnswer | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) return undefined;
  return {
    accessToken: text(json['access_token']),
    expiresIn: seconds(json['expires_in']),
    refreshToken: text(json['refresh_token']),
    refreshTokenExpiresIn: seconds(json['refresh_token_expires_in']),
    error: text(json['error']),
    errorDescription: text(json['error_description']),
    errorUri: text(json['error_uri']),
    interval: seconds(json['interval']),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A whole, non-negative number of seconds, or nothing. */
function seconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The token `answer` hands over, if any, with its expiry counted from `now`, when the answer came,
 * in seconds since the Unix epoch. An empty token is none.
 */
export function grantFrom(answer: TokenAnswer, now: number): Grant | undefined {
  if (answer.accessToken === undefined) return undefined;
  const token = new Token(answer.accessToken);
  if (token.isEmpty) return undefined;
  const at = (lifetime: number | undefined) =>
    lifetime === undefined ? undefined : now + Math.min(lifetime, MAX_LIFETIME);
  const refreshToken =
    answer.refreshToken === undefined ? undefined : new Token(answer.refreshToken);
  const refresh: Refresh | undefined =
    refreshToken === undefined || refreshToken.isEmpty
      ? undefined
      : {
          token: refreshToken,
          issuedAt: now,
          expiresAt: at(answer.expiresIn),
          refreshTokenExpiresAt: at(answer.refreshTokenExpiresIn),
        };
  return { token, refresh };
}

/**
 * Trades the refresh token `refresh` for a new access token and refresh token. Sends no client
 * secret. Throws a {@link RenewalError}: `refused` when only signing in again gets a token, and
 * `unavailable` when the refresh token may still work later.
 */
export async function refreshGrant(options: WebOptions, refresh: Token): Promise<Grant> {
  let answer: FormAnswer;
  try {
    answer = await postForm(options, ACCESS_TOKEN_PATH, [
      ['client_id', CLIENT_ID],
      ['grant_type', 'refresh_token'],
      ['refresh_token', refresh.expose()],
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RenewalError('unavailable', message, { cause: error });
  }
  return parseRefresh(answer.status, answer.body, (options.now ?? nowSeconds)());
}

/**
 * The `error`s GitHub's docs give for renewing a token ("Generating a user access token for a
 * GitHub App", its Troubleshooting section, and "Authorizing OAuth apps"): the refresh token is wrong
 * or expired, the grant type or client ID is wrong, or the user hasn't verified their email. Trying
 * the same refresh token again fixes none of them. The docs' `redirect_uri_mismatch` and
 * `bad_verification_code` are about what a renewal doesn't send.
 */
const DOCUMENTED_REFUSALS: ReadonlySet<string> = new Set([
  'bad_refresh_token',
  'unsupported_grant_type',
  'incorrect_client_credentials',
  'unverified_user_email',
]);

/** OAuth's `error`s that say to try again later. */
const TRANSIENT: ReadonlySet<string> = new Set([
  'slow_down',
  'temporarily_unavailable',
  'server_error',
]);

/**
 * Why GitHub refused to renew for good, or nothing when `answer` isn't such a refusal.
 *
 * A refusal signs the account out and forgets its refresh token, so it must be GitHub's own word,
 * not a proxy's, an auth gateway's or a captive portal's, which can answer with JSON of their own.
 * So an `error` is a refusal only when its code is one GitHub documents for a renewal, or when its
 * `error_uri` is a page on `https://docs.github.com`, which nothing in the way would link to. A
 * description alone, or a relative link, could come from anything. OAuth's codes for trying again
 * later aren't refusals, whatever comes with them.
 */
function refusalOf(answer: TokenAnswer): string | undefined {
  const { error } = answer;
  if (error === undefined || error === '' || TRANSIENT.has(error)) return undefined;
  if (!DOCUMENTED_REFUSALS.has(error) && !inGithubDocs(answer.errorUri)) return undefined;
  return answer.errorDescription?.trim() || error;
}

/** Whether `uri` is an absolute address of a page in GitHub's docs, `https://docs.github.com/…`. */
function inGithubDocs(uri: string | undefined): boolean {
  if (uri === undefined || !uri.startsWith('https://docs.github.com/')) return false;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && url.hostname === 'docs.github.com' && url.port === '';
  } catch {
    return false;
  }
}

/**
 * What a renewal's answer says, with a token's expiry counted from `now`. Only GitHub's own
 * refusal of the refresh token is `refused` ({@link refusalOf}). Anything else may come from
 * something in the way, such as a proxy that wants a password (a 407, or a bare 401), a firewall
 * (403) or a redirect to a login page, or from GitHub not answering (5xx, 429): GitHub didn't say
 * the refresh token is no good, so it's `unavailable` and kept.
 */
export function parseRefresh(status: number, body: string, now: number): Grant {
  // GitHub answers a renewal with 200, and may send its refusal with a 400 or 401.
  const answer = [200, 400, 401].includes(status) ? readTokenAnswer(body) : undefined;
  if (answer === undefined) {
    const why = status === 200 ? "GitHub's answer wasn't JSON" : httpError(status, body);
    throw new RenewalError('unavailable', why);
  }
  const grant = status === 200 ? grantFrom(answer, now) : undefined;
  if (grant) return grant;
  const refused = refusalOf(answer);
  if (refused !== undefined) throw new RenewalError('refused', refused);
  if (status !== 200) throw new RenewalError('unavailable', httpError(status, body));
  const { error } = answer;
  if (error !== undefined) throw new RenewalError('unavailable', answer.errorDescription ?? error);
  throw new RenewalError('unavailable', "GitHub's answer had neither a token nor an error");
}
