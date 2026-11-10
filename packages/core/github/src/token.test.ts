import { inspect } from 'node:util';

import { expect, test } from 'vitest';

import { GithubError } from './errors.ts';
import { Token } from './token.ts';

test('debug hides the token', () => {
  const token = new Token('gho_secretsecretsecret');
  for (const shown of [
    String(token),
    JSON.stringify({ token }),
    inspect(token),
    token.toString(),
  ]) {
    expect(shown).not.toContain('secret');
  }
  expect(String(token)).toBe('Token(oauth, redacted)');
});

test('new trims whitespace', () => {
  expect(new Token('  gho_abc\n').expose()).toBe('gho_abc');
  expect(new Token('gho_abc').expose()).toBe('gho_abc');
});

test('kind comes from the prefix', () => {
  expect(new Token('gho_x').kind).toBe('oauth');
  expect(new Token('ghp_x').kind).toBe('personal');
  expect(new Token('github_pat_x').kind).toBe('fineGrained');
  expect(new Token('ghu_x').kind).toBe('githubApp');
  expect(new Token('x').kind).toBe('unknown');
});

test("a token can't hold a line break or anything else a token never has", () => {
  for (const value of ['gho_abc\ndef', 'gho_abc\r\nx: y', 'gho_a\u0000b', 'gho_a b', 'gho_é']) {
    let thrown: unknown;
    try {
      expect(new Token(value)).toBeUndefined();
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof GithubError && thrown.detail.kind).toBe('unauthorized');
    const said =
      thrown instanceof Error ? [thrown.message, thrown.stack, String(thrown.cause)] : [];
    expect(said.filter((text) => text?.includes('abc') || text?.includes('gho_a'))).toEqual([]);
  }
});
