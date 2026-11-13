/**
 * Recorded GitHub responses ("cassettes"), shared by the replayer and the recorder.
 *
 * A cassette is a folder with a `cassette.json` describing it and one file per request and
 * response, named `NNN-<METHOD>-<what>.json` and replayed in name order. Requests are matched by
 * a key: the method and URL with its query sorted, and the ETag or time a conditional request
 * sent; for GraphQL, the operation's name and its variables; for any other request with a body, a
 * hash of the body. Request headers are never stored, so a token can't end up in one.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Kind, parse, print, type DefinitionNode } from 'graphql';

/** A JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The folder holding the recorded GitHub responses. */
export const fixturesDir = fileURLToPath(new URL('../fixtures/github', import.meta.url));

/** `cassette.json`. */
export interface CassetteInfo {
  /** What the cassette shows. */
  description: string;
  /** Written by hand rather than recorded. */
  synthetic?: boolean;
  recorded_at?: string;
  /** The repository it was recorded from, `owner/name`. */
  repo?: string;
  /** The `github/docs` commit the GraphQL schema came from, when it was recorded. */
  schema?: string;
  /**
   * What the recorder made on GitHub for the recording, such as the pull requests it opened,
   * which a replay reads to send the requests the recording sent.
   */
  setup?: Json;
  /**
   * The GraphQL operations whose answers were recorded again in place after a query changed, each
   * with when (`testing/scripts/rerecord.ts`). The rest is as of `recorded_at`.
   */
  rerecorded?: Record<string, string>;
  /**
   * The GraphQL operations whose answers were added in place, after the code that replays the
   * cassette began to send them, each with when (`testing/scripts/add-answers.ts`). The rest is as
   * of `recorded_at`.
   */
  added?: Record<string, string>;
}

/** One request and the response GitHub gave it. */
export interface Interaction {
  request: RecordedRequest;
  response: RecordedResponse;
}

/** What identifies a request. Its headers are never stored. */
export interface RecordedRequest {
  method: string;
  url: string;
  /** The GraphQL operation's name. */
  operation?: string;
  /** The GraphQL operation's variables. */
  variables?: Json;
  /** The normalized GraphQL query's hash ({@link queryHash}), so a changed query asks for a new recording. */
  query_sha256?: string;
  /** A hash of any other request body. */
  body_sha256?: string;
  /** The body itself, for synthetic cassettes, in place of `body_sha256`. */
  body?: string;
  /** The ETag the request sent, for conditional requests. */
  if_none_match?: string;
  /** The time a conditional request asked about changes since. */
  if_modified_since?: string;
}

export interface RecordedResponse {
  status: number;
  /** Only {@link KEPT_HEADERS}, lowercased. */
  headers: Record<string, string>;
  /** The body, when it's JSON. */
  body?: Json;
  /** The body, when it's other text. */
  body_text?: string;
  /** The body, in base64, when it's an image or any other bytes that aren't text. */
  body_base64?: string;
}

/** A cassette as read from its folder, its interactions in file-name order. */
export interface Cassette {
  name: string;
  info: CassetteInfo;
  interactions: { file: string; interaction: Interaction }[];
}

/**
 * The response headers a cassette keeps. Everything else, such as cookies and request IDs, is
 * dropped when recording. So are the recording token's scopes (`x-oauth-scopes`), but on an answer
 * to `GET /user`, where they're what Lo reads ({@link SCOPES_KEPT_FOR}).
 */
export const KEPT_HEADERS: readonly string[] = [
  'content-type',
  'etag',
  'last-modified',
  'link',
  'location',
  'retry-after',
  'x-github-api-version-selected',
  'x-github-sso',
  'x-poll-interval',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'x-ratelimit-used',
];

/** The path whose answers keep `x-oauth-scopes`: `GET /user`, which Lo asks to learn a token's scopes. */
export const SCOPES_KEPT_FOR = '/user';

/** Statuses whose responses have no body, which `Response` refuses one for. */
export const NULL_BODY: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/** The bytes of the response body a recorded response stands for. */
export function responseBody(response: RecordedResponse): Uint8Array<ArrayBuffer> {
  if (response.body_base64 !== undefined) {
    return new Uint8Array(Buffer.from(response.body_base64, 'base64'));
  }
  const text =
    response.body !== undefined && response.body !== null
      ? JSON.stringify(response.body)
      : (response.body_text ?? '');
  return new TextEncoder().encode(text);
}

/** What a GraphQL request body holds. */
export interface GraphQLBody {
  query: string;
  operationName: string;
  variables: Json;
}

/** Reads a request body as a GraphQL operation, if it's one: a POST body to `/graphql`. */
export function graphqlBody(url: URL, body: string | (() => string)): GraphQLBody | undefined {
  if (url.pathname !== '/graphql') return undefined;
  let json: Json;
  try {
    json = parseJson(typeof body === 'string' ? body : body());
  } catch {
    return undefined;
  }
  if (!isObject(json)) return undefined;
  const { query, operationName, variables } = json;
  if (typeof query !== 'string' || typeof operationName !== 'string') return undefined;
  return { query, operationName, variables: variables ?? null };
}

/** The conditions a conditional request sent. */
export interface Conditions {
  ifNoneMatch?: string | null | undefined;
  ifModifiedSince?: string | null | undefined;
}

/**
 * The key a request is matched by. A conditional request only matches the response recorded for
 * the same ETag or time, so a wrong one can't get a recorded `304`.
 */
export function requestKey(
  method: string,
  url: string,
  body: Uint8Array | string,
  conditions: Conditions = {},
): string {
  const parsed = new URL(url);
  const graphql = graphqlBody(parsed, typeof body === 'string' ? body : () => utf8(body));
  const normalized = normalizeUrl(parsed);
  let key: string;
  if (graphql) {
    key = graphqlKey(method, normalized, graphql.operationName, graphql.variables);
  } else if (body.length === 0) {
    key = `${method} ${normalized}`;
  } else {
    key = `${method} ${normalized} body=${sha256(body)}`;
  }
  return withConditions(key, conditions.ifNoneMatch, conditions.ifModifiedSince);
}

/** The key of a recorded request. */
export function recordedKey(request: RecordedRequest): string {
  const normalized = normalizeUrl(new URL(request.url));
  let key: string;
  if (request.operation !== undefined) {
    key = graphqlKey(request.method, normalized, request.operation, request.variables ?? null);
  } else if (request.body !== undefined) {
    key = `${request.method} ${normalized} body=${sha256(request.body)}`;
  } else if (request.body_sha256 !== undefined) {
    key = `${request.method} ${normalized} body=${request.body_sha256}`;
  } else {
    key = `${request.method} ${normalized}`;
  }
  return withConditions(key, request.if_none_match, request.if_modified_since);
}

function withConditions(
  key: string,
  ifNoneMatch: string | null | undefined,
  ifModifiedSince: string | null | undefined,
): string {
  if (ifNoneMatch != null) key = `${key} if-none-match=${ifNoneMatch}`;
  if (ifModifiedSince != null) key = `${key} if-modified-since=${ifModifiedSince}`;
  return key;
}

/**
 * The key of a GraphQL request: its operation and its variables, with their keys sorted. An
 * operation without variables sends none, `null` or `{}`, which GraphQL treats alike, so all three
 * match.
 */
function graphqlKey(method: string, url: string, operation: string, variables: Json): string {
  const none = variables === null || (isObject(variables) && Object.keys(variables).length === 0);
  return `${method} ${url} ${operation} variables=${none ? 'null' : canonicalJson(variables)}`;
}

/** The URL with its query pairs sorted, so their order doesn't matter, and no fragment. */
export function normalizeUrl(url: URL): string {
  const normalized = new URL(url);
  const pairs = [...normalized.searchParams].toSorted(
    ([a, x], [b, y]) => compare(a, b) || compare(x, y),
  );
  normalized.search = pairs.length === 0 ? '' : new URLSearchParams(pairs).toString();
  normalized.hash = '';
  return normalized.href;
}

/** JSON with every object's keys sorted. */
export function canonicalJson(value: Json): string {
  return JSON.stringify(sortedKeys(value));
}

function sortedKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!isObject(value)) return value;
  const entries = Object.entries(value).toSorted(([a], [b]) => compare(a, b));
  return Object.fromEntries(entries.map(([key, field]) => [key, sortedKeys(field)]));
}

/**
 * A GraphQL document in a canonical form: parsed and printed again, which drops comments and
 * settles formatting, with its operations and fragments sorted by name, so the order a file or a
 * code generator puts them in doesn't matter. Throws when the query doesn't parse.
 */
export function normalizeQuery(query: string): string {
  const document = parse(query, { noLocation: true });
  const definitions = document.definitions.toSorted((a, b) =>
    compare(definitionName(a), definitionName(b)),
  );
  return print({ ...document, definitions });
}

function definitionName(definition: DefinitionNode): string {
  const named =
    definition.kind === Kind.OPERATION_DEFINITION || definition.kind === Kind.FRAGMENT_DEFINITION;
  return named ? (definition.name?.value ?? '') : '';
}

/**
 * The hash a cassette keeps of a GraphQL query: of its normalized form ({@link normalizeQuery}),
 * so editing a query's comments or formatting never asks for a new recording.
 */
export function queryHash(query: string): string {
  return sha256(normalizeQuery(query));
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The folder of the cassette `name` in {@link fixturesDir}. A name is letters, digits, `_` and
 * `-`, so it can't point anywhere else.
 */
export function cassetteDir(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(
      `${JSON.stringify(name)} isn't a cassette's name: use letters, digits, _ and -`,
    );
  }
  return join(fixturesDir, name);
}

/** Reads the cassette `name` from {@link fixturesDir}. */
export function cassette(name: string): Cassette {
  return readCassette(cassetteDir(name));
}

/** Reads a cassette's folder: `cassette.json` and its interactions, in file-name order. */
export function readCassette(dir: string): Cassette {
  const info = readJson(join(dir, 'cassette.json'));
  if (!isCassetteInfo(info)) {
    throw new Error(`${join(dir, 'cassette.json')} has no description`);
  }
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json') && file !== 'cassette.json')
    .toSorted(compare);
  const interactions = files.map((file) => {
    const path = join(dir, file);
    const interaction = readJson(path);
    if (!isInteraction(interaction)) {
      throw new Error(`${path} isn't a recorded request and response`);
    }
    return { file, interaction };
  });
  return { name: basename(dir), info, interactions };
}

function readJson(path: string): Json {
  try {
    return parseJson(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`reading ${path}`, { cause: error });
  }
}

/** Parses JSON text. Throws when it isn't JSON. */
export function parseJson(text: string): Json {
  const value: unknown = JSON.parse(text);
  if (!isJson(value)) throw new Error('not JSON');
  return value;
}

function isJson(value: unknown): value is Json {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === 'object' && Object.values(value).every(isJson);
}

function isCassetteInfo(value: Json): value is Json & CassetteInfo {
  return isObject(value) && typeof value['description'] === 'string';
}

function isInteraction(value: Json): value is Json & Interaction {
  if (!isObject(value)) return false;
  const { request, response } = value;
  return (
    isObject(request) &&
    typeof request['method'] === 'string' &&
    typeof request['url'] === 'string' &&
    isObject(response) &&
    typeof response['status'] === 'number' &&
    isObject(response['headers'] ?? {})
  );
}

export function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Orders strings by their UTF-16 code units, the same everywhere. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
