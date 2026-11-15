// Imports: what a file's import statements bring in and from where, read from its syntax tree,
// and a guess at which files they name, from the importing file's path and text alone. Nothing
// here reads a project's manifest (`tsconfig.json`, `Cargo.toml`, `go.mod`, `composer.json`), so
// where those would decide, it guesses, or names no file.

import type { Node } from 'web-tree-sitter';

import type { TaggedLanguage } from './tagged.ts';

/** A name an import brings in, and the name the file uses for it when that's another. */
export interface ImportedName {
  name: string;
  as?: string;
}

/** An import statement, or one of the paths a statement imports. */
export interface Import {
  /** The line it starts on, from 1. */
  line: number;
  /**
   * What it imports from, as the file writes it: `./parse`, `zod`, `.models`, `crate::stacks`,
   * `github.com/acme/app/store`, `com.acme.shapes`, `App\Models`. Empty for a PHP class imported
   * from the global namespace.
   */
  module: string;
  /**
   * The names it brings in by name, or `all` for a module brought in whole, used through a
   * qualifier or a wildcard. A default import is the name `default`.
   */
  names: readonly ImportedName[] | 'all';
}

/** What a file's import statements say. */
export interface Imports {
  imports: Import[];
  /**
   * The package or namespace the file declares itself in, where its language imports from it
   * without a statement: Java's and Kotlin's `package`, PHP's `namespace`.
   */
  namespace?: string;
}

// The importing file's text is anyone's, so these bound what reading its imports can cost. Each is
// well past what real code needs.

/** The most imports read from one file. */
export const maxImports = 4000;

/** The most names read from one import statement. */
const maxNames = 1000;

/**
 * The longest module an import may name, or a file declare itself in. An import from a longer one
 * is left out, and so is a longer package or namespace.
 */
const maxModuleLength = 256;

/**
 * The imports in `statements`, the nodes a language's `imports.scm` captures as `@import`, in the
 * order they start.
 */
export function importsOf(
  language: TaggedLanguage,
  statements: readonly Node[],
  text: string,
): Imports {
  const read = readers[language];
  const out: Imports = { imports: [] };
  if (!read) return out;
  const at = (node: Node): string => text.slice(node.startIndex, node.endIndex);
  let declared = false;
  for (const statement of statements) {
    if (out.imports.length >= maxImports) break;
    const line = statement.startPosition.row + 1;
    read(
      statement,
      at,
      (module, names) => {
        if (out.imports.length >= maxImports || module.length > maxModuleLength) return;
        out.imports.push({
          line,
          module,
          names: names === 'all' ? 'all' : names.slice(0, maxNames),
        });
      },
      (namespace) => {
        // The first the file declares, unless it's longer than any module an import may name.
        if (declared) return;
        declared = true;
        if (namespace.length <= maxModuleLength) out.namespace = namespace;
      },
    );
  }
  return out;
}

type Text = (node: Node) => string;
type Add = (module: string, names: ImportedName[] | 'all') => void;
type Reader = (statement: Node, at: Text, add: Add, declare: (namespace: string) => void) => void;

/** A node's named children, at most `maxNames` of them. */
function* children(node: Node | null | undefined): Generator<Node> {
  if (!node) return;
  const count = Math.min(node.namedChildCount, maxNames);
  for (let index = 0; index < count; index++) {
    const child = node.namedChild(index);
    if (child) yield child;
  }
}

/** A node's named children in `field`, at most `maxNames` of them. */
function* fieldChildren(node: Node, field: string): Generator<Node> {
  const count = Math.min(node.namedChildCount, maxNames);
  for (let index = 0; index < count; index++) {
    if (node.fieldNameForNamedChild(index) !== field) continue;
    const child = node.namedChild(index);
    if (child) yield child;
  }
}

/** A name, with its alias unless the alias is the name itself. */
function named(name: string, alias: string | undefined): ImportedName {
  return alias === undefined || alias === name ? { name } : { name, as: alias };
}

/** The module a JavaScript `string` names, if it's a plain string. */
function stringModule(node: Node | null | undefined, at: Text): string | undefined {
  if (node?.type !== 'string') return undefined;
  const fragment = node.namedChild(0);
  if (node.namedChildCount !== 1 || fragment?.type !== 'string_fragment') return undefined;
  return at(fragment);
}

const javascript: Reader = (statement, at, add) => {
  switch (statement.type) {
    case 'import_statement': {
      const clause =
        statement.childForFieldName('import_clause') ??
        [...children(statement)].find((child) => child.type.startsWith('import_'));
      if (clause?.type === 'import_require_clause') {
        // TypeScript's `import x = require('./x')`.
        const module = stringModule(clause.childForFieldName('source'), at);
        if (module !== undefined) add(module, 'all');
        return;
      }
      const module = stringModule(statement.childForFieldName('source'), at);
      if (module === undefined) return;
      const names: ImportedName[] = [];
      let all = false;
      for (const part of children(clause)) {
        if (part.type === 'identifier') names.push({ name: 'default', as: at(part) });
        else if (part.type === 'namespace_import') all = true;
        else if (part.type === 'named_imports') {
          for (const specifier of children(part)) {
            if (specifier.type !== 'import_specifier') continue;
            const name = specifier.childForFieldName('name');
            if (!name) continue;
            const alias = specifier.childForFieldName('alias');
            names.push(named(at(name), alias ? at(alias) : undefined));
          }
        }
      }
      add(module, all ? 'all' : names);
      return;
    }
    case 'export_statement': {
      // A re-export: `export { a, b as c } from './a'`, `export * from './b'`.
      const module = stringModule(statement.childForFieldName('source'), at);
      if (module === undefined) return;
      const clause = [...children(statement)].find((child) => child.type === 'export_clause');
      if (!clause) {
        add(module, 'all');
        return;
      }
      const names: ImportedName[] = [];
      for (const specifier of children(clause)) {
        if (specifier.type !== 'export_specifier') continue;
        const name = specifier.childForFieldName('name');
        const alias = specifier.childForFieldName('alias');
        if (name) names.push(named(at(name), alias ? at(alias) : undefined));
      }
      add(module, names);
      return;
    }
    case 'call_expression': {
      // `require('./x')` and `import('./x')`, the module the call's only argument.
      const args = statement.childForFieldName('arguments');
      if (args?.namedChildCount !== 1) return;
      const module = stringModule(args.namedChild(0), at);
      if (module === undefined) return;
      if (statement.childForFieldName('function')?.type === 'import') {
        add(module, 'all');
        return;
      }
      const parent = statement.parent;
      const target =
        parent?.type === 'variable_declarator' ? parent.childForFieldName('name') : null;
      if (target?.type === 'object_pattern') {
        // `const { a, b: c } = require('./x')`.
        const names: ImportedName[] = [];
        for (const property of children(target)) {
          if (property.type === 'shorthand_property_identifier_pattern') {
            names.push({ name: at(property) });
          } else if (property.type === 'pair_pattern') {
            const key = property.childForFieldName('key');
            const value = property.childForFieldName('value');
            if (key && value?.type === 'identifier') names.push(named(at(key), at(value)));
          }
        }
        add(module, names);
      } else if (target) {
        add(module, 'all');
      } else {
        add(module, []);
      }
      return;
    }
    default:
      return;
  }
};

/** A Python module as written: `a.b`, `.x`, `..`. */
function pythonModule(node: Node | null | undefined, at: Text): string | undefined {
  if (node?.type === 'dotted_name' || node?.type === 'relative_import')
    return at(node).replaceAll(/\s/g, '');
  return undefined;
}

const python: Reader = (statement, at, add) => {
  if (statement.type === 'import_statement') {
    // `import a.b`, `import a.b as c`: the module, used through its name.
    for (const name of fieldChildren(statement, 'name')) {
      const module = pythonModule(
        name.type === 'aliased_import' ? name.childForFieldName('name') : name,
        at,
      );
      if (module !== undefined) add(module, 'all');
    }
    return;
  }
  if (statement.type !== 'import_from_statement') return;
  const module = pythonModule(statement.childForFieldName('module_name'), at);
  if (module === undefined) return;
  if ([...children(statement)].some((child) => child.type === 'wildcard_import')) {
    add(module, 'all');
    return;
  }
  const names: ImportedName[] = [];
  for (const name of fieldChildren(statement, 'name')) {
    if (name.type === 'aliased_import') {
      const original = name.childForFieldName('name');
      const alias = name.childForFieldName('alias');
      if (original) names.push(named(at(original), alias ? at(alias) : undefined));
    } else if (name.type === 'dotted_name') {
      names.push({ name: at(name) });
    }
  }
  add(module, names);
};

/** How many modules written inline, `mod tests { … }`, a Rust item is inside. */
function inlineModules(node: Node): number {
  let count = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'mod_item') count++;
  }
  return count;
}

const rust: Reader = (statement, at, add) => {
  // Paths from `self` and `super` start from the module the item is in. Inside a module written
  // inline, that's in the same file, so only those that climb out of the file are kept, from the
  // file's own module.
  const inline = inlineModules(statement);
  const addFromFile: Add = (module, names) => {
    if (inline === 0) {
      add(module, names);
      return;
    }
    const parts = module.split('::');
    if (parts[0] === 'self') return;
    if (parts[0] !== 'super') {
      add(module, names);
      return;
    }
    let supers = 0;
    while (parts[supers] === 'super') supers++;
    if (supers <= inline) return;
    add(parts.slice(inline).join('::'), names);
  };
  if (statement.type === 'mod_item') {
    // `mod child;`, a module in a file of its own, used through its name.
    const name = statement.childForFieldName('name');
    if (name && !statement.childForFieldName('body') && inline === 0)
      add(`self::${at(name)}`, 'all');
    return;
  }
  if (statement.type !== 'use_declaration') return;
  let budget = maxNames;
  /**
   * A path's parts, `a::b::c` as `a`, `b` and `c`, or `undefined` if it isn't a plain path, or
   * its module, every part but the last, is longer than `maxModuleLength`. A path is a chain of
   * nodes as long as it has parts, so it's walked in a loop, and no further than that length.
   */
  const path = (part: Node | null): string[] | undefined => {
    // Last part first.
    const parts: string[] = [];
    let module = -2;
    const push = (name: string): boolean => {
      if (parts.length > 0) module += name.length + 2;
      parts.push(name);
      return module <= maxModuleLength;
    };
    for (let node = part; node;) {
      if (node.type === 'scoped_identifier') {
        const name = node.childForFieldName('name');
        if (!name || !push(at(name))) return undefined;
        node = node.childForFieldName('path');
      } else if (['identifier', 'crate', 'self', 'super'].includes(node.type)) {
        if (!push(at(node))) return undefined;
        break;
      } else {
        return undefined;
      }
    }
    return parts.toReversed();
  };
  // Walks a use tree, with the path of the lists it's in. Lists nest no deeper than the file's
  // brackets, which the tagger has checked.
  const walk = (node: Node | null, prefix: string[]): void => {
    if (!node || budget-- <= 0) return;
    switch (node.type) {
      case 'identifier':
      case 'scoped_identifier': {
        const parts = path(node);
        if (!parts) return;
        const full = [...prefix, ...parts];
        const name = full.pop();
        if (name !== undefined) addFromFile(full.join('::'), [{ name }]);
        return;
      }
      case 'self':
        // `self` in a list: the list's module, used through its name.
        if (prefix.length > 0) addFromFile(prefix.join('::'), 'all');
        return;
      case 'use_as_clause': {
        const parts = path(node.childForFieldName('path'));
        const alias = node.childForFieldName('alias');
        if (!parts) return;
        const full = [...prefix, ...parts];
        const name = full.pop();
        if (name !== undefined) {
          addFromFile(full.join('::'), [named(name, alias ? at(alias) : undefined)]);
        }
        return;
      }
      case 'use_wildcard': {
        const parts = path(node.namedChild(0));
        if (parts) addFromFile([...prefix, ...parts].join('::'), 'all');
        return;
      }
      case 'scoped_use_list': {
        const parts = path(node.childForFieldName('path'));
        if (!parts) return;
        for (const child of children(node.childForFieldName('list')))
          walk(child, [...prefix, ...parts]);
        return;
      }
      case 'use_list':
        for (const child of children(node)) walk(child, prefix);
        return;
      default:
        return;
    }
  };
  walk(statement.childForFieldName('argument'), []);
};

const go: Reader = (statement, at, add) => {
  if (statement.type !== 'import_spec') return;
  const path = statement.childForFieldName('path');
  const content = path?.namedChild(0);
  if (path?.namedChildCount !== 1 || content?.type !== 'interpreted_string_literal_content') return;
  // A blank import brings nothing in; any other brings in the package, used through its name.
  add(at(content), statement.childForFieldName('name')?.type === 'blank_identifier' ? [] : 'all');
};

/** A Java or Kotlin name as parts: `a.b.C`. */
function dottedParts(node: Node | null | undefined, at: Text): string[] | undefined {
  if (!node) return undefined;
  const parts = at(node).replaceAll(/\s/g, '').split('.');
  return parts.every((part) => part !== '') ? parts : undefined;
}

const java: Reader = (statement, at, add, declare) => {
  const name = [...children(statement)].find(
    (child) => child.type === 'scoped_identifier' || child.type === 'identifier',
  );
  const parts = dottedParts(name, at);
  if (!parts) return;
  if (statement.type === 'package_declaration') {
    declare(parts.join('.'));
    return;
  }
  if (statement.type !== 'import_declaration') return;
  if ([...children(statement)].some((child) => child.type === 'asterisk')) {
    add(parts.join('.'), 'all');
    return;
  }
  const last = parts.pop();
  if (last !== undefined) add(parts.join('.'), [{ name: last }]);
};

const kotlin: Reader = (statement, at, add, declare) => {
  const parts = dottedParts(
    [...children(statement)].find((child) => child.type === 'identifier'),
    at,
  );
  if (!parts) return;
  if (statement.type === 'package_header') {
    declare(parts.join('.'));
    return;
  }
  if (statement.type !== 'import_header') return;
  const all = [...children(statement)].some((child) => child.type === 'wildcard_import');
  if (all) {
    add(parts.join('.'), 'all');
    return;
  }
  const alias = [...children(statement)].find((child) => child.type === 'import_alias');
  const last = parts.pop();
  if (last !== undefined) {
    add(parts.join('.'), [
      named(last, alias?.namedChild(0) ? at(alias.namedChild(0)!) : undefined),
    ]);
  }
};

/** A PHP name as parts: `App\Models\User`. */
function backslashParts(node: Node | null | undefined, at: Text): string[] | undefined {
  if (!node) return undefined;
  const parts = at(node).replaceAll(/\s/g, '').replace(/^\\/, '').split('\\');
  return parts.every((part) => part !== '') ? parts : undefined;
}

const php: Reader = (statement, at, add, declare) => {
  if (statement.type === 'namespace_definition') {
    const parts = backslashParts(statement.childForFieldName('name'), at);
    if (parts) declare(parts.join('\\'));
    return;
  }
  if (statement.type !== 'namespace_use_declaration') return;
  /** Adds a `use` clause's name, under `prefix`'s namespace. */
  const clause = (node: Node, prefix: readonly string[]): void => {
    const target = [...children(node)].find(
      (child) => child.type === 'qualified_name' || child.type === 'name',
    );
    const parts = backslashParts(target, at);
    if (!parts) return;
    const alias = node.childForFieldName('alias');
    const full = [...prefix, ...parts];
    const name = full.pop()!;
    add(full.join('\\'), [named(name, alias ? at(alias) : undefined)]);
  };
  const group = statement.childForFieldName('body');
  if (group) {
    // `use App\Models\{Post, Comment as C}`.
    const prefix = backslashParts(
      [...children(statement)].find((child) => child.type === 'namespace_name'),
      at,
    );
    if (!prefix) return;
    for (const child of children(group)) {
      if (child.type === 'namespace_use_clause') clause(child, prefix);
    }
    return;
  }
  for (const child of children(statement)) {
    if (child.type === 'namespace_use_clause') clause(child, []);
  }
};

const readers: Partial<Record<TaggedLanguage, Reader>> = {
  go,
  java,
  javascript,
  kotlin,
  php,
  python,
  rust,
  tsx: javascript,
  typescript: javascript,
};
