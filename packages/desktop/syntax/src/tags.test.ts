import { Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import type { Loader } from './highlight.ts';
import { languages } from './languages.ts';
import { taggedLanguageOfPath, taggedLanguages, tagQueries } from './tagged.ts';
import {
  definitionKinds,
  longestLine,
  maxTags,
  parentsOf,
  roleOf,
  Tagger,
  type Definition,
  type Symbols,
} from './tags.ts';

let tagger: Tagger;
beforeAll(async () => {
  tagger = await Tagger.create(diskLoader());
});

async function symbols(language: Parameters<Tagger['symbols']>[0], text: string): Promise<Symbols> {
  const result = await tagger.symbols(language, text);
  if (!('symbols' in result)) throw new Error(`Not read: ${result.skipped}`);
  return result.symbols;
}

/** Each definition as `kind name line:column`. */
function listed(definitions: readonly Definition[]): string[] {
  return definitions.map(({ kind, name, line, column }) => `${kind} ${name} ${line}:${column}`);
}

describe('the tag queries', () => {
  test.each(taggedLanguages)(
    'for %s compile, with only captures a tag can have',
    async (language) => {
      const loader = diskLoader();
      const parts = await Promise.all(
        tagQueries[language].map(([folder, kind]) => loader.query(folder, kind)),
      );
      expect(parts).not.toContain(undefined);
      const grammar = await Language.load(await loader.grammar(languages[language].grammar));
      const query = new Query(grammar, parts.join('\n'));
      try {
        const unknown = query.captureNames.filter(
          (name) =>
            roleOf(name).kind === 'unused' &&
            !name.startsWith('_') &&
            !['doc', 'module'].includes(name),
        );
        expect(unknown).toEqual([]);
      } finally {
        query.delete();
      }
    },
  );

  test('name only kinds the index knows', () => {
    expect(roleOf('definition.function')).toEqual({ kind: 'definition', of: 'function' });
    expect(roleOf('definition.gadget')).toEqual({ kind: 'unused' });
    expect(definitionKinds).toContain('constant');
  });
});

describe('a file', () => {
  test('is read by the language its path says, leaving lockfiles out', () => {
    expect(taggedLanguageOfPath('src/app.tsx')).toBe('tsx');
    expect(taggedLanguageOfPath('lib/queue.mjs')).toBe('javascript');
    expect(taggedLanguageOfPath('infra/main.tf')).toBe('terraform');
    expect(taggedLanguageOfPath('README.md')).toBeUndefined();
    expect(taggedLanguageOfPath('config.json')).toBeUndefined();
    expect(taggedLanguageOfPath('deps/mix.lock')).toBeUndefined();
    expect(taggedLanguageOfPath('Gemfile')).toBe('ruby');
  });
});

describe('Tagger.symbols', () => {
  test('counts columns in UTF-16 code units, and lines from 1', async () => {
    const { definitions } = await symbols(
      'typescript',
      "const face = '\u{1F600}'; export const AFTER = 1;\n\nfunction next() {}\n",
    );

    expect(listed(definitions)).toEqual([
      'constant face 1:6',
      'constant AFTER 1:32',
      'function next 3:9',
    ]);
  });

  test('gives each definition its last line, and the one it is inside', async () => {
    const { definitions } = await symbols(
      'python',
      'class Outer:\n    def method(self):\n        pass\n\n    class Inner:\n        x = 1\n',
    );

    expect(definitions).toEqual([
      { name: 'Outer', kind: 'class', line: 1, column: 6, lastLine: 6 },
      { name: 'method', kind: 'function', line: 2, column: 8, lastLine: 3, parent: 0 },
      { name: 'Inner', kind: 'class', line: 5, column: 10, lastLine: 6, parent: 0 },
      { name: 'x', kind: 'field', line: 6, column: 8, lastLine: 6, parent: 2 },
    ]);
  });

  test("keeps a name a definition where a pattern uses it, and the grammar's tag over Lo's", async () => {
    // Ruby's own query takes every constant as a use, and Lo's takes an assigned one as defined.
    const ruby = await symbols('ruby', 'LIMIT = 10\nputs LIMIT\n');
    // TypeScript's class names are type names, which Lo's query takes as uses.
    const typescript = await symbols('typescript', 'class Circle {}\nlet c: Circle;\n');
    // The JavaScript query takes a constant holding a function as a function, and Lo's as a constant.
    const functions = await symbols('typescript', 'const area = () => 1;\n');

    expect(listed(ruby.definitions)).toEqual(['constant LIMIT 1:0']);
    expect(ruby.references).toEqual(['LIMIT', 'puts']);
    expect(listed(typescript.definitions)).toEqual(['class Circle 1:6', 'variable c 2:4']);
    expect(typescript.references).toEqual(['Circle']);
    expect(listed(functions.definitions)).toEqual(['function area 1:6']);
  });

  test("keeps a definition over the grammar's @ignore of its name", async () => {
    // Elixir's own query ignores every module attribute, and Lo's defines those holding a value.
    const elixir = await symbols(
      'elixir',
      'defmodule Shapes do\n  @limit 10\n  def area, do: @limit\nend\n',
    );

    expect(listed(elixir.definitions)).toEqual([
      'module Shapes 1:10',
      'constant limit 2:3',
      'function area 3:6',
    ]);
    expect(elixir.references).toEqual(['limit']);
  });

  test('names each definition what its language calls it', async () => {
    const kotlin = await symbols(
      'kotlin',
      [
        'interface Shape {',
        '    fun area(): Double',
        '}',
        'fun interface Runner { fun run() }',
        'class Circle : Shape {',
        '    val radius = 1.0',
        '    var count = 0',
        '}',
        'val top = 1',
        'var mutable = 2',
        '',
      ].join('\n'),
    );
    const swift = await symbols(
      'swift',
      [
        'enum Kind {',
        '    case round',
        '    static let all = 1',
        '    var label: String { "x" }',
        '    func describe() {}',
        '}',
        '',
      ].join('\n'),
    );
    const rust = await symbols(
      'rust',
      [
        'mod inner {',
        '    fn helper() {}',
        '    impl S {',
        '        fn method(&self) {}',
        '    }',
        '}',
        'trait T {',
        '    fn provided() {}',
        '    fn required(&self);',
        '}',
        'extern "C" {',
        '    fn abs(x: i32) -> i32;',
        '}',
        '',
      ].join('\n'),
    );

    expect(listed(kotlin.definitions)).toEqual([
      'interface Shape 1:10',
      'function area 2:8',
      'interface Runner 4:14',
      'function run 4:27',
      'class Circle 5:6',
      'constant radius 6:8',
      'variable count 7:8',
      'constant top 9:4',
      'variable mutable 10:4',
    ]);
    expect(listed(swift.definitions)).toEqual([
      'class Kind 1:5',
      'constant round 2:9',
      'property all 3:15',
      'property label 4:8',
      'method describe 5:9',
    ]);
    expect(listed(rust.definitions)).toEqual([
      'module inner 1:4',
      'function helper 2:7',
      'method method 4:11',
      'interface T 7:6',
      'method provided 8:7',
      'method required 9:7',
      'function abs 12:7',
    ]);
  });

  test('lists each name referred to once, sorted', async () => {
    const { references } = await symbols(
      'go',
      'package a\n\nfunc f() { g(); g(); b.Z(); b.Z() }\n',
    );

    expect(references).toEqual(['Z', 'g']);
  });

  test("doesn't take a local variable for a property or constant", async () => {
    const kotlin = await symbols(
      'kotlin',
      'class A {\n    val kept = 1\n    fun f() {\n        val local = 2\n    }\n}\n',
    );
    const swift = await symbols(
      'swift',
      'struct A {\n    let kept = 1\n    func f() {\n        let local = 2\n    }\n}\n',
    );

    expect(listed(kotlin.definitions)).toEqual([
      'class A 1:6',
      'constant kept 2:8',
      'function f 3:8',
    ]);
    expect(listed(swift.definitions)).toEqual(['class A 1:7', 'property kept 2:8', 'method f 3:9']);
    // A Swift member's range is its own, so what's in it is inside it.
    expect(swift.definitions.map(({ lastLine }) => lastLine)).toEqual([6, 2, 5]);
  });

  test('reads a file longer than one step of the query once over', async () => {
    // With characters of two UTF-16 code units, and a name after them.
    const field = "  size = '\u{1F600}'; ";
    const block = `export class Box {\n${field}tag = 1;\n  open(): void {}\n}\n\nexport const LIMIT = 2;\n\n`;
    const blocks = 2000;

    const { definitions } = await symbols('typescript', block.repeat(blocks));

    expect(block.length * blocks).toBeGreaterThan(2 * 65_536);
    expect(definitions).toHaveLength(5 * blocks);
    for (let index = 0; index < blocks; index++) {
      const line = index * 7 + 1;
      expect(listed(definitions.slice(index * 5, index * 5 + 5))).toEqual([
        `class Box ${line}:13`,
        `field size ${line + 1}:2`,
        `field tag ${line + 1}:${field.length}`,
        `method open ${line + 2}:2`,
        `constant LIMIT ${line + 5}:13`,
      ]);
    }
  });

  test('reads a Rust path of any length, past the longest module an import may name', async () => {
    // A path's parts are nodes each inside the one before, here 20,000 deep, on lines of their own
    // and in no brackets, so the file passes every check before it's parsed.
    const text = `use ${'a::\n'.repeat(20_000)}b;\nfn after() {}\n`;

    expect(await tagger.symbols('rust', text, { timeout: 30_000 })).toEqual({
      symbols: {
        definitions: [
          { name: 'after', kind: 'function', line: 20_002, column: 3, lastLine: 20_002 },
        ],
        references: ['a', 'b'],
        imports: [],
      },
    });
    expect(tagger.usable).toBe(true);
    expect(listed((await symbols('rust', 'fn later() {}\n')).definitions)).toEqual([
      'function later 1:3',
    ]);
    // A module as long as an import's may be is kept.
    const longest = `${'a::'.repeat(85)}a`;
    expect(longest).toHaveLength(256);
    expect((await symbols('rust', `use ${longest}::B;\n`)).imports).toEqual([
      { line: 1, module: longest, names: [{ name: 'B' }] },
    ]);
    expect((await symbols('rust', `use ${longest}a::B;\n`)).imports).toEqual([]);
  });

  test.each([
    ['java', (parts: string) => `package ${parts.replaceAll('/', '.')};\n`],
    ['kotlin', (parts: string) => `package ${parts.replaceAll('/', '.')}\n`],
    ['php', (parts: string) => `<?php\nnamespace ${parts.replaceAll('/', '\\')};\n`],
  ] as const)(
    '%s: leaves out a package longer than the longest module an import may name',
    async (language, declaration) => {
      // 40,001 characters over lines, which none of the checks before parsing sees.
      const long = await symbols(language, declaration(`${'a/\n'.repeat(20_000)}b`));
      // 256 characters, as long as one may be.
      const longest = await symbols(language, declaration(`${'a/'.repeat(127)}bc`));

      expect(long.namespace).toBeUndefined();
      expect(longest.namespace).toHaveLength(256);
    },
  );

  test('reads what it can of a file with syntax errors', async () => {
    const { definitions } = await symbols(
      'python',
      'def good():\n    pass\n\ndef (broken:\n\nclass Fine:\n    pass\n',
    );

    expect(listed(definitions)).toEqual(
      expect.arrayContaining(['function good 1:4', 'class Fine 6:6']),
    );
  });
});

describe('Tagger.find', () => {
  test('finds where a file uses a name, but not where it defines it', async () => {
    const text = 'class Circle {}\nconst a = new Circle();\nconst b: Circle = a;\n// Circle\n';

    expect(await tagger.find('typescript', text, 'Circle')).toEqual({
      uses: [
        { line: 2, column: 14 },
        { line: 3, column: 9 },
      ],
    });
    expect(await tagger.find('typescript', text, 'Circl')).toEqual({ uses: [] });
  });
});

describe('a tagger whose grammars or queries fail to load', () => {
  test('stops, and leaves the thread to the others', async () => {
    const missing: Loader = {
      ...diskLoader(),
      grammar: () => Promise.reject(new Error('No such grammar.')),
    };
    const fresh = await Tagger.create(missing);

    expect(await fresh.symbols('go', 'package a\n')).toEqual({ skipped: 'failed' });
    expect(fresh.usable).toBe(false);
    expect(tagger.usable).toBe(true);
    expect(listed((await symbols('go', 'package a\n\nfunc f() {}\n')).definitions)).toEqual([
      'function f 3:5',
    ]);
  });
});

describe('a file the tagger skips', () => {
  test('is longer than a megabyte', async () => {
    const text = 'const a = 1;\n'.repeat(80_000);

    expect(text.length).toBeGreaterThan(1_000_000);
    expect(await tagger.symbols('typescript', text)).toEqual({ skipped: 'too-long' });
    expect(await tagger.symbols('typescript', 'const a = 1;\n', { maxLength: 5 })).toEqual({
      skipped: 'too-long',
    });
  });

  test('holds a NUL, as binary files do', async () => {
    expect(await tagger.symbols('python', 'x = 1\n\0\n')).toEqual({ skipped: 'binary' });
  });

  test('has a line longer than a minified file has', async () => {
    const line = `var a=${'1+'.repeat(longestLine / 2)}1;`;

    expect(await tagger.symbols('javascript', `${line}\n`)).toEqual({ skipped: 'minified' });
    expect(await tagger.find('javascript', line, 'a')).toEqual({ skipped: 'minified' });
  });

  test('nests deeper than a hundred levels', async () => {
    const text = `x = ${'['.repeat(150)}1${']'.repeat(150)}\n`;

    expect(await tagger.symbols('python', text)).toEqual({ skipped: 'too-deep' });
  });

  test('tags more names than a file of a megabyte should', async () => {
    // Nothing but names, each a constant's use.
    const text = 'A\n'.repeat(maxTags + 10);

    expect(await tagger.symbols('typescript', text, { timeout: 30_000 })).toEqual({
      skipped: 'too-many',
    });
  });

  test('runs past its deadline', async () => {
    const text = 'export function f() { return g(1, 2) + h(3); }\n'.repeat(20_000);

    expect(await tagger.symbols('typescript', text, { timeout: 1 })).toEqual({
      skipped: 'timed-out',
    });
    // The next file reads as usual.
    expect(listed((await symbols('typescript', 'function g() {}\n')).definitions)).toEqual([
      'function g 1:9',
    ]);
    expect(tagger.usable).toBe(true);
  });
});

describe('parentsOf', () => {
  test('gives no definition a parent with its own range', () => {
    // Go's `const a, b = 1, 2` defines both names with one node, inside a function.
    expect(
      parentsOf([
        { start: 0, end: 100 },
        { start: 10, end: 20 },
        { start: 10, end: 20 },
        { start: 15, end: 18 },
        { start: 30, end: 40 },
      ]),
    ).toEqual([undefined, 0, 0, 2, 0]);
  });
});
