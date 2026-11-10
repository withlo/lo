// Loading the grammars and queries from this package's folder, where Node can read them: in tests,
// and wherever the package runs unbundled.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Loader } from './highlight.ts';

/** The package's folder, holding `queries/` and the built `dist/grammars/`. */
export const packageFolder = join(import.meta.dirname, '..');

/** A loader that reads the grammars and queries from `folder`. */
export function diskLoader(folder = packageFolder): Loader {
  return {
    grammar: async (name) => readFile(join(folder, 'dist', 'grammars', `${name}.wasm`)),
    query: async (language, kind) => {
      try {
        return await readFile(join(folder, 'queries', language, `${kind}.scm`), 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
  };
}
