import { describe, expect, test } from 'vitest';

import {
  canonicalJson,
  normalizeQuery,
  queryHash,
  recordedKey,
  requestKey,
  type RecordedRequest,
} from './cassette.ts';

test('query order does not change the key', () => {
  expect(requestKey('GET', 'https://api.github.com/x?b=2&a=1', '')).toBe(
    requestKey('GET', 'https://api.github.com/x?a=1&b=2', ''),
  );
  expect(requestKey('GET', 'https://api.github.com/x?a=1&b=2', '')).toBe(
    'GET https://api.github.com/x?a=1&b=2',
  );
});

test('graphql keys use the operation and canonical variables', () => {
  const a = '{"query":"query A { x }","operationName":"A","variables":{"b":1,"a":2}}';
  const b = '{"operationName":"A","variables":{"a":2,"b":1},"query":"query A {x}"}';
  const graphql = 'https://api.github.com/graphql';
  expect(requestKey('POST', graphql, a)).toBe(requestKey('POST', graphql, b));
  expect(requestKey('POST', graphql, a).startsWith('POST https://api.github.com/graphql A ')).toBe(
    true,
  );
  const other = '{"query":"query A { x }","operationName":"A","variables":{"a":3}}';
  expect(requestKey('POST', graphql, a)).not.toBe(requestKey('POST', graphql, other));
});

test('a recorded request has the same key as the live one', () => {
  const body = '{"query":"query A { x }","operationName":"A","variables":{"n":1}}';
  const graphql = 'https://api.github.com/graphql';
  const recorded: RecordedRequest = {
    method: 'POST',
    url: graphql,
    operation: 'A',
    variables: { n: 1 },
  };
  expect(recordedKey(recorded)).toBe(requestKey('POST', graphql, body));

  const form = 'client_id=abc&scope=repo';
  const device = 'https://github.com/login/device/code';
  const synthetic: RecordedRequest = { method: 'POST', url: device, body: form };
  expect(recordedKey(synthetic)).toBe(requestKey('POST', device, new TextEncoder().encode(form)));
});

test('canonical json sorts nested keys', () => {
  const value = { b: { y: 1, x: [{ d: 1, c: 2 }] }, a: null };
  expect(canonicalJson(value)).toBe('{"a":null,"b":{"x":[{"c":2,"d":1}],"y":1}}');
});

describe('keys', () => {
  test('an operation without variables matches whether it sends none, null or an empty object', () => {
    const graphql = 'https://api.github.com/graphql';
    const recorded: RecordedRequest = {
      method: 'POST',
      url: graphql,
      operation: 'Viewer',
      variables: null,
    };
    for (const variables of ['', ',"variables":null', ',"variables":{}']) {
      const body = `{"query":"query Viewer { viewer { login } }","operationName":"Viewer"${variables}}`;
      expect(requestKey('POST', graphql, body)).toBe(recordedKey(recorded));
    }
  });

  test('a conditional request has its ETag and time in its key', () => {
    const url = 'https://api.github.com/repos/o/r/pulls/1';
    const recorded: RecordedRequest = {
      method: 'GET',
      url,
      if_none_match: 'W/"abc"',
      if_modified_since: 'Fri, 06 Nov 2026 08:15:07 GMT',
    };
    expect(
      requestKey('GET', url, '', {
        ifNoneMatch: 'W/"abc"',
        ifModifiedSince: 'Fri, 06 Nov 2026 08:15:07 GMT',
      }),
    ).toBe(recordedKey(recorded));
    expect(requestKey('GET', url, '')).not.toBe(recordedKey(recorded));
  });

  test('a fragment never changes the key', () => {
    expect(requestKey('GET', 'https://api.github.com/x?a=1#top', '')).toBe(
      'GET https://api.github.com/x?a=1',
    );
  });
});

describe('query hashes', () => {
  test('comments, formatting and the order of definitions leave the hash alone', () => {
    const file = `# What the viewer can see.
query Viewer { viewer { ...Who } }

# Who they are.
fragment Who on User { login
  name }
`;
    const generated =
      'fragment Who on User {\n  login\n  name\n}\nquery Viewer {\n  viewer {\n    ...Who\n  }\n}';
    expect(queryHash(generated)).toBe(queryHash(file));
    expect(normalizeQuery(file)).toBe(normalizeQuery(normalizeQuery(file)));
  });

  test('a changed field changes the hash', () => {
    expect(queryHash('query Viewer { viewer { login } }')).not.toBe(
      queryHash('query Viewer { viewer { login name } }'),
    );
  });
});
