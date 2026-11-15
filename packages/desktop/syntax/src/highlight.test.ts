import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Language, Parser } from 'web-tree-sitter';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { diskLoader, packageFolder } from './disk.ts';
import { Highlighter, nestingDepth, resolve, type Loader } from './highlight.ts';
import { languageOfPath, type LanguageName } from './languages.ts';
import { tokenOf, tokens } from './tokens.ts';

let highlighter: Highlighter;
beforeAll(async () => {
  highlighter = await Highlighter.create(diskLoader());
});

/** Each highlighted stretch of `text` as `text:token`. */
async function stretches(language: LanguageName, text: string): Promise<string[]> {
  const result = await highlighter.highlight(language, text);
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
  test('highlights TypeScript, counting in UTF-16 code units', async () => {
    expect(await stretches('typescript', "const face = '\u{1F600}'; // done\n")).toEqual([
      'const:keyword',
      'face:variable',
      '=:operator',
      "'\u{1F600}':string",
      ';:punctuation-delimiter',
      '// done:comment',
    ]);
  });

  test('highlights the code in a Markdown code block in its own language', async () => {
    expect(await stretches('markdown', '# Notes\n\n```go\nfunc main() {}\n```\n')).toEqual(
      expect.arrayContaining(['# Notes\n:title', 'func:keyword', 'main:function']),
    );
  });

  test('highlights Markdown’s inline text', async () => {
    expect(await stretches('markdown', 'Some *stress* and `code`.\n')).toEqual([
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
  ] as const)('highlights %s', async (language, text, expected) => {
    expect(await stretches(language, text)).toContain(expected);
  });

  test.each([
    [
      'csharp',
      'class Cart { int Total(int n) => n * 2; } // sum\n',
      ['class:keyword', 'Cart:type', '{:punctuation-bracket', 'int:type-builtin', 'Total:function'],
      [
        '(:punctuation-bracket',
        'int:type-builtin',
        'n:variable-parameter',
        '):punctuation-bracket',
      ],
      ['=>:operator', 'n:variable', '*:operator', '2:number', ';:punctuation-delimiter'],
      ['}:punctuation-bracket', '// sum:comment'],
    ],
    [
      'css',
      '.cart > a:hover { color: #fff; } /* links */\n',
      [
        '.:punctuation-delimiter',
        'cart:selector',
        '>:operator',
        'a:tag',
        '::punctuation-delimiter',
      ],
      ['hover:selector-pseudo', '{:punctuation-bracket', 'color:property'],
      ['::punctuation-delimiter', '#fff:string-special', ';:punctuation-delimiter'],
      ['}:punctuation-bracket', '/* links */:comment'],
    ],
    [
      'elixir',
      'def total(n), do: n * 2 # sum\n',
      [
        'def:keyword',
        'total:function',
        '(:punctuation-bracket',
        'n:variable',
        '):punctuation-bracket',
      ],
      [',:punctuation-delimiter', 'do: :string-special-symbol', 'n:variable', '*:operator'],
      ['2:number', '# sum:comment'],
    ],
    [
      'hcl',
      'job "web" {\n  count = 2 # two\n}\n',
      ['job:keyword', '"web":string', '{:punctuation-bracket', 'count:variable', '=:punctuation'],
      ['2:number', '# two:comment', '}:punctuation-bracket'],
    ],
    [
      'html',
      '<a href="/cart">Cart</a> <!-- link -->\n',
      ['<:punctuation-bracket', 'a:tag', 'href:attribute', '=:punctuation-delimiter'],
      ['"/cart":string', '>:punctuation-bracket', '</:punctuation-bracket', 'a:tag'],
      ['>:punctuation-bracket', '<!-- link -->:comment'],
    ],
    [
      'java',
      'class Cart { int total(int n) { return n * 2; } } // sum\n',
      ['class:keyword', 'Cart:type', '{:punctuation-bracket', 'int:type', 'total:function'],
      ['(:punctuation-bracket', 'int:type', 'n:variable', '):punctuation-bracket'],
      ['{:punctuation-bracket', 'return:keyword', 'n:variable', '*:operator', '2:number'],
      [
        ';:punctuation-delimiter',
        '}:punctuation-bracket',
        '}:punctuation-bracket',
        '// sum:comment',
      ],
    ],
    [
      'kotlin',
      'fun total(n: Int): Double = n * 2.5 // sum\n',
      ['fun:keyword', 'total:function', '(:punctuation-bracket', 'n:variable-parameter'],
      ['::punctuation-delimiter', 'Int:type-builtin', '):punctuation-bracket'],
      ['::punctuation-delimiter', 'Double:type-builtin', '=:operator', 'n:variable', '*:operator'],
      ['2.5:number', '// sum:comment'],
    ],
    [
      'php',
      '<?php function total($n) { return $n * 2; } // sum\n',
      ['<?php:tag', 'function:keyword', 'total:function', '(:punctuation-bracket', '$:operator'],
      ['n:variable', '):punctuation-bracket', '{:punctuation-bracket', 'return:keyword'],
      ['$:operator', 'n:variable', '*:operator', '2:number', '}:punctuation-bracket'],
      ['// sum:comment'],
    ],
    [
      'python',
      'def total(n: int) -> int:\n    return n * 2  # sum\n',
      ['def:keyword', 'total:function', '(:punctuation-bracket', 'n:variable-parameter'],
      ['::punctuation-delimiter', 'int:type-builtin', '):punctuation-bracket', '->:operator'],
      ['int:type-builtin', '::punctuation-delimiter', 'return:keyword', 'n:variable'],
      ['*:operator', '2:number', '# sum:comment'],
    ],
    [
      'ruby',
      'def total(n)\n  n * 2 # sum\nend\n',
      ['def:keyword', 'total:function-method', '(:punctuation-bracket', 'n:variable-parameter'],
      ['):punctuation-bracket', 'n:variable', '*:operator', '2:number', '# sum:comment'],
      ['end:keyword'],
    ],
    [
      'rust',
      "fn total<'a>(n: &'a u32) -> u32 { n * 2 } // sum\n",
      ['fn:keyword', 'total:function', '<:operator', "'a:label", '>:operator'],
      ['(:punctuation-bracket', 'n:variable-parameter', '::operator', '&:operator', "'a:label"],
      ['u32:type-builtin', '):punctuation-bracket', '->:operator', 'u32:type-builtin'],
      ['{:punctuation-bracket', 'n:variable', '*:operator', '2:number', '}:punctuation-bracket'],
      ['// sum:comment'],
    ],
    [
      'swift',
      'func total(n: Int) -> Int { return n * 2 } // sum\n',
      ['func:keyword', 'total:function-method', '(:punctuation-bracket', 'n:variable-parameter'],
      ['::punctuation-delimiter', 'Int:type', '):punctuation-bracket', '->:operator', 'Int:type'],
      ['{:punctuation-bracket', 'return:keyword', '*:operator', '2:number'],
      ['}:punctuation-bracket', '// sum:comment'],
    ],
    [
      'terraform',
      'variable "region" {\n  default = "eu-west-1" # Ireland\n}\n',
      ['variable:keyword', '"region":string', '{:punctuation-bracket', 'default:variable'],
      ['=:punctuation', '"eu-west-1":string', '# Ireland:comment', '}:punctuation-bracket'],
    ],
    [
      'toml',
      '[package]\nname = "lo" # app\n',
      ['[:punctuation-bracket', 'package:property', ']:punctuation-bracket', 'name:property'],
      ['=:operator', '"lo":string', '# app:comment'],
    ],
  ] as const)('highlights a sample of %s', async (language, text, ...expected) => {
    expect(await stretches(language, text)).toEqual(expected.flat());
  });

  test.each([
    [
      'html',
      'its style and script elements',
      '<style>a { color: red; }</style><script>let a = 1;</script>\n',
      ['color:property', 'red:constant-builtin', 'let:keyword', '1:number'],
    ],
    ['php', 'the HTML around its code', '<p><?php echo 1; ?></p>\n', ['p:tag', 'echo:keyword']],
    [
      'ruby',
      'a heredoc in the language it names',
      'code = <<~RUBY\n  puts 1\nRUBY\n',
      ['puts:function-method', '1:number'],
    ],
    [
      'elixir',
      'its documentation as Markdown',
      '@doc "Adds *two*."\n',
      ['@doc:comment-doc', '*two*:emphasis'],
    ],
    ['markdown', 'a code block named by an alias', '```rs\nfn f() {}\n```\n', ['fn:keyword']],
  ] as const)('highlights what %s holds: %s', async (language, _, text, expected) => {
    expect(await stretches(language, text)).toEqual(expect.arrayContaining([...expected]));
  });

  test('highlights what a pattern captures in only some of its alternatives', async () => {
    expect(await stretches('rust', '#[derive(Debug)]\nstruct A;\n')).toContain('derive:attribute');
    expect(await stretches('elixir', '&Mod._unused/1\n')).toContain('_unused:comment');
  });

  test('skips text over its length limit', async () => {
    expect(await highlighter.highlight('typescript', 'const a = 1;\n', { maxLength: 4 })).toEqual({
      skipped: 'too-long',
    });
  });

  test('gives up on a parse that runs out of time', async () => {
    const text = 'const value = [1, 2, 3].map((n) => n * 2);\n'.repeat(20_000);

    expect(await highlighter.highlight('typescript', text, { timeout: -1 })).toEqual({
      skipped: 'timed-out',
    });
    // The parser recovers for the next file.
    expect(await stretches('typescript', 'let a;\n')).toContain('let:keyword');
  });
});

/** A loader from this package's folder that records each grammar it's asked for. */
function recording(): { loader: Loader; loaded: string[] } {
  const disk = diskLoader();
  const loaded: string[] = [];
  const loader: Loader = {
    grammar: (name) => {
      loaded.push(name);
      return disk.grammar(name);
    },
    query: (language, kind) => disk.query(language, kind),
  };
  return { loaded, loader };
}

describe('loading grammars', () => {
  test('loads none until a text needs one, then each a text needs, once', async () => {
    const { loader, loaded } = recording();
    const fresh = await Highlighter.create(loader);
    expect(loaded).toEqual([]);

    await fresh.highlight('python', 'x = 1\n');
    await fresh.highlight('python', 'y = 2\n');
    expect(loaded).toEqual(['python']);

    // JavaScript and TSX share a grammar.
    await fresh.highlight('javascript', 'let a;\n');
    await fresh.highlight('tsx', 'let a;\n');
    expect(loaded).toEqual(['python', 'tsx']);
  });

  test('loads the grammars of the languages a text injects', async () => {
    const { loader, loaded } = recording();
    const fresh = await Highlighter.create(loader);

    await fresh.highlight('markdown', '# Notes\n\n```rust\nfn f() {}\n```\n');
    expect(loaded.toSorted()).toEqual(['markdown', 'markdown_inline', 'rust']);
  });

  test('leaves the time a grammar takes to load out of the text’s', async () => {
    // A minute passes while the grammar loads, and no time otherwise.
    let clock = 0;
    const disk = diskLoader();
    const slow: Loader = {
      grammar: (name) => {
        clock += 60_000;
        return disk.grammar(name);
      },
      query: (language, kind) => disk.query(language, kind),
    };
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      const fresh = await Highlighter.create(slow);

      expect(await fresh.highlight('toml', 'a = 1\n')).toEqual({ tokens: expect.any(Uint32Array) });
    } finally {
      now.mockRestore();
    }
  });

  test('stops the highlighter for good when a grammar doesn’t load', async () => {
    const missing: Loader = {
      ...diskLoader(),
      grammar: () => Promise.reject(new Error('No such grammar.')),
    };
    const fresh = await Highlighter.create(missing);

    expect(await fresh.highlight('toml', 'a = 1\n')).toEqual({ skipped: 'failed' });
    expect(fresh.usable).toBe(false);
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

    expect(await stretches('yaml', 'name: ci\n')).toContain('name:property');
  });

  test('the patched Python grammar parses indentation past the scanner’s saved state, then goes on', async () => {
    // 600 levels of indentation, with a string open at the deepest, take more than the 1,024
    // bytes tree-sitter saves a scanner's state in.
    const levels = Array.from({ length: 600 }, (_, index) => `${' '.repeat(index)}if a:`);
    const text = `${levels.join('\n')}\n${' '.repeat(600)}f"{a}"\n`;

    expect(await highlighter.highlight('python', text)).toEqual({
      tokens: expect.any(Uint32Array),
    });
    expect(highlighter.usable).toBe(true);
    expect(await stretches('python', 'x = 1\n')).toContain('x:variable');
  });

  test.each([
    ['yaml', 'YAML indented 260 levels', deepYaml],
    ['markdown', 'a Markdown code block of that YAML', `\`\`\`yaml\n${deepYaml}\n\`\`\`\n`],
    ['yaml', 'a megabyte of nested flow collections', '[{'.repeat(500_000)],
    ['markdown', 'a megabyte of nested quotes', `${'>'.repeat(200)} x\n`.repeat(5000)],
    ['json', 'brackets nested past the limit', `${'['.repeat(150)}${']'.repeat(150)}`],
  ] as const)('skips %s: %s', async (language, _, text) => {
    const started = performance.now();

    expect(await highlighter.highlight(language, text)).toEqual({ skipped: 'too-deep' });
    expect(performance.now() - started).toBeLessThan(100);
  });

  test('leave the memory where it was, and a normal file highlights after them', async () => {
    const before = highlighter.memory;
    for (const [language, text] of [
      ['yaml', deepYaml],
      ['markdown', `${'>'.repeat(200)} x\n`.repeat(5000)],
      ['yaml', '[{'.repeat(500_000)],
    ] as const) {
      await highlighter.highlight(language, text);
    }

    expect(highlighter.memory).toBe(before);
    expect(highlighter.usable).toBe(true);
    expect(await stretches('typescript', 'let a;\n')).toContain('let:keyword');
  });

  test('parses no more injections once out of time', async () => {
    const parse = vi.spyOn(Parser.prototype, 'parse');
    // The time runs out as the first code block's parse starts.
    const clock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => (parse.mock.calls.length >= 2 ? 1e9 : 0));
    try {
      const text = '```go\nx := 1\n```\n\n'.repeat(50);

      expect(await highlighter.highlight('markdown', text)).toEqual({ skipped: 'timed-out' });
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      parse.mockRestore();
      clock.mockRestore();
    }
  });

  test('a failure in WebAssembly stops the highlighter for good', async () => {
    const fresh = await Highlighter.create(diskLoader());
    const parse = vi.spyOn(Parser.prototype, 'parse').mockImplementationOnce(() => {
      throw new Error('memory access out of bounds');
    });
    try {
      expect(await fresh.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
      expect(fresh.usable).toBe(false);
      expect(await fresh.highlight('typescript', 'let a;\n')).toEqual({ skipped: 'failed' });
    } finally {
      parse.mockRestore();
    }
  });
});

describe('nestingDepth', () => {
  test('counts brackets, and where the language nests them, quotes and indentation', () => {
    expect(nestingDepth('f([{a}])', 'typescript')).toBe(3);
    expect(nestingDepth('> > > deep\n', 'markdown')).toBe(3);
    expect(nestingDepth('a:\n      b: 1\n', 'yaml')).toBe(3);
    expect(nestingDepth('a:\n      b: 1\n', 'json')).toBe(0);
  });

  test.each([
    [
      'typescript',
      'strings, templates and comments',
      'f(\'(((\', "[[[", `{{{${a}`); // (((\n/* [[[ */ g()',
    ],
    ['typescript', 'a regular expression', 'const open = /[([{]+/g;\nreturn /\\(/.test(s)'],
    ['tsx', 'a regular expression after a JSX element', '<a>{b}</a>;\nx = /[(]/'],
    ['go', 'a raw string ending in a backslash', 'x := `\\`; f(y)'],
    ['bash', 'a comment, but not `$#`', 'echo $# ${#a} # (((\n'],
    ['yaml', 'a comment, and quoted strings', 'a: "(((" # [[[\nb: \'{{{\' [c]\n'],
    ['json', 'strings', '{"a": "[[[[", "b": "\\"(("}'],
    ['python', 'a docstring over lines', 'def f():\n    """(((\n    [[[ """\n    g()'],
    ['kotlin', 'a character and a raw string', 'val a = \'(\'\nval b = """\n[[[\n"""\nf()'],
    [
      'rust',
      'lifetimes, and a string over lines',
      'fn f<\'a>(x: &\'a str) {}\nlet s = "(((\n[[[";',
    ],
    ['terraform', 'both kinds of comment', 'a = 1 # (((\nb = 2 // [[[\nc = f()'],
  ] as const)('skips the brackets in %s: %s', (language, _, text) => {
    expect(nestingDepth(text, language)).toBe(1);
  });

  test('counts the brackets around a division', () => {
    expect(nestingDepth('a / (b / (c))', 'typescript')).toBe(2);
  });

  test('counts the brackets after a URL in CSS, where `//` starts no comment', () => {
    expect(nestingDepth('a { b: url(http://x.test/a.png); }\n'.repeat(3), 'css')).toBe(2);
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
    ['src/Program.cs', 'csharp'],
    ['web/styles.css', 'css'],
    ['lib/cart.ex', 'elixir'],
    ['mix.lock', 'elixir'],
    ['packer/image.pkr.hcl', 'hcl'],
    ['public/index.html', 'html'],
    ['src/main/java/Cart.java', 'java'],
    ['app/Cart.kt', 'kotlin'],
    ['build.gradle.kts', 'kotlin'],
    ['public/index.php', 'php'],
    ['setup.py', 'python'],
    ['stubs/cart.pyi', 'python'],
    ['app/models/cart.rb', 'ruby'],
    ['Gemfile', 'ruby'],
    ['ios/Podfile', 'ruby'],
    ['src/lib.rs', 'rust'],
    ['Sources/Cart.swift', 'swift'],
    ['infra/main.tf', 'terraform'],
    ['infra/prod.tfvars', 'terraform'],
    ['pyproject.toml', 'toml'],
    ['Cargo.lock', 'toml'],
  ])('reads %s as %s', (path, language) => {
    expect(languageOfPath(path)).toBe(language);
  });

  test.each(['Makefile', 'api/types.proto', '.bashrc', 'Dockerfile', 'Gemfile.lock', 'gemfile'])(
    'reads %s as no language yet',
    (path) => {
      expect(languageOfPath(path)).toBeUndefined();
    },
  );
});
