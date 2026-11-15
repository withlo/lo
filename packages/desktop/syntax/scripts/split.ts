// Splits the lexer functions in a grammar's generated parser.c into parts, each its own function.
//
// tree-sitter generates a grammar's lexer as one function with a case for each lexer state, which
// for some grammars is hundreds of kilobytes of WebAssembly. V8 compiles a function that runs often
// a second time, with its optimizing compiler, whose memory grows with the function's size and
// isn't all given back. Compiling Swift's lexer, 300 KB, took a worker thread under Electron 385 MB
// at its peak and left it 98 MB bigger, and left one under Node 24 2.7 GB bigger. In parts of at
// most 500 lines, no part takes more than about 13 MB to compile, and the lexer runs as fast.
//
// Each part takes the cases for a run of states, and runs a state as the generated code would,
// but returns what to do next to the lexer function, which keeps the generated loop: it reads the
// next character, finds the part for the state, and calls it through a table. binaryen inlines a
// function called from one place, so a direct call would put the parts back together.

/** What a part tells the lexer to do once it has run a state. */
const actions = `
#define LO_LEX_NEXT 1
#define LO_LEX_END 2
#define LO_LEX_NONE 3
#define LO_ADVANCE(state_value) { *lo_state = state_value; return LO_LEX_NEXT; }
#define LO_ADVANCE_MAP(...) { static const uint16_t map[] = { __VA_ARGS__ }; for (uint32_t i = 0; i < sizeof(map) / sizeof(map[0]); i += 2) { if (map[i] == lookahead) { *lo_state = map[i + 1]; return LO_LEX_NEXT; } } }
#define LO_SKIP(state_value) { *lo_skip = true; *lo_state = state_value; return LO_LEX_NEXT; }
#define LO_ACCEPT_TOKEN(symbol_value) *lo_result = true; lexer->result_symbol = symbol_value; lexer->mark_end(lexer);
#define LO_END_STATE() return LO_LEX_END;
`;

const include = /^#include ["<]tree_sitter\/parser\.h[">]\n/m;

/** The part's versions of the macros the generated cases use. */
function renamed(cases: string): string {
  return cases
    .replaceAll(/\bADVANCE_MAP\(/g, 'LO_ADVANCE_MAP(')
    .replaceAll(/\bADVANCE\(/g, 'LO_ADVANCE(')
    .replaceAll(/\bSKIP\(/g, 'LO_SKIP(')
    .replaceAll(/\bACCEPT_TOKEN\(/g, 'LO_ACCEPT_TOKEN(')
    .replaceAll(/\bEND_STATE\(\)/g, 'LO_END_STATE()');
}

/** `name`'s cases, in parts of at most `lines` lines, or nothing if it fits in one. */
function parts(name: string, body: string, lines: number): string[][] {
  const cases = body.split(/(?=^ {4}case \d+:\n)/m);
  let previous = -1;
  for (const block of cases) {
    const state = /^ {4}case (\d+):\n/.exec(block);
    if (!state) throw new Error(`${name} has code that isn't in a case.`);
    if (Number(state[1]) <= previous) throw new Error(`${name}'s states aren't in order.`);
    previous = Number(state[1]);
    // A case that didn't end would run on into the next, which may be in another part.
    if (!block.endsWith('      END_STATE();\n')) {
      throw new Error(`${name} has a case that runs on.`);
    }
  }
  const split: string[][] = [];
  let part: string[] = [];
  let size = 0;
  for (const block of cases) {
    const length = block.split('\n').length - 1;
    if (part.length > 0 && size + length > lines) {
      split.push(part);
      part = [];
      size = 0;
    }
    part.push(block);
    size += length;
  }
  split.push(part);
  return split.length > 1 ? split : [];
}

/** `source`, a generated parser.c, with each lexer function longer than `lines` lines split. */
export function splitLexers(source: string, lines: number): string {
  let text = source;
  let changed = false;
  for (const name of ['ts_lex', 'ts_lex_keywords']) {
    const head =
      `static bool ${name}(TSLexer *lexer, TSStateId state) {\n` +
      '  START_LEXER();\n  eof = lexer->eof(lexer);\n  switch (state) {\n';
    const tail = '    default:\n      return false;\n  }\n}\n';
    const start = text.indexOf(head);
    if (start === -1) {
      if (name === 'ts_lex') throw new Error("The parser's lexer isn't in the shape it splits.");
      continue;
    }
    const end = text.indexOf(tail, start);
    if (end === -1) throw new Error(`${name} doesn't end as it's expected to.`);
    const split = parts(name, text.slice(start + head.length, end), lines);
    if (split.length === 0) continue;
    const names = split.map((_, index) => `${name}_${index}`);
    const functions = split.map(
      (part, index) =>
        `static int ${names[index]}(TSLexer *lexer, TSStateId *lo_state, bool *lo_skip, ` +
        'bool *lo_result, int32_t lookahead, bool eof) {\n' +
        `  (void)eof;\n  switch (*lo_state) {\n${renamed(part.join(''))}` +
        '    default:\n      return LO_LEX_NONE;\n  }\n}\n\n',
    );
    const firsts = split.slice(1).map((part) => /^ {4}case (\d+):/.exec(part[0]!)![1]);
    const lexer =
      `static bool ${name}(TSLexer *lexer, TSStateId state) {\n` +
      '  START_LEXER();\n  eof = lexer->eof(lexer);\n' +
      '  static int (*const lo_parts[])(TSLexer *, TSStateId *, bool *, bool *, int32_t, bool) = ' +
      `{${names.join(', ')}};\n` +
      '  unsigned lo_part = 0;\n' +
      firsts.map((first) => `  if (state >= ${first}) lo_part++;\n`).join('') +
      '  int lo_action = lo_parts[lo_part](lexer, &state, &skip, &result, lookahead, eof);\n' +
      '  if (lo_action == LO_LEX_NEXT) goto next_state;\n' +
      '  if (lo_action == LO_LEX_END) return result;\n' +
      '  return false;\n}\n';
    text = text.slice(0, start) + functions.join('') + lexer + text.slice(end + tail.length);
    changed = true;
  }
  if (!changed) return source;
  if (!include.test(text)) throw new Error("The parser doesn't include tree_sitter/parser.h.");
  return text.replace(include, (line) => `${line}${actions}`);
}
