// Writes src/version.ts: `tagsVersion`, a hash of what decides how the tagger reads a file. That's
// the grammars its languages parse with, as grammars.json pins each by its commit and checks its
// build, the queries it reads them with, and the code that puts their tags together. A change to
// any of them changes the version, so the syntax index knows to read its files again.
//
//   pnpm nx run syntax:codegen

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { languages } from '../src/languages.ts';
import { taggedLanguages, tagQueries } from '../src/tagged.ts';

/** The code past the queries that decides what's read: the tags, the imports and the languages. */
export const readingCode = ['src/imports.ts', 'src/tagged.ts', 'src/tags.ts'];

interface Grammar {
  name: string;
  commit: string;
  /** The SHA-256 of its build, which its source, its patches and the toolchain decide. */
  sha256?: string;
}

/**
 * What the version is a hash of, from the package's files: each grammar the tagged languages
 * parse with, by name, commit and build, then each file of their queries and of `readingCode`,
 * by path, with its text.
 */
export function versionInputs(read: (file: string) => string): string[] {
  const list: { grammars: Grammar[] } = JSON.parse(read('grammars.json'));
  const used = new Set<string>(taggedLanguages.map((language) => languages[language].grammar));
  const inputs = list.grammars
    .filter(({ name }) => used.has(name))
    .map(({ name, commit, sha256 }) => `grammar ${name} ${commit} ${sha256 ?? ''}`)
    .toSorted();
  const queries = taggedLanguages.flatMap((language) =>
    tagQueries[language].map(([folder, kind]) => `queries/${folder}/${kind}.scm`),
  );
  for (const file of [...new Set([...queries, ...readingCode])].toSorted()) {
    // The text with Unix line breaks, as a checkout on any system would hash alike.
    const text = read(file).replaceAll('\r\n', '\n');
    inputs.push(`file ${file} ${text.length}\n${text}`);
  }
  return inputs;
}

/** The version of what the tagger reads: the first 16 hex digits of its inputs' SHA-256. */
export function versionOf(inputs: readonly string[]): string {
  const hash = createHash('sha256');
  for (const input of inputs) hash.update(`${input.length}\n${input}`);
  return hash.digest('hex').slice(0, 16);
}

/** `src/version.ts`, holding `version`. */
export function versionFile(version: string): string {
  return [
    "// Written by scripts/version.ts. Don't edit it: run `pnpm nx run syntax:codegen`.",
    '',
    '/**',
    ' * The version of what `Tagger` reads from a file: a hash of the grammars it parses with, the',
    ' * queries it reads them with and the code that puts their tags together. It changes whenever',
    ' * any of them does, so the syntax index can tell a reading made with another version, and',
    ' * read the file again.',
    ' */',
    `export const tagsVersion = '${version}';`,
    '',
  ].join('\n');
}

/** The package's folder. */
export const root = join(import.meta.dirname, '..');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = versionOf(versionInputs((file) => readFileSync(join(root, file), 'utf8')));
  writeFileSync(join(root, 'src', 'version.ts'), versionFile(version));
}
