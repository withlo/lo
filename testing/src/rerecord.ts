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
import { join } from 'node:path';

import { Kind, OperationTypeNode, parse } from 'graphql';

import {
  isObject,
  readCassette,
  type CassetteInfo,
  type Interaction,
  type Json,
  type RecordedResponse,
} from './cassette.ts';
import { recordedRequest, recordedResponse } from './record.ts';
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
    const cassette = readCassette(dir);
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
