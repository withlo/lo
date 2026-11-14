/** What can go wrong talking to GitHub, keeping what GitHub said. */

import { type GraphQLError, isRecord } from './graphql.ts';

/** Lo's OAuth app's client ID. It's public: every copy of Lo sends it. */
export const CLIENT_ID = 'Ov23liBORqwRdiPzqsPP';

/** The page where a user asks an organization to approve Lo: it lists each organization with a Request button. */
export function approvalUrl(): string {
  return `https://github.com/settings/connections/applications/${CLIENT_ID}`;
}

/**
 * The longest GitHub's `retry-after` is taken to ask for, in seconds: a proxy's nonsense header,
 * or a clock off by hours, can't pause Lo for longer.
 */
export const MAX_RETRY_AFTER = 60 * 60;

/**
 * Why a request got no answer, as far as Lo can tell from what `fetch` threw:
 *
 * - `offline`: no connection could be made, as when the computer is offline, has no route or DNS
 *   answer, or goes through a proxy that's down.
 * - `tunnel`: a proxy couldn't open the tunnel to GitHub, as when it can't reach GitHub itself.
 * - `refused`: connecting failed for a reason waiting doesn't fix: a TLS failure, or a proxy that
 *   refused the request.
 * - `lost`: the request was sent, or about to be, and its answer didn't come: it timed out, or its
 *   connection went away under it.
 * - `unknown`: anything else, such as Lo stopping before the answer came.
 */
export type NetworkFailure = 'offline' | 'tunnel' | 'refused' | 'lost' | 'unknown';

/** What went wrong, with what GitHub said. */
export type GithubErrorDetail =
  /**
   * The token was revoked or is invalid (`401`). The account is signed out. `missing` is the login
   * of an account Lo has no more, or never had: the reader signed out of it, so no token was
   * refused.
   */
  | { kind: 'unauthorized'; message: string; missing?: string | undefined }
  /**
   * An organization requires single sign-on, and the token isn't authorized for it. `url`
   * authorizes it; GitHub's link is valid for an hour.
   */
  | { kind: 'ssoRequired'; message: string; url?: string | undefined }
  /** An organization restricts OAuth apps and hasn't approved Lo. */
  | {
      kind: 'oauthAppRestricted';
      message: string;
      org?: string | undefined;
      documentationUrl?: string | undefined;
    }
  /** The rate limit is used up (`secondary: false`), or GitHub's secondary limits kicked in. */
  | {
      kind: 'rateLimited';
      message: string;
      secondary: boolean;
      /** When the primary limit resets, in seconds since the Unix epoch. */
      reset?: number | undefined;
      /** How long GitHub asked to wait, in seconds. */
      retryAfter?: number | undefined;
      /** The limit that was hit (`core`, `graphql`, `search` and so on), from `x-ratelimit-resource`. */
      resource?: string | undefined;
    }
  | { kind: 'notFound'; message: string; documentationUrl?: string | undefined }
  /** Any other error status. */
  | {
      kind: 'api';
      status: number;
      message: string;
      documentationUrl?: string | undefined;
      /** GitHub's `errors` list, for validation failures. */
      errors: unknown[];
    }
  /** A GraphQL response's errors, when none of the cases above fits. */
  | { kind: 'graphql'; errors: GraphQLError[] }
  /**
   * GitHub's pages didn't fit together: a cursor that doesn't move on, or a pull request that
   * kept changing while its pages were read. Trying again later may work.
   */
  | { kind: 'inconsistent'; message: string }
  /** A request to somewhere other than GitHub's API. Lo sends its token nowhere else, so it never sent this one. */
  | { kind: 'refusedUrl'; host: string }
  /** The request didn't get an answer. */
  | { kind: 'network'; failure: NetworkFailure; message: string }
  /**
   * The account's token couldn't be read, such as from a locked keychain. The account is still
   * signed in; trying again later may work.
   */
  | { kind: 'tokenUnavailable'; message: string }
  /** The answer wasn't what Lo expected. */
  | { kind: 'decode'; message: string };

/** A link that helps the user fix an error, labelled for a button: always an `https` page on github.com. */
export interface HelpLink {
  label: string;
  url: string;
}

/**
 * A link to `url`, if it's an `https` page on github.com. GitHub's answers can name a link, such
 * as the single sign-on URL, and Lo opens nothing else they name.
 */
export function helpLink(label: string, url: string): HelpLink | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const onGithub =
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '';
  return onGithub ? { label, url } : undefined;
}

/** Something that went wrong talking to GitHub. {@link GithubError.detail} says what. */
export class GithubError extends Error {
  override name = 'GithubError';
  readonly detail: GithubErrorDetail;

  constructor(detail: GithubErrorDetail, options?: ErrorOptions) {
    super(describeOr(detail), options);
    this.detail = detail;
  }

  /** GitHub's link for fixing this error: authorizing single sign-on, or asking an organization to approve Lo. */
  helpLink(): HelpLink | undefined {
    const { detail } = this;
    if (detail.kind === 'ssoRequired' && detail.url !== undefined) {
      return helpLink('Authorize on GitHub', detail.url);
    }
    if (detail.kind === 'oauthAppRestricted') {
      return helpLink('Request approval on GitHub', approvalUrl());
    }
    return undefined;
  }

  /** Whether the token is no good and the account needs signing in again. */
  isUnauthorized(): boolean {
    return this.detail.kind === 'unauthorized';
  }

  /**
   * Whether it fails a read made of several requests as a whole: the network, the rate limit and
   * the token stop every request after it too, and are waited out. Any other error fails only the
   * part of the read it was about.
   */
  stopsTheRead(): boolean {
    const { kind } = this.detail;
    return (
      kind === 'network' ||
      kind === 'rateLimited' ||
      kind === 'unauthorized' ||
      kind === 'tokenUnavailable'
    );
  }

  /**
   * Whether GitHub couldn't be reached at all: no connection could be made. A request that
   * connected and then timed out isn't, nor is a TLS failure, a proxy that refused the request, or
   * any answer GitHub gave.
   */
  isUnreachable(): boolean {
    return this.detail.kind === 'network' && this.detail.failure === 'offline';
  }

  /**
   * For a read: whether trying again soon may get an answer: GitHub couldn't be reached, a proxy
   * couldn't open its tunnel, or a request got no answer in time or lost its connection, as on a
   * connection kept from before the computer slept. A TLS failure or a proxy's refusal isn't:
   * waiting doesn't fix those. Never use it to send a write again: a write that lost its answer
   * may have been done ({@link GithubError.mayHavePosted}).
   */
  isRetryable(): boolean {
    const { detail } = this;
    return (
      detail.kind === 'network' &&
      (detail.failure === 'offline' || detail.failure === 'tunnel' || detail.failure === 'lost')
    );
  }

  /**
   * For a read: whether waiting may fix it, with nothing for the user to do:
   * {@link GithubError.isRetryable}, a rate limit, or a server error or `429` from GitHub. A
   * refused token, single sign-on, an organization's restriction or "not found" isn't. Never use
   * it to send a write again.
   */
  isWaitable(): boolean {
    const { detail } = this;
    if (detail.kind === 'rateLimited') return true;
    if (detail.kind === 'api') return detail.status >= 500 || detail.status === 429;
    return this.isRetryable();
  }

  /**
   * For a write, such as a comment or a review: whether GitHub may have done it though it failed,
   * so it mustn't be sent again before checking whether it was, or it may post twice. Lo never
   * sends a write again by itself.
   *
   * It may have whenever the request may have reached GitHub and its answer didn't reach Lo, or
   * didn't make sense: a lost answer or an unknown network failure, a server error (`5xx`), an
   * answer Lo couldn't read, or GitHub's GraphQL saying something went wrong while running it,
   * which a timeout inside GitHub gives. An answer that refuses the write, a rate limit, a refused
   * token, single sign-on, "not found", or a connection that never opened means it wasn't done.
   */
  mayHavePosted(): boolean {
    const { detail } = this;
    if (detail.kind === 'network') return detail.failure === 'lost' || detail.failure === 'unknown';
    if (detail.kind === 'api') return detail.status >= 500;
    if (detail.kind === 'graphql') {
      return detail.errors.some(
        (error) => error.type === undefined && error.message.includes('Something went wrong'),
      );
    }
    return detail.kind === 'decode';
  }

  /** The error for an unsuccessful REST response, or a GraphQL one that failed before running. */
  static fromResponse(status: number, headers: Headers, body: string): GithubError {
    const parsed = parseBody(body);
    const message = parsed.message ?? summarizeBody(body) ?? `HTTP ${status}`;
    const { documentationUrl } = parsed;
    const header = (name: string) => headers.get(name) ?? undefined;

    if (status === 401) return new GithubError({ kind: 'unauthorized', message });
    const sso = parseSsoHeader(header('x-github-sso'));
    if ((status === 403 || status === 404) && sso?.required) {
      return new GithubError({ kind: 'ssoRequired', message, url: sso.url });
    }
    if (status === 403 && isOAuthRestriction(message)) {
      return new GithubError({
        kind: 'oauthAppRestricted',
        message,
        org: restrictingOrg(message),
        documentationUrl,
      });
    }
    if (status === 403 || status === 429) {
      const remaining = integer(header('x-ratelimit-remaining'));
      const wait = retryAfter(header('retry-after'));
      if (remaining === 0 || wait !== undefined || message.toLowerCase().includes('rate limit')) {
        return new GithubError({
          kind: 'rateLimited',
          message,
          secondary: remaining !== 0,
          reset: integer(header('x-ratelimit-reset')),
          retryAfter: wait,
          resource: header('x-ratelimit-resource'),
        });
      }
    }
    if (status === 404) return new GithubError({ kind: 'notFound', message, documentationUrl });
    return new GithubError({
      kind: 'api',
      status,
      message,
      documentationUrl,
      errors: parsed.errors,
    });
  }

  /**
   * The error for a GraphQL response's `errors`, which come with HTTP 200. Every error is looked
   * at, and the one Lo can say most about wins: single sign-on, then an organization's OAuth
   * restriction, then the rate limit, then not found.
   */
  static fromGraphQL(errors: GraphQLError[], headers: Headers): GithubError {
    const header = (name: string) => headers.get(name) ?? undefined;
    const sso = parseSsoHeader(header('x-github-sso'));
    const ssoRequired = sso?.required ? sso : undefined;

    const ssoError = errors.find((error) => error.message.includes('SAML enforcement'));
    if (ssoRequired || ssoError) {
      return new GithubError({
        kind: 'ssoRequired',
        message: (ssoError ?? errors[0])?.message ?? '',
        url: ssoRequired?.url,
      });
    }
    const restriction = errors.find((error) => isOAuthRestriction(error.message));
    if (restriction) {
      return new GithubError({
        kind: 'oauthAppRestricted',
        message: restriction.message,
        org: restrictingOrg(restriction.message),
      });
    }
    const limited = errors.find(
      (error) => error.type === 'RATE_LIMITED' || error.type === 'RATE_LIMIT',
    );
    if (limited) {
      // As for REST: the limit is used up when GitHub says none of it is left, and otherwise its
      // secondary limits kicked in.
      return new GithubError({
        kind: 'rateLimited',
        message: limited.message,
        secondary: integer(header('x-ratelimit-remaining')) !== 0,
        reset: integer(header('x-ratelimit-reset')),
        retryAfter: retryAfter(header('retry-after')),
        resource: header('x-ratelimit-resource'),
      });
    }
    const notFound = errors.find((error) => error.type === 'NOT_FOUND');
    if (notFound) return new GithubError({ kind: 'notFound', message: notFound.message });
    return new GithubError({ kind: 'graphql', errors });
  }
}

/**
 * `detail` in words, or a plain message when it can't be put in words, as for a kind Lo doesn't
 * know: making the error never throws, so it never hides the failure it reports.
 */
function describeOr(detail: GithubErrorDetail): string {
  try {
    return describe(detail);
  } catch {
    return "GitHub gave an error Lo couldn't describe";
  }
}

function describe(detail: GithubErrorDetail): string {
  switch (detail.kind) {
    case 'unauthorized':
      return detail.missing === undefined
        ? `GitHub didn't accept the token: ${detail.message}`
        : detail.message;
    case 'rateLimited':
      return `GitHub's rate limit was hit: ${detail.message}`;
    case 'api':
      return `GitHub answered ${detail.status}: ${detail.message}`;
    case 'graphql': {
      const messages = detail.errors.map((error) => error.message);
      return messages.length === 0 ? "GitHub's GraphQL API returned an error" : messages.join('; ');
    }
    case 'inconsistent':
      return `GitHub's pages didn't fit together: ${detail.message}`;
    case 'refusedUrl':
      return `Lo sends GitHub requests only to GitHub's API, not ${detail.host}`;
    case 'network':
      return `couldn't reach GitHub: ${detail.message}`;
    case 'tokenUnavailable':
      return `couldn't read the account's token: ${detail.message}`;
    case 'decode':
      return `couldn't read GitHub's answer: ${detail.message}`;
    case 'ssoRequired':
    case 'oauthAppRestricted':
    case 'notFound':
      return detail.message;
    default:
      throw new Error(`a GitHub error Lo doesn't know: ${JSON.stringify(detail satisfies never)}`);
  }
}

function stringOrNothing(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseBody(body: string): {
  message?: string | undefined;
  documentationUrl?: string | undefined;
  errors: unknown[];
} {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { errors: [] };
  }
  if (!isRecord(json)) return { errors: [] };
  return {
    message: stringOrNothing(json['message']),
    documentationUrl: stringOrNothing(json['documentation_url']),
    errors: Array.isArray(json['errors']) ? json['errors'] : [],
  };
}

/** A whole number in a header, or nothing. */
function integer(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** A `retry-after` header's wait, in seconds, up to {@link MAX_RETRY_AFTER}. */
function retryAfter(value: string | undefined): number | undefined {
  const seconds = integer(value);
  return seconds === undefined ? undefined : Math.min(seconds, MAX_RETRY_AFTER);
}

/**
 * The most of an error body that's worth showing: its text with whitespace collapsed, cut short,
 * or just "(an HTML page)" for one of GitHub's error pages. Nothing when it's empty.
 */
export function summarizeBody(body: string): string | undefined {
  const MAX_CHARS = 200;
  const text = body.split(/\s+/).filter(Boolean).join(' ');
  if (text.length === 0) return undefined;
  if (text.startsWith('<')) return '(an HTML page)';
  const chars = Array.from(text);
  return chars.length <= MAX_CHARS ? text : `${chars.slice(0, MAX_CHARS).join('')}…`;
}

function isOAuthRestriction(message: string): boolean {
  return message.includes('OAuth App access restrictions');
}

/** The organization in GitHub's message "… the `<org>` organization has enabled OAuth App access restrictions …". */
function restrictingOrg(message: string): string | undefined {
  return /the `([^`]*)` organization/.exec(message)?.[1];
}

/**
 * GitHub's `X-GitHub-SSO` header: `required; url=<url>`, or
 * `partial-results; organizations=<id>,<id>` on lists that left some organizations out.
 */
export interface SsoHeader {
  required: boolean;
  url?: string | undefined;
  /** The IDs of the organizations a list left out. */
  organizations: number[];
}

export function parseSsoHeader(value: string | null | undefined): SsoHeader | undefined {
  if (value == null) return undefined;
  const [kind, ...parts] = value.split(';').map((part) => part.trim());
  if (kind !== 'required' && kind !== 'partial-results') return undefined;
  const header: SsoHeader = { required: kind === 'required', organizations: [] };
  for (const part of parts) {
    if (part.startsWith('url=')) {
      header.url = part.slice('url='.length);
    } else if (part.startsWith('organizations=')) {
      header.organizations = part
        .slice('organizations='.length)
        .split(',')
        .map((id) => integer(id))
        .filter((id) => id !== undefined);
    }
  }
  return header;
}

/**
 * Why `fetch` failed, from what it threw: Node's `fetch` puts a system error code on the error's
 * `cause`, and Electron's `net.fetch` puts Chromium's network error name in its message. Code
 * whose `fetch` throws something else passes its own.
 */
export function classifyNetworkError(error: unknown): NetworkFailure {
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (typeof current === 'string') {
      names.push(current);
      break;
    }
    if (typeof current !== 'object') break;
    for (const key of ['name', 'code', 'message']) {
      const value: unknown = Reflect.get(current, key);
      if (typeof value === 'string') names.push(value);
    }
    current = Reflect.get(current, 'cause');
  }
  const said = names.join(' ');
  const has = (pattern: RegExp) => pattern.test(said);
  if (has(/\bTimeoutError\b/)) return 'lost';
  if (has(/ERR_TUNNEL_CONNECTION_FAILED|unsuccessful tunnel/)) return 'tunnel';
  if (
    has(
      /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EADDRNOTAVAIL|UND_ERR_CONNECT_TIMEOUT)\b|ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_REFUSED|ADDRESS_UNREACHABLE|NETWORK_ACCESS_DENIED|CONNECTION_TIMED_OUT|PROXY_CONNECTION_FAILED|NETWORK_CHANGED)\b/,
    )
  ) {
    return 'offline';
  }
  if (
    has(
      /\b(CERT_\w+|ERR_TLS_\w+|ERR_SSL_\w+|UNABLE_TO_\w+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)\b|ERR_(CERT_\w+|SSL_\w+|PROXY_AUTH\w*|BAD_SSL_CLIENT_AUTH_CERT|NO_SUPPORTED_PROXIES)\b/,
    )
  ) {
    return 'refused';
  }
  if (
    has(
      /\b(ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_CLOSED)\b|ERR_(CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|TIMED_OUT|EMPTY_RESPONSE)\b/,
    )
  ) {
    return 'lost';
  }
  return 'unknown';
}
