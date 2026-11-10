import { inspect } from 'node:util';

import { expect, test } from 'vitest';

import { Token } from './token.ts';

test('tokens stay out of debug output', () => {
  const token = new Token('gho_secret');
  for (const shown of [
    String(token),
    token.toString(),
    JSON.stringify({ token }),
    inspect(token),
    inspect({ token }, { depth: 5, showHidden: true }),
  ]) {
    expect(shown).not.toContain('secret');
  }
  expect(String(token)).toBe('Token(redacted)');
  expect(token.expose()).toBe('gho_secret');
});
