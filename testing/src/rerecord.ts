/**
 * Records one GraphQL query's answers again, in place, in cassettes that hold it: for a query that
 * changed, such as one that reads a field more, when the rest of a cassette must stay as it was
 * recorded. A whole recording again would also bring today's state of everything else the cassette
 * read, and move what the tests that replay it see.
 *
 * Each recorded request of the query's operation is sent again with its recorded variables and the
 * query as it is now, and GitHub's answer replaces the recorded one, with the new query's hash.
 * Nothing else in the cassette changes but `cassette.json`, which notes when the operation was
 * recorded again. As the recorder does, it sends only queries, keeps only the allowed headers,
 * redacts signed URLs and blanks credential fields, and refuses to write the token or anything
 * shaped like one. It writes nothing unless every answer came back as the recorded one did, with
 * the same status, with errors only where it had them, and without a secret.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { Kind, OperationTypeNode, parse } from 'graphql';

import {
  canonicalJson,
  isObject,
  readCassette,
  recordedKey,
  type Cassette,
  type CassetteInfo,
  type Interaction,
  type Json,
  type RecordedResponse,
} from './cassette.ts';
import { fileName, recordedRequest, recordedResponse } from './record.ts';
import { findSecret } from './secrets.ts';

/** The one place a request recorded again goes: GitHub's GraphQL API. */
export const GRAPHQL_URL = 'https://api.github.com/graphql';

export interface RerecordOptions {
  /** The `fetch` that reaches GitHub. */
  fetch: typeof globalThis.fetch;
  /** The bot's token, which signs each request and must never be written. */
  token: string;
  /** The query as it is now: one query operation, as a `.graphql` file holds it. */
  query: string;
  /**
   * The cassettes, by folder, each with the files of the requests to record again, or every
   * request of the operation when it names none, as when GitHub's state for some has moved on.
   */
  cassettes: readonly RerecordedCassette[];
  /** When, for `cassette.json`, as an ISO time to the second. */
  at: string;
}

export interface RerecordedCassette {
  dir: string;
  files?: readonly string[] | undefined;
}

/** The name of the one operation in `query`, which must be a query: anything else could write. */
export function queryOperation(query: string): string {
  const operations = parse(query).definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  const [operation] = operations;
  if (operations.length !== 1 || operation?.kind !== Kind.OPERATION_DEFINITION) {
    throw new Error('the file must hold exactly one operation');
  }
  if (operation.operation !== OperationTypeNode.QUERY || operation.name === undefined) {
    throw new Error('only a named query is recorded again, since anything else could write');
  }
  return operation.name.value;
}

/**
 * Records `query`'s answers again in `cassettes`, as the module's docs say, and returns how many
 * it recorded in each folder. A cassette or a file that holds no request of the operation is
 * refused, as is any answer unlike the recorded one, before anything is written.
 */
export async function rerecord(options: RerecordOptions): Promise<Map<string, number>> {
  const { fetch, token, query, cassettes, at } = options;
  const operation = queryOperation(query);
  const writes: { path: string; text: string }[] = [];
  const counts = new Map<string, number>();
  for (const { dir, files } of cassettes) {
    const cassette = recordedCassette(dir);
    const recorded = cassette.interactions.filter(
      ({ file, interaction }) =>
        interaction.request.operation === operation && (files?.includes(file) ?? true),
    );
    const named = new Set(recorded.map(({ file }) => file));
    const missing = (files ?? []).filter((file) => !named.has(file));
    if (missing.length > 0)
      throw new Error(`${dir} holds no ${operation} in ${missing.join(', ')}`);
    if (recorded.length === 0) throw new Error(`${dir} holds no ${operation}`);
    for (const { file, interaction } of recorded) {
      const again = await ask(fetch, token, query, operation, interaction);
      const was = interaction.response;
      const now = again.response;
      if (now.status !== was.status || hasErrors(now) !== hasErrors(was)) {
        throw new Error(
          `${join(dir, file)}: GitHub answered ${now.status}${hasErrors(now) ? ' with errors' : ''}, where it was recorded answering ${was.status}${hasErrors(was) ? ' with errors' : ''}`,
        );
      }
      writes.push({ path: join(dir, file), text: `${JSON.stringify(again, null, 2)}\n` });
    }
    const info: CassetteInfo = {
      ...cassette.info,
      rerecorded: { ...cassette.info.rerecorded, [operation]: at },
    };
    writes.push({ path: join(dir, 'cassette.json'), text: `${JSON.stringify(info, null, 2)}\n` });
    counts.set(dir, recorded.length);
  }
  for (const { path, text } of writes) {
    const found = findSecret(text, [token]);
    if (found) throw new Error(`${path} would contain ${found}, so nothing was written`);
  }
  for (const { path, text } of writes) writeFileSync(path, text);
  return counts;
}

export interface AddOptions {
  /** The `fetch` that reaches GitHub. */
  fetch: typeof globalThis.fetch;
  /** The bot's token, which signs each request and must never be written. */
  token: string;
  /** The query: one query operation, as a `.graphql` file holds it. */
  query: string;
  /** The variables of each request to add, in order. */
  variables: readonly Json[];
  /** The cassettes' folders. */
  dirs: readonly string[];
  /** When, for `cassette.json`, as an ISO time to the second. */
  at: string;
}

/**
 * Records `query`'s answers to requests with `variables`, which `dirs`' cassettes don't hold yet,
 * and adds each as a file after the cassette's others: for a read that what replays a cassette
 * began to send after it was recorded, so the rest of it stays as it was. Each cassette gets its
 * own request to GitHub. Nothing else changes but `cassette.json`, which notes when the operation
 * was added. As {@link rerecord} does, it sends only queries and keeps only what the recorder
 * keeps; it writes nothing unless every answer came back `200` without errors and without a
 * secret, and refuses a cassette that already holds the operation with the same variables.
 * Returns how many it added in each folder.
 */
export async function addAnswers(options: AddOptions): Promise<Map<string, number>> {
  const { fetch, token, query, variables, dirs, at } = options;
  const operation = queryOperation(query);
  const writes: { path: string; text: string }[] = [];
  const counts = new Map<string, number>();
  for (const dir of dirs) {
    const cassette = recordedCassette(dir);
    const held = new Set(
      cassette.interactions
        .filter(({ interaction }) => interaction.request.operation === operation)
        .map(({ interaction }) => canonicalJson(interaction.request.variables ?? null)),
    );
    let index = Math.max(
      0,
      ...cassette.interactions.map(({ file }) => Number.parseInt(file, 10) || 0),
    );
    for (const asked of variables) {
      if (held.has(canonicalJson(asked))) {
        throw new Error(`${dir} holds ${operation} with ${JSON.stringify(asked)} already`);
      }
      const request: Interaction = {
        request: { method: 'POST', url: GRAPHQL_URL, operation, variables: asked },
        response: { status: 200, headers: {} },
      };
      const answer = await ask(fetch, token, query, operation, request);
      if (answer.response.status !== 200 || hasErrors(answer.response)) {
        throw new Error(
          `${dir}: GitHub answered ${operation} with ${JSON.stringify(asked)} ${answer.response.status}${hasErrors(answer.response) ? ' with errors' : ''}`,
        );
      }
      index += 1;
      writes.push({
        path: join(dir, fileName(index, answer.request)),
        text: `${JSON.stringify(answer, null, 2)}\n`,
      });
    }
    const info: CassetteInfo = {
      ...cassette.info,
      added: { ...cassette.info.added, [operation]: at },
    };
    writes.push({ path: join(dir, 'cassette.json'), text: `${JSON.stringify(info, null, 2)}\n` });
    counts.set(dir, variables.length);
  }
  for (const { path, text } of writes) {
    const found = findSecret(text, [token]);
    if (found) throw new Error(`${path} would contain ${found}, so nothing was written`);
  }
  for (const { path, text } of writes) writeFileSync(path, text);
  return counts;
}

export interface CopyOptions {
  /** The file of the recorded interaction to copy, in another cassette. */
  from: string;
  /** The cassettes' folders. */
  dirs: readonly string[];
  /** When, for `cassette.json`, as an ISO time to the second. */
  at: string;
}

/**
 * Adds the interaction recorded in `from` to `dirs`' cassettes, each in a file after its others,
 * as {@link addAnswers} adds a query's: for a request that what replays them began to send after
 * they were recorded, which another cassette holds as GitHub answers it, such as an avatar. Refuses
 * a cassette that holds the same request already, and writes nothing that holds a secret.
 */
export function copyAnswer({ from, dirs, at }: CopyOptions): void {
  const copied = readCassette(dirname(from)).interactions.find(
    ({ file }) => file === basename(from),
  )?.interaction;
  if (!copied) throw new Error(`${from} holds no recorded request`);
  const { request } = copied;
  const what = request.operation ?? `${request.method} ${request.url}`;
  const writes: { path: string; text: string }[] = [];
  for (const dir of dirs) {
    const cassette = recordedCassette(dir);
    const key = recordedKey(request);
    if (cassette.interactions.some(({ interaction }) => recordedKey(interaction.request) === key)) {
      throw new Error(`${dir} holds ${what} already`);
    }
    const index = Math.max(
      0,
      ...cassette.interactions.map(({ file }) => Number.parseInt(file, 10) || 0),
    );
    writes.push({
      path: join(dir, fileName(index + 1, request)),
      text: `${JSON.stringify(copied, null, 2)}\n`,
    });
    const info: CassetteInfo = { ...cassette.info, added: { ...cassette.info.added, [what]: at } };
    writes.push({ path: join(dir, 'cassette.json'), text: `${JSON.stringify(info, null, 2)}\n` });
  }
  for (const { path, text: written } of writes) {
    const found = findSecret(written, []);
    if (found) throw new Error(`${path} would contain ${found}, so nothing was written`);
  }
  for (const { path, text: written } of writes) writeFileSync(path, written);
}

/** Whether a GraphQL answer holds errors. */
function hasErrors(response: RecordedResponse): boolean {
  return isObject(response.body) && Array.isArray(response.body['errors']);
}

/** `interaction`'s request sent again with `query`, and GitHub's answer, as the recorder keeps them. */
async function ask(
  fetch: typeof globalThis.fetch,
  token: string,
  query: string,
  operationName: string,
  interaction: Interaction,
): Promise<Interaction> {
  const { request } = interaction;
  if (request.method !== 'POST' || request.url !== GRAPHQL_URL) {
    throw new Error(`a recorded ${operationName} went to ${request.method} ${request.url}`);
  }
  const variables: Json = request.variables ?? null;
  const body = JSON.stringify({ query, operationName, variables });
  const url = new URL(GRAPHQL_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `token ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    request: recordedRequest('POST', url, body),
    response: recordedResponse(url, response.status, response.headers, bytes),
  };
}

/** Reads a `.graphql` file's text. */
export function readQuery(path: string): string {
  const text = readFileSync(path, 'utf8');
  queryOperation(text);
  return text;
}

/**
 * The cassette in `dir`, to change in place: a recorded one. A derived one is written again from
 * its recorded one instead (`testing/scripts/derive-answers.ts`).
 */
function recordedCassette(dir: string): Cassette {
  const cassette = readCassette(dir);
  const from = cassette.info.derived_from;
  if (from !== undefined) {
    throw new Error(
      `${dir} is derived from ${from}: change ${from}, then run testing/scripts/derive-answers.ts`,
    );
  }
  return cassette;
}
