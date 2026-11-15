// The languages the syntax index reads, and the queries it reads each with.

import type { QueryKind } from './highlight.ts';
import { languageOfPath, type LanguageName } from './languages.ts';

/**
 * The queries each language with tags is read with, in order: its grammar's own tags first, then
 * Lo's additions for what they leave out, then the patterns that find its imports. JavaScript is
 * parsed with the TSX grammar, as it's highlighted, and TypeScript's grammars build on
 * JavaScript's, so they take JavaScript's tags too.
 */
export const tagQueries = {
  csharp: [
    ['csharp', 'tags'],
    ['csharp', 'lo-tags'],
  ],
  elixir: [
    ['elixir', 'tags'],
    ['elixir', 'lo-tags'],
  ],
  go: [
    ['go', 'tags'],
    ['go', 'lo-tags'],
    ['go', 'imports'],
  ],
  java: [
    ['java', 'tags'],
    ['java', 'lo-tags'],
    ['java', 'imports'],
  ],
  javascript: [
    ['javascript', 'tags'],
    ['typescript', 'lo-tags'],
    ['typescript', 'imports'],
  ],
  kotlin: [
    ['kotlin', 'tags'],
    ['kotlin', 'lo-tags'],
    ['kotlin', 'imports'],
  ],
  php: [
    ['php', 'tags'],
    ['php', 'lo-tags'],
    ['php', 'imports'],
  ],
  python: [
    ['python', 'tags'],
    ['python', 'lo-tags'],
    ['python', 'imports'],
  ],
  ruby: [
    ['ruby', 'tags'],
    ['ruby', 'lo-tags'],
  ],
  rust: [
    ['rust', 'tags'],
    ['rust', 'lo-tags'],
    ['rust', 'imports'],
  ],
  swift: [
    ['swift', 'tags'],
    ['swift', 'lo-tags'],
  ],
  // HCL's grammar has no tags of its own, so Terraform's are all Lo's.
  terraform: [['terraform', 'lo-tags']],
  tsx: [
    ['typescript', 'tags'],
    ['javascript', 'tags'],
    ['typescript', 'lo-tags'],
    ['typescript', 'imports'],
  ],
  typescript: [
    ['typescript', 'tags'],
    ['javascript', 'tags'],
    ['typescript', 'lo-tags'],
    ['typescript', 'imports'],
  ],
} as const satisfies Partial<Record<LanguageName, readonly (readonly [LanguageName, QueryKind])[]>>;

/** A language the syntax index reads: one with tags. */
export type TaggedLanguage = keyof typeof tagQueries;

export const taggedLanguages: readonly TaggedLanguage[] = Object.keys(tagQueries).filter(
  (name): name is TaggedLanguage => name in tagQueries,
);

/** Whether the syntax index reads `language`. */
export function isTagged(language: LanguageName): language is TaggedLanguage {
  return language in tagQueries;
}

/**
 * Files no one writes, whose names would choose a language with tags: package managers' lockfiles.
 * The index leaves them out.
 */
export const lockfiles: ReadonlySet<string> = new Set([
  'Cargo.lock',
  'Gemfile.lock',
  'Package.resolved',
  'Pipfile.lock',
  'bun.lock',
  'composer.lock',
  'flake.lock',
  'go.sum',
  'mix.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'poetry.lock',
  'uv.lock',
  'yarn.lock',
]);

/** The language the syntax index reads a file as, by its path, if it reads it at all. */
export function taggedLanguageOfPath(path: string): TaggedLanguage | undefined {
  if (lockfiles.has(path.slice(path.lastIndexOf('/') + 1))) return undefined;
  const language = languageOfPath(path);
  return language && isTagged(language) ? language : undefined;
}
