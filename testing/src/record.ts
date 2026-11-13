/**
 * Records GitHub's responses into a cassette, keeping tokens out.
 *
 * Request headers are never stored, only the method, the URL and what identifies the body.
 * Response headers are kept only from {@link KEPT_HEADERS}, query values that grant access, such as
 * signed URLs' signatures, are redacted, in the URLs requested as in what came back, and
 * credential fields in JSON are blanked. An image's bytes are kept as they are, in base64. Before each
 * file is written, and again over the whole cassette at the end, the recorder checks for the
 * token, as is, percent-encoded or in base64, and for anything shaped like a GitHub token; if it
 * finds one, it deletes the cassette and fails. It sends nothing that writes to GitHub unless told
 * it may.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Kind, OperationTypeNode, parse } from 'graphql';

import {
  compare,
  graphqlBody,
  isObject,
  KEPT_HEADERS,
  NULL_BODY,
  parseJson,
  queryHash,
  SCOPES_KEPT_FOR,
  sha256,
  utf8,
  type CassetteInfo,
  type Interaction,
  type Json,
  type RecordedRequest,
  type RecordedResponse,
} from './cassette.ts';
import { blankCredentials, findSecret } from './secrets.ts';

/** The account every recording is made as: the test organization's bot, never a person. */
export const RECORDING_ACCOUNT = 'rozed-bot';

/** A recording: what it asks GitHub, as `node testing/scripts/record.ts` runs it. */
export interface Scenario {
  /** The cassette's folder in `testing/fixtures/github`. */
  name: string;
  /** What the cassette shows, for its `cassette.json`. */
  description: string;
  /** The repository it reads, `owner/name`. */
  repo: string;
  /** The `github/docs` commit of the GraphQL schema its queries were checked against. */
  schema?: string;
  /** Whether it writes to GitHub, which it may only with `LO_RECORD_WRITES=1`. */
  writes?: boolean;
  /**
   * Sends the requests to record through `fetch`, as the bot whose token is `token`. Returns what it
   * made on GitHub for the recording, if anything, which `cassette.json` keeps as `setup`.
   */
  run(fetch: typeof globalThis.fetch, token: string): Promise<Json | undefined>;
}

/** Whether `value` is a {@link Scenario}, such as one a scenarios module exports. */
export function isScenario(value: unknown): value is Scenario {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    'repo' in value &&
    typeof value.repo === 'string' &&
    'run' in value &&
    typeof value.run === 'function'
  );
}

export interface RecorderOptions {
  /** The `fetch` that reaches GitHub. */
  fetch: typeof globalThis.fetch;
  /** The cassette's folder, emptied first. */
  dir: string;
  /** What must never be written, such as the token the requests use. */
  secrets: readonly (Uint8Array | string)[];
  /** Whether requests that write to GitHub may be sent. Off unless set. */
  writes?: boolean;
}

/** Wraps a real `fetch`, writing each request and response to a cassette. */
export class Recorder {
  /** Sends the request, records it with its response, and returns the response unchanged. */
  readonly fetch: typeof globalThis.fetch;
  readonly #dir: string;
  readonly #secrets: readonly (Uint8Array | string)[];
  #count = 0;
  #refused: string | undefined;

  constructor(options: RecorderOptions) {
    this.#dir = options.dir;
    this.#secrets = options.secrets;
    rmSync(this.#dir, { recursive: true, force: true });
    mkdirSync(this.#dir, { recursive: true });
    const inner = options.fetch;
    const writes = options.writes ?? false;

    this.fetch = async (input, init) => {
      const request = new Request(input, init);
      const body = new Uint8Array(await request.clone().arrayBuffer());
      const url = new URL(request.url);
      if (!writes && isWrite(request.method, url, body)) {
        const reason = `${request.method} ${url.href} writes to GitHub, and this recording may not`;
        this.#refused ??= reason;
        throw new Error(`refused to send it: ${reason}`);
      }
      const recorded = recordedRequest(request.method, url, body, {
        ifNoneMatch: request.headers.get('if-none-match'),
        ifModifiedSince: request.headers.get('if-modified-since'),
      });
      const response = await inner(request);
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.#record(recorded, recordedResponse(url, response.status, response.headers, bytes));
      const copy = new Response(NULL_BODY.has(response.status) ? null : bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(copy, 'url', { value: response.url });
      return copy;
    };
  }

  /** Writes `cassette.json` and checks every file once more. On any failure the cassette is deleted. */
  finish(info: CassetteInfo): void {
    try {
      if (this.#refused !== undefined) throw new Error(`refused to record: ${this.#refused}`);
      this.#write('cassette.json', `${JSON.stringify(orderedInfo(info), null, 2)}\n`);
      for (const name of readdirSync(this.#dir)) {
        const found = findSecret(readFileSync(join(this.#dir, name)), this.#secrets);
        if (found) throw new Error(`${join(this.#dir, name)} contains ${found}`);
      }
    } catch (error) {
      this.discard();
      throw error;
    }
  }

  /** Deletes the cassette, after a recording that went wrong. */
  discard(): void {
    rmSync(this.#dir, { recursive: true, force: true });
  }

  #write(name: string, text: string): void {
    const found = findSecret(text, this.#secrets);
    if (found) {
      const reason = `${name} would contain ${found}`;
      this.#refused ??= reason;
      throw new Error(reason);
    }
    writeFileSync(join(this.#dir, name), text);
  }

  #record(request: RecordedRequest, response: RecordedResponse): void {
    this.#count += 1;
    const interaction: Interaction = { request, response };
    this.#write(fileName(this.#count, request), `${JSON.stringify(interaction, null, 2)}\n`);
  }
}

/** Whether a request may change something on GitHub: anything but a GET, a HEAD or a GraphQL query. */
export function isWrite(method: string, url: URL, body: Uint8Array): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  if (method !== 'POST') return true;
  const graphql = graphqlBody(url, () => utf8(body));
  if (!graphql) return true;
  try {
    const operation = parse(graphql.query).definitions.find(
      (definition) =>
        definition.kind === Kind.OPERATION_DEFINITION &&
        (definition.name?.value ?? '') === graphql.operationName,
    );
    return (
      operation?.kind !== Kind.OPERATION_DEFINITION ||
      operation.operation !== OperationTypeNode.QUERY
    );
  } catch {
    return true;
  }
}

/**
 * `NNN-<METHOD>-<path or operation>.json`, with anything but letters, digits and dashes in the
 * path or operation replaced, so a name can't leave the cassette's folder.
 */
export function fileName(index: number, request: RecordedRequest): string {
  let what: string;
  if (request.operation !== undefined) {
    what = `graphql-${sanitize(request.operation)}`;
  } else {
    let path = '';
    try {
      path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      // Not a URL: no path to name it by.
    }
    what = sanitize(path);
  }
  return `${String(index).padStart(3, '0')}-${sanitize(request.method)}-${what}.json`;
}

/** `text` with anything but ASCII letters, digits and dashes replaced by `_`. */
function sanitize(text: string): string {
  return Array.from(text, (char) => (/^[A-Za-z0-9-]$/.test(char) ? char : '_')).join('');
}

/** What identifies a request, without its headers, in the order the files write it. */
export function recordedRequest(
  method: string,
  url: URL,
  body: Uint8Array | string,
  conditions: { ifNoneMatch?: string | null; ifModifiedSince?: string | null } = {},
): RecordedRequest {
  // A signed address, such as an image's, is recorded as the response that led to it was.
  const request: RecordedRequest = { method, url: redactSignedUrls(url.href) };
  const graphql = graphqlBody(url, () => (typeof body === 'string' ? body : utf8(body)));
  if (graphql) {
    request.operation = graphql.operationName;
    request.variables = graphql.variables;
    request.query_sha256 = queryHash(graphql.query);
  } else if (body.length > 0) {
    request.body_sha256 = sha256(body);
  }
  if (conditions.ifNoneMatch != null) request.if_none_match = conditions.ifNoneMatch;
  if (conditions.ifModifiedSince != null) request.if_modified_since = conditions.ifModifiedSince;
  return request;
}

/**
 * The response with only the kept headers, signed URLs redacted and credential fields blanked. The
 * token's scopes are kept only for a request to {@link SCOPES_KEPT_FOR}.
 */
export function recordedResponse(
  url: URL,
  status: number,
  headers: Headers,
  body: Uint8Array,
): RecordedResponse {
  const names =
    url.pathname === SCOPES_KEPT_FOR ? [...KEPT_HEADERS, 'x-oauth-scopes'] : KEPT_HEADERS;
  const kept: Record<string, string> = {};
  for (const name of names.toSorted(compare)) {
    const value = headers.get(name);
    if (value !== null) kept[name] = redactSignedUrls(value);
  }
  const recorded: RecordedResponse = { status, headers: kept };
  if (body.length === 0) return recorded;
  if (isBytes(headers, body)) {
    recorded.body_base64 = Buffer.from(body).toString('base64');
    return recorded;
  }
  const text = redactSignedUrls(utf8(body));
  let json: Json;
  try {
    json = parseJson(text);
  } catch {
    recorded.body_text = text;
    return recorded;
  }
  // A private repository's `temp_clone_token`, and any other credential GitHub hands the account,
  // never reaches a fixture.
  blankCredentials(json);
  recorded.body = json;
  return recorded;
}

/** Whether a body is bytes rather than text: an image, or anything that isn't UTF-8. */
function isBytes(headers: Headers, body: Uint8Array): boolean {
  if (headers.get('content-type')?.toLowerCase().startsWith('image/')) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(body);
    return false;
  } catch {
    return true;
  }
}

/**
 * Query parameters that grant access: signed S3 and Azure URLs (Actions logs, release assets),
 * tokens on private raw and codeload URLs, signed private images, and single sign-on requests.
 */
const SIGNED =
  /((?:^|[?&;])(?:X-Amz-(?:Signature|Credential|Security-Token)|token|access_token|refresh_token|jwt|sig|se|sv|authorization_request)=)[^&\s"'<>]+/g;

/**
 * Replaces the values of query parameters that grant access with `REDACTED`. They're short-lived,
 * but still not for a public repository.
 */
export function redactSignedUrls(text: string): string {
  return text.replace(SIGNED, '$1REDACTED');
}

/** `cassette.json`'s fields in the order the files write them. */
function orderedInfo(info: CassetteInfo): CassetteInfo {
  const ordered: CassetteInfo = { description: info.description };
  if (info.synthetic) ordered.synthetic = true;
  if (info.recorded_at !== undefined) ordered.recorded_at = info.recorded_at;
  if (info.repo !== undefined) ordered.repo = info.repo;
  if (info.schema !== undefined) ordered.schema = info.schema;
  if (info.setup !== undefined) ordered.setup = info.setup;
  return ordered;
}

/**
 * Checks that `token` belongs to {@link RECORDING_ACCOUNT}, asking GitHub's API at `api`. Throws
 * otherwise: recordings are published in a public repository, so they're made only as the bot.
 */
export async function checkRecordingAccount(
  fetch: typeof globalThis.fetch,
  token: string,
  api = 'https://api.github.com',
): Promise<void> {
  const response = await fetch(`${api}/user`, {
    headers: { authorization: `token ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} when asked whose token this is`);
  }
  const user = parseJson(await response.text());
  const login = isObject(user) ? user['login'] : undefined;
  if (login !== RECORDING_ACCOUNT) {
    throw new Error(
      `the token belongs to ${JSON.stringify(login)}, and recordings are made only as ${RECORDING_ACCOUNT}`,
    );
  }
}
