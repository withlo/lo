import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Language, Parser, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, test } from 'vitest';

import { packageFolder } from './disk.ts';
import { languageNames, languages } from './languages.ts';
import { tokenOf, tokens, unstyled } from './tokens.ts';

const queries = join(packageFolder, 'queries');

/** Every query file, as `[language, kind, source]`. */
const files = readdirSync(queries, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap(({ name }) =>
    readdirSync(join(queries, name))
      .filter((file) => file.endsWith('.scm'))
      .map((file) => [name, file, readFileSync(join(queries, name, file), 'utf8')] as const),
  );

function sorted(names: Iterable<string | undefined>): string[] {
  return [...names].map(String).toSorted((a, b) => a.localeCompare(b));
}

/** The capture names a query uses, without those that only feed predicates. */
function capturesOf(source: string): string[] {
  const names = new Set<string>();
  // Strings and comments can hold `@`, so leave them out first.
  const code = source.replaceAll(/"(?:[^"\\]|\\.)*"/g, '""').replaceAll(/;.*$/gm, '');
  for (const [, name] of code.matchAll(/@([\w.-]+)/g)) {
    if (name && !name.startsWith('_')) names.add(name);
  }
  return [...names];
}

describe('the queries', () => {
  const grammars = new Map<string, Language>();
  beforeAll(async () => {
    await Parser.init();
    for (const { grammar } of Object.values(languages)) {
      if (grammars.has(grammar)) continue;
      const wasm = readFileSync(join(packageFolder, 'dist', 'grammars', `${grammar}.wasm`));
      grammars.set(grammar, await Language.load(wasm));
    }
  });

  test('cover every language, each with highlights', () => {
    expect(files.map(([language]) => language).toSorted()).toEqual(
      expect.arrayContaining([...languageNames].toSorted()),
    );
    for (const language of languageNames) {
      expect(files.some(([name, file]) => name === language && file === 'highlights.scm')).toBe(
        true,
      );
    }
  });

  test.each(files.map(([language, file, source]) => [`${language}/${file}`, language, source]))(
    '%s compiles against its grammar',
    (_, language, source) => {
      const name = languageNames.find((known) => known === language)!;
      const grammar = grammars.get(languages[name].grammar)!;
      expect(() => new Query(grammar, source).delete()).not.toThrow();
    },
  );

  test.each(
    files
      .filter(([, file]) => file === 'highlights.scm')
      .map(([language, , source]) => [language, source]),
  )('%s captures only names with a token or meant to have none', (_, source) => {
    const missing = capturesOf(source).filter(
      (name) => tokenOf(name) === undefined && !unstyled.has(name),
    );
    expect(missing).toEqual([]);
  });

  test('leave no name meant to have no style that has a token', () => {
    expect([...unstyled].filter((name) => tokenOf(name) !== undefined)).toEqual([]);
  });
});

describe('tokens', () => {
  test('are the syntax classes code.css styles', () => {
    const css = readFileSync(join(packageFolder, '../../../design/css/code.css'), 'utf8');
    const classes = new Set([...css.matchAll(/\.lo-syn-([\w-]+)/g)].map(([, name]) => name));

    expect(sorted(tokens)).toEqual(sorted(classes));
  });

  test('take the longest name a capture starts with', () => {
    expect(tokens[tokenOf('keyword.control')!]).toBe('keyword');
    expect(tokens[tokenOf('punctuation.list_marker.markup')!]).toBe('punctuation-list_marker');
    expect(tokens[tokenOf('function.method.call')!]).toBe('function-method');
    expect(tokenOf('embedded')).toBeUndefined();
  });
});
