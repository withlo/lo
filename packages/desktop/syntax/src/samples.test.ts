// Each language's sample in `test/tags/<language>/`, read by the tagger, against what it should find
// there, in `tags.txt` beside it:
//
// - the definitions, each under the one it's inside, as `kind name line:column`, from 1 and from 0,
//   with `-last` for the last line of a definition over several;
// - the names the file refers to;
// - the imports, as `line module: names`, `*` for a module brought in whole;
// - and the package or namespace the file says it's in, if it says.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

import { diskLoader, packageFolder } from './disk.ts';
import { taggedLanguages } from './tagged.ts';
import { Tagger, type Symbols } from './tags.ts';

const samples = join(packageFolder, 'test', 'tags');

/** Each sample, as `[language, file]`. */
const files = readdirSync(samples).map((folder) => {
  const language = taggedLanguages.find((name) => name === folder);
  const [file, ...others] = readdirSync(join(samples, folder)).filter(
    (name) => name !== 'tags.txt',
  );
  if (!language) throw new Error(`${folder} isn't a language with tags.`);
  if (!file || others.length > 0) throw new Error(`${folder} needs one sample.`);
  return [language, file] as const;
});

/** `words` joined with spaces, in lines no longer than `width` after `indent`. */
function wrap(words: readonly string[], indent: string, width = 100): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line !== '' && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(indent + line);
  return lines;
}

/** What the tagger read, as `tags.txt` writes it. */
function render({ definitions, references, imports, namespace }: Symbols): string {
  const out = ['definitions'];
  const depths: number[] = [];
  for (const [index, definition] of definitions.entries()) {
    const depth = definition.parent === undefined ? 0 : depths[definition.parent]! + 1;
    depths[index] = depth;
    const { kind, name, line, column, lastLine } = definition;
    const last = lastLine === line ? '' : `-${lastLine}`;
    out.push(`${'  '.repeat(depth + 1)}${kind} ${name} ${line}:${column}${last}`);
  }
  out.push('references', ...wrap(references, '  '));
  out.push('imports');
  for (const { line, module, names } of imports) {
    const brought =
      names === 'all'
        ? '*'
        : names.map(({ name, as }) => (as === undefined ? name : `${name} as ${as}`)).join(', ');
    out.push(`  ${line} ${module === '' ? '(global)' : module}: ${brought}`.trimEnd());
  }
  if (namespace !== undefined) out.push(`namespace ${namespace}`);
  return `${out.join('\n')}\n`;
}

let tagger: Tagger;
beforeAll(async () => {
  tagger = await Tagger.create(diskLoader());
});

describe('the samples', () => {
  test('cover every language with tags', () => {
    expect(files.map(([language]) => language).toSorted()).toEqual([...taggedLanguages].toSorted());
  });

  test.each(files)('%s reads as tags.txt says', async (language, file) => {
    const text = readFileSync(join(samples, language, file), 'utf8');

    const result = await tagger.symbols(language, text);

    if (!('symbols' in result)) throw new Error(`Not read: ${result.skipped}`);
    await expect(render(result.symbols)).toMatchFileSnapshot(join(samples, language, 'tags.txt'));
  });
});
