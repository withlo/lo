/**
 * GitHub's GraphQL responses: data, errors, or both when GitHub returns partial data, with the
 * `type` GitHub puts on each error (`NOT_FOUND`, `FORBIDDEN`, …) and the query's `rateLimit` field.
 */

import type { GraphQLRateLimit } from './rate-limit.ts';

/** One error in a GraphQL response. */
export interface GraphQLError {
  message: string;
  /** GitHub's error type, such as `NOT_FOUND` or `FORBIDDEN`. Validation errors have none. */
  type?: string | undefined;
  /** Where in the data the error happened, from the query's root. Empty for an error about the whole query. */
  path: (string | number)[];
  extensions?: unknown;
}

/** Whether `error` is about a field deeper than `depth` from the root: one GitHub left out of data it otherwise returned. */
export function isBelow(error: GraphQLError, depth: number): boolean {
  return error.path.length > depth;
}

/** A decoded GraphQL response. */
export interface GraphQLResponse<T = unknown> {
  /** The data, partial when there are errors; `undefined` when there's none. */
  data: T | undefined;
  errors: GraphQLError[];
  /** The `rateLimit` field, if the query asked for one. */
  rateLimit: GraphQLRateLimit | undefined;
}

/** Splits a response body into its data, its errors, and the `rateLimit` field if the query asked for one. Throws when it isn't a GraphQL response. */
export function decodeGraphQL(body: string): GraphQLResponse {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch (error) {
    throw new Error(`not a GraphQL response: ${String(error)}`, { cause: error });
  }
  if (!isRecord(envelope)) throw new Error('not a GraphQL response: not an object');
  const { data, errors } = envelope;
  if (data !== undefined && data !== null && !isRecord(data)) {
    throw new Error('not a GraphQL response: its data is not an object');
  }
  if (errors !== undefined && errors !== null && !Array.isArray(errors)) {
    throw new Error('not a GraphQL response: its errors are not a list');
  }
  const rateLimit =
    isRecord(data) && isRateLimit(data['rateLimit']) ? data['rateLimit'] : undefined;
  return {
    data: isRecord(data) ? data : undefined,
    errors: (errors ?? []).map(toError),
    rateLimit,
  };
}

function toError(value: unknown): GraphQLError {
  if (!isRecord(value)) return { message: String(value), path: [] };
  const path = Array.isArray(value['path'])
    ? value['path'].filter((part) => typeof part === 'string' || typeof part === 'number')
    : [];
  return {
    message: typeof value['message'] === 'string' ? value['message'] : '',
    type: typeof value['type'] === 'string' ? value['type'] : undefined,
    path,
    extensions: value['extensions'],
  };
}

function isRateLimit(value: unknown): value is GraphQLRateLimit {
  return (
    isRecord(value) &&
    typeof value['limit'] === 'number' &&
    typeof value['remaining'] === 'number' &&
    typeof value['used'] === 'number' &&
    typeof value['resetAt'] === 'string'
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
