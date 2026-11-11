import { expect, test } from 'vitest';

import { parseOid } from './oid.ts';

test('accepts sha1 and sha256 ids and lowercases them', () => {
  const sha1 = '22C70ACC6992C0C51CB68527B87ADF114D01ACBC';
  const oid = parseOid(sha1);
  expect(oid).toBe(sha1.toLowerCase());
  expect(oid.slice(0, 7)).toBe('22c70ac');
  expect(parseOid('a'.repeat(64))).toBe('a'.repeat(64));
});

test('refuses anything else', () => {
  const notIds = [
    '',
    'HEAD',
    '22c70ac',
    'refs/heads/main',
    '--upload-pack=evil-and-forty-characters-long',
    'g'.repeat(40),
    'a'.repeat(41),
    `${'a'.repeat(40)}\n`,
  ];
  const said = notIds.map((value) => {
    try {
      return parseOid(value);
    } catch (error) {
      return String(error);
    }
  });
  expect(said).toEqual(notIds.map(() => expect.stringContaining("isn't a valid commit ID")));
});
