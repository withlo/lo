import { expect, test } from 'vitest';

import { decodeGraphQL } from './graphql.ts';

test('keeps partial data and typed errors', () => {
  const body = `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],"locations":[{"line":1,"column":2}],"message":"Could not resolve to a Repository with the name 'rozed-dev/nope'."}]}`;
  const response = decodeGraphQL(body);
  expect(response.data).toEqual({ repository: null });
  expect(response.errors[0]?.type).toBe('NOT_FOUND');
  expect(response.rateLimit).toBeUndefined();
});

test('errors without data', () => {
  const body = `{"errors":[{"path":["query"],"extensions":{"code":"undefinedField"},"message":"Field 'nope' doesn't exist"}]}`;
  const response = decodeGraphQL(body);
  expect(response.data).toBeUndefined();
  expect(response.errors[0]?.type).toBeUndefined();
  expect(response.errors[0]?.extensions).toBeDefined();
});

test('reads the rate limit field', () => {
  const body =
    '{"data":{"rateLimit":{"cost":1,"limit":5000,"remaining":4999,"used":1,"resetAt":"2026-11-06T09:00:00Z"},"repository":{}}}';
  expect(decodeGraphQL(body).rateLimit?.remaining).toBe(4999);
});

// A typed error nulls a field, and the error is what explains it: the data comes back as GitHub
// sent it, with its errors.
test('errors are kept when the data doesnt fit', () => {
  const body =
    '{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],"message":"Could not resolve to a Repository"}]}';
  const response = decodeGraphQL(body);
  expect(response.data).toEqual({ repository: null });
  expect(response.errors[0]?.type).toBe('NOT_FOUND');
});

test('an error whose path is null is read', () => {
  const response = decodeGraphQL('{"errors":[{"message":"Something went wrong","path":null}]}');
  expect(response.errors[0]?.path).toEqual([]);
});

test('rejects a body that is not graphql', () => {
  expect(() => decodeGraphQL('<html>')).toThrow('not a GraphQL response');
});
