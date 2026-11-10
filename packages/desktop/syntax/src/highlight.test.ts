import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Language, Parser } from 'web-tree-sitter';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { diskLoader, packageFolder } from './disk.ts';
import { Highlighter, nestingDepth, resolve } from './highlight.ts';
import { languageOfPath, type LanguageName } from './languages.ts';
import { tokenOf, tokens } from './tokens.ts';

let highlighter: Highlighter;
beforeAll(async () => {
  highlighter = await Highlighter.create(diskLoader());
});

/** Each highlighted stretch of `text` as `text:token`. */
function stretches(language: LanguageName, text: string): string[] {
  const result = highlighter.highlight(language, text);
  if (!('tokens' in result)) throw new Error(`Not highlighted: ${result.skipped}`);
  const out: string[] = [];
  for (let at = 0; at < result.tokens.length; at += 3) {
    const [from, to, token] = result.tokens.subarray(at, at + 3);
    out.push(`${text.slice(from, to)}:${tokens[token!]}`);
  }
  return out;
}

function capture(from: number, to: number, token: string, priority = 0) {
  return { from, to, token: tokenOf(token)!, priority };
}

function triples(result: Uint32Array): [number, number, string][] {
  return Array.from({ length: result.length / 3 }, (_, index) => [
    result[index * 3]!,
    result[index * 3 + 1]!,
    tokens[result[index * 3 + 2]!]!,
  ]);
}

describe('resolve', () => {
  test('lets the innermost capture win', () => {
    expect(triples(resolve([capture(0, 10, 'string'), capture(3, 5, 'string.escape')]))).toEqual([
      [0, 3, 'string'],
      [3, 5, 'string-escape'],
      [5, 10, 'string'],
    ]);
  });

  test('lets the later pattern win between equal ranges', () => {
    expect(triples(resolve([capture(0, 4, 'function', 7), capture(0, 4, 'variable', 2)]))).toEqual([
      [0, 4, 'function'],
    ]);
  });

  test('joins neighbors with the same token, and leaves gaps', () => {
    expect(
      triples(
        resolve([capture(0, 2, 'keyword'), capture(2, 4, 'keyword'), capture(6, 8, 'number')]),
      ),
    ).toEqual([
      [0, 4, 'keyword'],
      [6, 8, 'number'],
    ]);
  });
});

describe('Highlighter', () => {
  test('highlights TypeScript, counting in UTF-16 code units', () => {
    expect(stretches('typescript', "const face = '\u{1F600}'; // done\n")).toEqual([
      'const:keyword',
      'face:variable',
      '=:operator',
      "'\u{1F600}':string",
      ';:punctuation-delimiter',
      '// done:comment',
    ]);
  });

  test('highlights the code in a Markdown code block in its own language', () => {
    expect(stretches('markdown', '# Notes\n\n```go\nfunc main() {}\n```\n')).toEqual(
      expect.arrayContaining(['# Notes\n:title', 'func:keyword', 'main:function']),
    );
  });

  test('highlights Markdown’s inline text', () => {
    expect(stretches('markdown', 'Some *stress* and `code`.\n')).toEqual([
      '*stress*:emphasis',
      '`code`:text-literal',
    ]);
  });

  test.each([
    ['bash', 'echo "$HOME" # where\n', 'echo:function'],
    ['go', 'package main\n', 'package:keyword'],
    ['javascript', 'export const a = <b>{c}</b>;\n', 'export:keyword'],
    ['json', '{"a": true}\n', 'true:boolean'],
    ['jsonc', '{\n  // note\n  "a": 1\n}\n', '// note:comment'],
    ['tsx', 'const a = <Card title="x" />;\n', 'Card:tag'],
    ['yaml', 'name: ci\non: [push]\n', 'name:property'],
  ] as const)('highlights %s', (language, text, expected) => {
    expect(stretches(language, text)).toContain(expected);
  });

  test('skips text over its length limit', () => {
    expect(highlighter.highlight('typescript', 'const a = 1;\n', { maxLength: 4 })).toEqual({
      skipped: 'too-long',
    });
  });

  test('gives up on a parse that runs out of time', () => {
    const text = 'const value = [1, 2, 3].map((n) => n * 2);\n'.repeat(20_000);

    expect(highlighter.highlight('typescript', text, { timeout: -1 })).toEqual({
      skipped: 'timed-out',
    });
    // The parser recovers for the next file.
    expect(stretches('typescript', 'let a;\n')).toContain('let:keyword');
  });
});

/** YAML indented one space more on each of 260 lines: about 33 KB. */
const deepYaml = Array.from({ length: 260 }, (_, index) => `${' '.repeat(index)}k${index}:`).join(
  '\n',
);

describe('hostile files', () => {
  test('the patched YAML grammar parses past the scanner\u2019s saved state, then goes on', async () => {
    await Highlighter.create(diskLoader());
    const parser = new Parser();
    const wasm = readFileSync(join(packageFolder, 'dist', 'grammars', 'yaml.wasm'));
    parser.setLanguage(await Language.load(wasm));
    // Editing and parsing again saves and restores the scanner's state at every step.
    const tree = parser.parse(deepYaml)!;
    expect(parser.parse(`${deepYaml}\nend: 1\n`, tree)?.rootNode.type).toBe('stream');
    tree.delete();
    parser.delete();

    expect(stretches('yaml', 'name: ci\n')).toContain('name:property');
  });

  test.each([
    ['yaml', 'YAML indented 260 levels', deepYaml],
    ['markdown', 'a Markdown code block of that YAML', `\`\`\`yaml\n${deepYaml}\n\`\`\`\n`],
    ['yaml', 'a megabyte of nested flow collections', '[{'.repeat(500_000)],
    ['markdown', 'a megabyte of nested quotes', `${'>'.repeat(200)} x\n`.repeat(5000)],
    ['json', 'brackets nested past the limit', `${'['.repeat(150)}${']'.repeat(150)}`],
  ] as const)('skips %s: %s', (language, _, text) => {
    const started = performance.now();

    expect(highlighter.highlight(language, text)).toEqual({ skipped: 'too-deep' });
    expect(performance.now() - started).toBeLessThan(100);
  });

  test('leave the memory where it was, and a normal file highlights after them', () => {
    const before = highlighter.memory;
    for (const [language, text] of [
      ['yaml', deepYaml],
      ['markdown', `${'>'.repeat(200)} x\n`.repeat(5000)],
      ['yaml', '[{'.repeat(500_000)],
    ] as const) {
      highlighter.highlight(language, text);
    }

    expect(highlighter.memory).toBe(before);
    expect(highlighter.usable).toBe(true);
    expect(stretches('typescript', 'let a;\n')).toContain('let:keyword');
  });

  test('a failure in WebAssembly stops the highlighter for good', async () => {
    const fresh = await Highlighter.create(diskLoader());
    const parse = vi.spyOn(Parser.prototype, 'parse').mockImplementationOnce(() => {
      throw new Error('memory access out of bounds');
    });
    try {
      expect(fresh.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
      expect(fresh.usable).toBe(false);
      expect(fresh.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
    } finally {
      parse.mockRestore();
    }
  });
});

describe('nestingDepth', () => {
  test('counts brackets, and with the shape, quotes and indentation', () => {
    expect(nestingDepth('f([{a}])', { quotes: false, indents: false })).toBe(3);
    expect(nestingDepth('> > > deep\n', { quotes: true, indents: false })).toBe(3);
    expect(nestingDepth('a:\n      b: 1\n', { quotes: false, indents: true })).toBe(3);
    expect(nestingDepth('a:\n      b: 1\n', { quotes: false, indents: false })).toBe(0);
  });
});

describe('languageOfPath', () => {
  test.each([
    ['src/main.go', 'go'],
    ['src/checker.ts', 'typescript'],
    ['src/types.d.mts', 'typescript'],
    ['src/App.tsx', 'tsx'],
    ['scripts/build.mjs', 'javascript'],
    ['eslint.config.cjs', 'javascript'],
    ['tsconfig.json', 'json'],
    ['.vscode/settings.jsonc', 'jsonc'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['docs/README.MD', 'markdown'],
    ['scripts/setup.sh', 'bash'],
  ])('reads %s as %s', (path, language) => {
    expect(languageOfPath(path)).toBe(language);
  });

  test.each(['Makefile', 'api/types.proto', '.bashrc', 'Dockerfile'])(
    'reads %s as no language yet',
    (path) => {
      expect(languageOfPath(path)).toBeUndefined();
    },
  );
});
