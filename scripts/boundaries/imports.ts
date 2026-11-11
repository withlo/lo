import { parseSync, Visitor, type StringLiteral } from 'oxc-parser';

/** A module a file refers to, and the line it does so on. */
export interface Import {
  /** The module's name or path, or for a computed one, the expression's source. */
  specifier: string;
  line: number;
  /** From `/// <reference types="…" />`, which names a types package, or `path="…"`, a file. */
  reference?: 'types' | 'path';
  /** `import()` or `require()` of an expression, so the module is only known at run time. */
  computed?: true;
  /**
   * A way to load modules that the check can't follow, which `specifier` shows: a use of `require`
   * other than a call that names its module, or any mention of `createRequire` or
   * `getBuiltinModule`.
   */
  loader?: 'require' | 'createRequire' | 'getBuiltinModule';
}

/** A file that doesn't parse, so its imports can't be listed. */
export class ParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

/** A node of the syntax tree oxc-parser gives. */
type Node = { type: string; start: number; end: number; [key: string]: unknown };

/**
 * Lists every module a JavaScript or TypeScript file refers to: imports and re-exports (type-only
 * ones too), `import()` and `require()`, `import x = require()`, `import('x')` types,
 * `/// <reference types="x" />` and `path="x"`, and calls to a `require` that `createRequire()`
 * makes. A string, or a template literal without substitutions, names its module; any other
 * argument to `import()` is listed as computed. Also lists the file's loaders (see `Import`).
 * Throws a `ParseError` for a file that doesn't parse.
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
  const load = (argument: unknown) => {
    if (!isNode(argument)) return;
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
  }).visit(result.program);

  const program: unknown = result.program;
  const nodes = isNode(program) ? walk(program) : [];
  for (const [node, parent] of nodes) {
    const name = mentionOf(node, parent);
    if (name === 'createRequire' || name === 'getBuiltinModule') {
      found.push({ specifier: name, line: lineOf(node.start), loader: name });
    } else if (
      name === 'require' &&
      node.type === 'Identifier' &&
      parent?.type === 'CallExpression' &&
      parent.callee === node &&
      namedCall(parent)
    ) {
      load(firstArgument(parent));
    } else if (name === 'require' && !harmless(node, parent)) {
      // Shown with what's around it: `module.require`, `require.call`, `require(name)`.
      const around =
        parent?.type === 'MemberExpression' ||
        (parent?.type === 'CallExpression' && parent.callee === node);
      const { start, end } = around ? parent : node;
      found.push({ specifier: source.slice(start, end), line: lineOf(start), loader: 'require' });
    }
  }

  // A require made from this file loads what it's called with, as `require()` does. A require made
  // from another file resolves from there, and one handed on can be called anywhere, so what
  // they load is only known at run time.
  for (const { use, parent, local } of madeRequires(nodes)) {
    const called = parent?.type === 'CallExpression' && parent.callee === use;
    const [argument] = called && Array.isArray(parent.arguments) ? parent.arguments : [];
    if (local && isNode(argument)) {
      load(argument);
    } else {
      const { start, end } = called ? parent : use;
      found.push({ specifier: source.slice(start, end), line: lineOf(start), computed: true });
    }
  }

  for (const comment of result.comments) {
    const reference = /^\/\s*<reference\s+(types|path)\s*=\s*["']([^"']+)["']/.exec(comment.value);
    const kind = reference?.[1];
    if (comment.type === 'Line' && reference?.[2] && (kind === 'types' || kind === 'path')) {
      found.push({ specifier: reference[2], line: lineOf(comment.start), reference: kind });
    }
  }

  // A `require` that `createRequire()` made is listed twice when it's named `require`.
  const unique = new Map(found.map((item) => [JSON.stringify(item), item]));
  return [...unique.values()].toSorted((a, b) => a.line - b.line);
}

/** The module a string, or a template literal without substitutions, names. */
function nameOf(argument: Node): string | undefined {
  if (argument.type === 'Literal' && typeof argument.value === 'string') return argument.value;
  const { expressions, quasis } = argument;
  if (argument.type !== 'TemplateLiteral' || !Array.isArray(expressions)) return undefined;
  if (expressions.length > 0 || !Array.isArray(quasis)) return undefined;
  const [quasi]: unknown[] = quasis;
  const value: unknown = isNode(quasi) ? quasi.value : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const cooked: unknown = Reflect.get(value, 'cooked');
  const raw: unknown = Reflect.get(value, 'raw');
  return typeof cooked === 'string' ? cooked : typeof raw === 'string' ? raw : undefined;
}

/**
 * The name an identifier, or a string in a property's place, mentions: `name`, `a['name']`,
 * `{ 'name': … }` or `import { 'name' as … }`. Strings anywhere else are only text.
 */
function mentionOf(node: Node, parent: Node | undefined): string | undefined {
  if (node.type === 'Identifier') return identifier(node);
  if (node.type !== 'Literal' || typeof node.value !== 'string') return undefined;
  const named =
    (parent?.type === 'MemberExpression' && parent.property === node) ||
    (parent?.type === 'Property' && parent.key === node) ||
    (parent?.type === 'ImportSpecifier' && parent.imported === node) ||
    (parent?.type === 'ExportSpecifier' && parent.local === node);
  return named ? node.value : undefined;
}

/** Whether a call's first argument names a module. */
function namedCall(call: Node): boolean {
  const argument = firstArgument(call);
  return isNode(argument) && nameOf(argument) !== undefined;
}

function firstArgument(call: Node): unknown {
  return Array.isArray(call.arguments) ? call.arguments[0] : undefined;
}

/**
 * Whether a mention of `require` can't load anything: a key of an object or class that happens to
 * be named `require`, or `typeof require`.
 */
function harmless(node: Node, parent: Node | undefined): boolean {
  if (parent?.type === 'UnaryExpression') return parent.operator === 'typeof';
  const key =
    parent?.type === 'Property' ||
    parent?.type === 'MethodDefinition' ||
    parent?.type === 'PropertyDefinition';
  return key && parent.key === node && parent.value !== node && !parent.computed;
}

interface MadeRequire {
  /** A `createRequire()` call, or a name one's assigned to. */
  use: Node;
  parent: Node | undefined;
  /** Whether the require resolves from this file: it's made from `import.meta.url` or `__filename`. */
  local: boolean;
}

/**
 * Each use of a `require` that `createRequire()` makes, other than its `resolve()`, which only finds
 * a path. A require assigned to a name is followed through that name's uses.
 */
function madeRequires(nodes: readonly [Node, Node | undefined][]): MadeRequire[] {
  // `createRequire` by its own name, or by any name it's imported or destructured as.
  const makers = new Set(['createRequire']);
  for (const [node, parent] of nodes) {
    const imported = node.type === 'ImportSpecifier' && propertyName(node, 'imported');
    const destructured = node.type === 'Property' && parent?.type === 'ObjectPattern';
    const name =
      imported === 'createRequire'
        ? identifier(child(node, 'local'))
        : destructured && propertyName(node, 'key') === 'createRequire'
          ? identifier(child(node, 'value'))
          : undefined;
    if (name) makers.add(name);
  }
  const makes = (node: Node): boolean => {
    const callee = node.type === 'CallExpression' ? child(node, 'callee') : undefined;
    if (callee?.type === 'MemberExpression') {
      return propertyName(callee, 'property') === 'createRequire';
    }
    const name = identifier(callee);
    return name !== undefined && makers.has(name);
  };
  const fromHere = (call: Node): boolean => {
    const [base] = Array.isArray(call.arguments) ? call.arguments : [];
    if (!isNode(base)) return false;
    if (base.type === 'Identifier') return identifier(base) === '__filename';
    return (
      base.type === 'MemberExpression' &&
      propertyName(base, 'property') === 'url' &&
      child(base, 'object')?.type === 'MetaProperty'
    );
  };

  // The names made requires are assigned to, and whether every one assigned resolves from here.
  const names = new Map<string, boolean>();
  for (const [node, parent] of nodes) {
    const name = makes(node) ? assignedTo(node, parent) : undefined;
    if (name) names.set(name, (names.get(name) ?? true) && fromHere(node));
  }

  const uses: MadeRequire[] = [];
  for (const [node, parent] of nodes) {
    let local: boolean;
    if (makes(node)) {
      if (assignedTo(node, parent)) continue;
      local = fromHere(node);
    } else {
      const name = identifier(node);
      if (name === undefined || !names.has(name) || !isUse(node, parent)) continue;
      local = names.get(name) ?? false;
    }
    const resolves =
      parent?.type === 'MemberExpression' &&
      parent.object === node &&
      propertyName(parent, 'property') === 'resolve';
    if (!resolves) uses.push({ use: node, parent, local });
  }
  return uses;
}

/** Every node in the tree, each with its parent. */
function walk(root: Node): [Node, Node | undefined][] {
  const nodes: [Node, Node | undefined][] = [];
  const stack: [Node, Node | undefined][] = [[root, undefined]];
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    nodes.push(entry);
    const [node] = entry;
    for (const value of Object.values(node)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (isNode(item)) stack.push([item, node]);
      }
    }
  }
  return nodes;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  );
}

function child(node: Node | undefined, key: string): Node | undefined {
  const value = node?.[key];
  return isNode(value) ? value : undefined;
}

function identifier(node: Node | undefined): string | undefined {
  return node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : undefined;
}

/** The name in `a.name`, `a['name']`, `{ name: … }`, `{ 'name': … }` or `import { name }`. */
function propertyName(node: Node, key: 'property' | 'key' | 'imported'): string | undefined {
  const name = child(node, key);
  if (!node.computed && name?.type === 'Identifier') return identifier(name);
  return name?.type === 'Literal' && typeof name.value === 'string' ? name.value : undefined;
}

/** The name a value is assigned to, in `const name = value` or `name = value`. */
function assignedTo(node: Node, parent: Node | undefined): string | undefined {
  if (parent?.type === 'VariableDeclarator' && parent.init === node) {
    return identifier(child(parent, 'id'));
  }
  if (parent?.type === 'AssignmentExpression' && parent.right === node) {
    return identifier(child(parent, 'left'));
  }
  return undefined;
}

/** Whether an identifier stands for its value, rather than binding its name or naming a property. */
function isUse(node: Node, parent: Node | undefined): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case 'VariableDeclarator':
      return parent.id !== node;
    case 'AssignmentExpression':
      return parent.left !== node;
    case 'MemberExpression':
      return parent.property !== node || Boolean(parent.computed);
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.key !== node || Boolean(parent.computed) || parent.value === node;
    case 'ExportSpecifier':
      return parent.local === node;
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    default:
      return true;
  }
}
