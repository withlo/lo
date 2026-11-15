// Written by scripts/version.ts. Don't edit it: run `pnpm nx run syntax:codegen`.

/**
 * The version of what `Tagger` reads from a file: a hash of the grammars it parses with and
 * the tree-sitter that runs them, the queries it reads them with, and the code that guards,
 * parses and puts their tags together. It changes whenever any of them does, so the syntax
 * index can tell a reading made with another version, and read the file again.
 */
export const tagsVersion = 'd212f8e876299cc7';
