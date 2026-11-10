// Every committed fixture is checked as the recorder checks a new one before writing it: no GitHub
// token, nor anything shaped like one, and no credential field that isn't blank, such as the
// `temp_clone_token` GitHub gives an account that can read a private repository. This repository
// is public. The one exception is a synthetic cassette's stand-in token, spelled exactly as they
// spell it: `gho_FAKE_SIGNED_IN`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import {
  findToken,
  isCredentialField,
  isObject,
  parseJson,
  unblankedCredentials,
  type Json,
} from '../src/index.ts';

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url));

/** Every file under `dir`, at any depth. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Whether `value` is a synthetic cassette's stand-in token: `gh`, a letter, `_FAKE`, and capital letters and underscores. */
function standIn(value: Json): boolean {
  return typeof value === 'string' && /^gh[a-z]_FAKE[A-Z_]*$/.test(value);
}

/** Whether the cassette `dir` says it was written by hand. */
function synthetic(dir: string): boolean {
  const info = join(dir, 'cassette.json');
  if (!existsSync(info)) return false;
  try {
    const json = parseJson(readFileSync(info, 'utf8'));
    return isObject(json) && json['synthetic'] === true;
  } catch {
    return false;
  }
}

test('no fixture holds a credential', () => {
  const found = files(fixtures);
  expect(found.length).toBeGreaterThan(100);
  const leaks: string[] = [];
  for (const path of found) {
    const bytes = readFileSync(path);
    const token = findToken(bytes, []);
    if (token) leaks.push(`${path}: ${token}`);
    let json: Json;
    try {
      json = parseJson(bytes.toString('utf8'));
    } catch {
      continue;
    }
    for (const [pointer, value] of unblankedCredentials(json)) {
      if (!(synthetic(dirname(path)) && standIn(value))) leaks.push(`${path}: ${pointer}`);
    }
  }
  expect(leaks).toEqual([]);
});

test('credential fields are found in either case', () => {
  const credentials = [
    'token',
    'temp_clone_token',
    'tempCloneToken',
    'clientSecret',
    'password',
    'jwt',
  ];
  expect(credentials.filter((key) => !isCredentialField(key))).toEqual([]);
  const others = ['token_count', 'tokenCount', 'secret_scanning', 'tokens'];
  expect(others.filter(isCredentialField)).toEqual([]);
  const json = { repository: { tempCloneToken: 'X1', name: 'p' } };
  expect(unblankedCredentials(json)).toHaveLength(1);
  expect(standIn('gho_FAKE_SIGNED_IN')).toBe(true);
  expect(standIn('CUG42RBWQ6AFAKEHIGO5G4LK6FOJM')).toBe(false);
});
