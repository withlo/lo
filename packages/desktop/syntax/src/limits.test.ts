// Files built to run long or grow memory, each at the limits. They can leave the WebAssembly
// memory too large or broken to use again, which is why they run in their own file, and so in
// their own process.

import { describe, expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import { Highlighter, memoryCeiling } from './highlight.ts';
import type { LanguageName } from './languages.ts';

const timeout = 500;
/** What a step of parsing or querying can take past the deadline. */
const margin = 400;

const nest = (depth: number): string => `${'['.repeat(depth)}1${']'.repeat(depth)}`;
const near = (text: string): string =>
  text.repeat(Math.ceil(2_900_000 / text.length)).slice(0, 2_900_000);

describe('a highlighter at its limits', () => {
  test.each([
    ['typescript', 'TypeScript nested 50 deep', near(`f(${nest(48)});\n`)],
    ['json', 'JSON nested 50 deep', `[${near(`${nest(48)},`)}1]`],
    ['markdown', 'Markdown quoted 50 deep', near(`${'>'.repeat(50)} text\n`)],
    ['yaml', 'YAML flow nested 50 deep', near(`- ${'[{'.repeat(24)}a: 1${'}]'.repeat(24)}\n`)],
  ] as const)('stops in time on %s: %s', async (language: LanguageName, _, text) => {
    const highlighter = await Highlighter.create(diskLoader());
    const started = performance.now();

    const result = highlighter.highlight(language, text, { timeout });

    expect(performance.now() - started).toBeLessThan(timeout + margin);
    expect(result).toEqual(expect.anything());
    // Past the ceiling, the highlighter asks to be replaced.
    expect(highlighter.usable || highlighter.memory > memoryCeiling || 'skipped' in result).toBe(
      true,
    );
    expect(highlighter.memory > memoryCeiling && highlighter.usable).toBe(false);
  });
});
