// The syntax index's jobs: each file's definitions, the names it refers to and its imports, and
// where files use a name, read with `@lo/syntax`'s tags under its limits. Pure work on the bytes
// main sends: nothing here reads a file of the repository or the network, and nothing runs the
// repository's code.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  diskLoader,
  type Loader,
  Tagger,
  type TaggedLanguage,
  taggedLanguages,
  tagsVersion,
} from '@lo/syntax';

import { defineRunner } from '../../../background/runners.ts';
import { contract, type FileJob, type Tagged, type Uses } from '../jobs.ts';

/**
 * Where the grammars and queries are: beside the built process, which carries them, or in the
 * syntax package itself when the code runs from source, as in tests.
 */
function syntaxLoader(): Loader {
  const bundled = join(import.meta.dirname, 'syntax');
  return existsSync(join(bundled, 'queries')) ? diskLoader(bundled) : diskLoader();
}

/** The language a job names, if the index reads it. */
function taggedLanguage(name: string): TaggedLanguage | undefined {
  return taggedLanguages.find((language) => language === name);
}

/** UTF-8 as the diff reads it, so places line up with what the window shows. */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Reads each of `files` with one tagger, which loads each grammar the first time a file needs it.
 * Once the tagger can't go on, as when a file used up its memory, the rest are left for another
 * job, in a worker of its own.
 */
async function each<T>(
  files: readonly FileJob[],
  read: (tagger: Tagger, language: TaggedLanguage, text: string) => Promise<T>,
): Promise<(T | { skipped: 'language' } | null)[]> {
  const tagger = await Tagger.create(syntaxLoader());
  const results: (T | { skipped: 'language' } | null)[] = [];
  for (const [index, file] of files.entries()) {
    if (index > 0 && !tagger.usable) {
      results.push(null);
      continue;
    }
    const language = taggedLanguage(file.language);
    if (language === undefined) {
      results.push({ skipped: 'language' });
      continue;
    }
    results.push(await read(tagger, language, decoder.decode(file.bytes)));
  }
  return results;
}

export default defineRunner(contract, {
  symbols: {
    async run({ files }) {
      // What a reading's stamped with: a new grammar or query makes another.
      const version = tagsVersion;
      if (files.length === 0) return { version, files: [] };
      const read: Tagged[] = await each(files, (tagger, language, text) =>
        tagger.symbols(language, text),
      );
      return { version, files: read };
    },
    // A batch of files, each read within the syntax package's two seconds.
    limits: { deadline: 60_000 },
  },
  find: {
    async run({ name, files }) {
      const found: Uses[] = await each(files, (tagger, language, text) =>
        tagger.find(language, text, name),
      );
      return found;
    },
    limits: { deadline: 60_000 },
  },
});
