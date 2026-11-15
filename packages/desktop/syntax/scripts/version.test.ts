import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { tagsVersion } from '../src/version.ts';
import { readingCode, root, versionInputs, versionOf } from './version.ts';

const read = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('tagsVersion', () => {
  test('is the hash of the files as they are', () => {
    expect(tagsVersion).toBe(versionOf(versionInputs(read)));
  });

  test('changes with a grammar, a tags query or the code that reads them', () => {
    const changed = (file: string, change: (text: string) => string): string =>
      versionOf(versionInputs((each) => (each === file ? change(read(each)) : read(each))));
    const grammars: { grammars: { name: string; commit: string }[] } = JSON.parse(
      read('grammars.json'),
    );

    const versions = [
      tagsVersion,
      changed('grammars.json', (text) =>
        text.replace(grammars.grammars.find(({ name }) => name === 'rust')!.commit, '0'.repeat(40)),
      ),
      changed('queries/rust/tags.scm', (text) => `${text}\n; A comment.\n`),
      changed('queries/typescript/lo-tags.scm', (text) => `${text}\n; A comment.\n`),
      changed('queries/go/imports.scm', (text) => `${text}\n; A comment.\n`),
      changed(readingCode[0]!, (text) => `${text}\n`),
    ];

    expect(new Set(versions).size).toBe(versions.length);
  });

  test("doesn't change with what the tagger doesn't read", () => {
    const grammars: { grammars: { name: string; commit: string }[] } = JSON.parse(
      read('grammars.json'),
    );
    const markdown = grammars.grammars.find(({ name }) => name === 'markdown')!;
    const inputs = versionInputs((file) => {
      const text = read(file);
      return file === 'grammars.json' ? text.replace(markdown.commit, '0'.repeat(40)) : text;
    });

    expect(versionOf(inputs)).toBe(tagsVersion);
    expect(inputs.some((input) => input.includes('highlights.scm'))).toBe(false);
    expect(versionOf(versionInputs((file) => read(file).replaceAll('\n', '\r\n')))).toBe(
      tagsVersion,
    );
  });
});
