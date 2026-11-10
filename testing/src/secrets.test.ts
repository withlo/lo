import { expect, test } from 'vitest';

import { base64, findSecret } from './secrets.ts';

test('find secret spots the token and token shapes', () => {
  const secret = 'not-a-real-token-but-secret';
  expect(findSecret('xx not-a-real-token-but-secret yy', [secret])).toBe('the recording token');
  const shaped = `"gho_${'a1'.repeat(18)}"`;
  expect(findSecret(shaped, [])).toBe('something shaped like a GitHub token');
  const pat = `github_pat_${'A_'.repeat(30)}`;
  expect(findSecret(pat, [])).toBeDefined();
  expect(findSecret('gho_FAKE short', [secret])).toBeUndefined();
});

test('base64 encodes like everyone else', () => {
  expect(base64('')).toBe('');
  expect(base64('f')).toBe('Zg==');
  expect(base64('fo')).toBe('Zm8=');
  expect(base64('foo')).toBe('Zm9v');
  expect(base64('foobar')).toBe('Zm9vYmFy');
  expect(base64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
});

test('find secret spots authorization headers, bearer tokens, hex tokens and JWTs', () => {
  const hex = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
  expect(findSecret('Authorization: token abcdefgh12345678', [])).toBe('an authorization header');
  expect(findSecret('{"authorization":"Bearer abcdefgh12345678"}', [])).toBe(
    'an authorization header',
  );
  expect(findSecret('curl -H "x: Bearer abcdefghijklmnop1234"', [])).toBe('a bearer token');
  expect(findSecret(`{"access_token":"${hex}"}`, [])).toBe(
    'a 40-digit hex token beside a key that names a credential',
  );
  expect(findSecret(`token=${hex}`, [])).toBeDefined();
  expect(
    findSecret('x?jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', []),
  ).toBe('a JSON web token');
  // A commit's ID beside an ordinary key, and the word "bearer" in a sentence, are fine.
  expect(findSecret(`{"sha":"${hex}","head":{"sha":"${hex}"}}`, [])).toBeUndefined();
  expect(findSecret('the bearer of bad news', [])).toBeUndefined();
});

test('find secret spots the token percent encoded or in base64', () => {
  const secrets = ['gho_not-a-real-token-but-secret'];
  // In a URL's query.
  expect(findSecret('?t=gho%5Fnot-a-real-token-but-secret', secrets)).toBeDefined();
  expect(findSecret('?t=gho%5fnot-a-real-token-but-secret', secrets)).toBeDefined();
  // In a file's base64 body, as the contents API returns it: at any offset, with GitHub's line
  // breaks, escaped in JSON.
  const missed = ['', 'x', 'xy', 'a longer prefix: ']
    .map((prefix) => {
      const file = `${prefix}token = gho_not-a-real-token-but-secret\n`;
      const lines = base64(file).match(/.{1,60}/g) ?? [];
      return `{"content":"${lines.join('\\n')}"}`;
    })
    .filter((json) => findSecret(json, secrets) === undefined);
  expect(missed).toEqual([]);
  // And a token shape, percent-encoded.
  expect(findSecret(`gho%5F${'a1'.repeat(18)}`, [])).toBeDefined();
  expect(findSecret('nothing to see', secrets)).toBeUndefined();
});
