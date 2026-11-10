import { parseSync, Visitor, type Argument, type Expression, type StringLiteral } from 'oxc-parser';

/** A module a file refers to, and the line it does so on. */
export interface Import {
  /** The module's name or path, or for a computed one, the expression's source. */
  specifier: string;
  line: number;
  /** From `/// <reference types="…" />`, which names a types package, or `path="…"`, a file. */
  reference?: 'types' | 'path';
  /** `import()` or `require()` of an expression, so the module is only known at run time. */
  computed?: true;
}

/** A file that doesn't parse, so its imports can't be listed. */
export class ParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

/**
 * Lists every module a JavaScript or TypeScript file refers to: imports and re-exports (type-only
 * ones too), `import()` and `require()`, `import x = require()`, `import('x')` types and
 * `/// <reference types="x" />` and `path="x"`. A string, or a template literal without substitutions, names its
 * module; any other argument to `import()` or `require()` is listed as computed. Throws a
 * `ParseError` for a file that doesn't parse.
 */
export function importsOf(filename: string, source: string): Import[] {
  const result = parseSync(filename, source);
  const lineStarts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
    lineStarts.push(i + 1);
  }
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  const [error] = result.errors;
  if (error) throw new ParseError(error.message, lineOf(error.labels[0]?.start ?? 0));

  const found: Import[] = [];
  const add = (literal: StringLiteral | null | undefined) => {
    if (literal) found.push({ specifier: literal.value, line: lineOf(literal.start) });
  };
  const load = (argument: Argument | Expression) => {
    const name = nameOf(argument);
    if (name === undefined) {
      const specifier = source.slice(argument.start, argument.end);
      found.push({ specifier, line: lineOf(argument.start), computed: true });
    } else {
      found.push({ specifier: name, line: lineOf(argument.start) });
    }
  };

  new Visitor({
    ImportDeclaration: (node) => add(node.source),
    ExportNamedDeclaration: (node) => add(node.source),
    ExportAllDeclaration: (node) => add(node.source),
    ImportExpression: (node) => load(node.source),
    TSImportType: (node) => add(node.source),
    TSExternalModuleReference: (node) => add(node.expression),
    CallExpression: (node) => {
      const [argument] = node.arguments;
      if (node.callee.type === 'Identifier' && node.callee.name === 'require' && argument) {
        load(argument);
      }
    },
  }).visit(result.program);

  for (const comment of result.comments) {
    const reference = /^\/\s*<reference\s+(types|path)\s*=\s*["']([^"']+)["']/.exec(comment.value);
    const kind = reference?.[1];
    if (comment.type === 'Line' && reference?.[2] && (kind === 'types' || kind === 'path')) {
      found.push({ specifier: reference[2], line: lineOf(comment.start), reference: kind });
    }
  }

  return found.toSorted((a, b) => a.line - b.line);
}

/** The module a string, or a template literal without substitutions, names. */
function nameOf(argument: Argument | Expression): string | undefined {
  if (argument.type === 'Literal' && typeof argument.value === 'string') return argument.value;
  if (argument.type === 'TemplateLiteral' && argument.expressions.length === 0) {
    const [quasi] = argument.quasis;
    return quasi?.value.cooked ?? quasi?.value.raw;
  }
  return undefined;
}
