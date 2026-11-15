import { describe, expect, test } from 'vitest';

import { splitLexers } from './split.ts';

/** A generated lexer with a case for each state, `lines` lines long each. */
function parser(states: readonly number[], lines = 3): string {
  const cases = states.map(
    (state) =>
      `    case ${state}:\n` +
      `      ACCEPT_TOKEN(${state});\n`.repeat(lines - 2) +
      '      END_STATE();\n',
  );
  return (
    '#include "tree_sitter/parser.h"\n\n' +
    'static bool ts_lex(TSLexer *lexer, TSStateId state) {\n' +
    '  START_LEXER();\n  eof = lexer->eof(lexer);\n  switch (state) {\n' +
    `${cases.join('')}    default:\n      return false;\n  }\n}\n`
  );
}

describe('splitLexers', () => {
  test('leaves a lexer that fits in one part', () => {
    const source = parser([0, 1, 2]);
    expect(splitLexers(source, 9)).toBe(source);
  });

  test('splits a longer one into parts of whole cases, found by their first states', () => {
    const split = splitLexers(parser([0, 1, 2, 5, 7]), 6);

    expect(split.match(/^static int ts_lex_\d+\(/gm)).toEqual([
      'static int ts_lex_0(',
      'static int ts_lex_1(',
      'static int ts_lex_2(',
    ]);
    expect(split).toContain('= {ts_lex_0, ts_lex_1, ts_lex_2};');
    expect(split).toContain('  if (state >= 2) lo_part++;\n  if (state >= 7) lo_part++;\n');
    expect(split).toContain('      LO_ACCEPT_TOKEN(5);\n      LO_END_STATE();\n');
    expect(split).toMatch(/^#include "tree_sitter\/parser.h"\n\n#define LO_LEX_NEXT 1\n/);
  });

  test.each([
    ['states out of order', parser([0, 2, 1]), "ts_lex's states aren't in order."],
    [
      'a case that runs on into the next',
      parser([0, 1]).replace('      END_STATE();\n    case 1', '    case 1'),
      'ts_lex has a case that runs on.',
    ],
    [
      'a lexer in another shape',
      parser([0, 1]).replace('  START_LEXER();\n', ''),
      "The parser's lexer isn't in the shape it splits.",
    ],
  ])('refuses %s', (_, source, message) => {
    expect(() => splitLexers(source, 3)).toThrow(message);
  });
});
