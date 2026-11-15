// Tags: a file's definitions, the names it refers to and its imports, read with tree-sitter's tag
// queries, for the syntax index. Like highlighting, it runs on worker threads in the background
// process, one text at a time, under the same limits and in the same WebAssembly memory. What it
// reads depends only on the text and its language, never on the file's path, so the index keeps
// one reading per blob.

import { Language, Parser, Query, type Node, type QueryCapture } from 'web-tree-sitter';

import { defaultMaxDepth, defaultTimeout, nestingDepth, type Loader } from './highlight.ts';
import { importsOf, maxImports, type Import, type Imports } from './imports.ts';
import { languages } from './languages.ts';
import {
  abortedTooOften,
  Aborted,
  countAbort,
  memoryCeiling,
  memoryInUse,
  parseText,
  startTreeSitter,
} from './runtime.ts';
import { tagQueries, type TaggedLanguage } from './tagged.ts';

/** What a definition is, as its tag names it. */
export const definitionKinds = [
  'class',
  'constant',
  'enum',
  'field',
  'function',
  'interface',
  'macro',
  'method',
  'module',
  'property',
  'type',
  'variable',
] as const;

export type DefinitionKind = (typeof definitionKinds)[number];

/** A definition of a name: a function, a class, a constant and so on. */
export interface Definition {
  name: string;
  kind: DefinitionKind;
  /** Where its name is: the line, from 1. */
  line: number;
  /** The column its name starts at, from 0, in UTF-16 code units. */
  column: number;
  /** The last line of the whole definition, from 1. */
  lastLine: number;
  /** The definition it's inside, by its place in `definitions`, if it's inside one. */
  parent?: number;
}

/** What the syntax index reads from one file. */
export interface Symbols {
  /** In the order their names appear. */
  definitions: Definition[];
  /** The names the file refers to, each once, sorted. */
  references: string[];
  /** In the order they appear. */
  imports: Import[];
  /**
   * The package or namespace the file declares itself in, where its language imports from it
   * without a statement: Java's and Kotlin's `package`, PHP's `namespace`.
   */
  namespace?: string;
}

/** A use of a name in a file. */
export interface Use {
  /** From 1. */
  line: number;
  /** From 0, in UTF-16 code units. */
  column: number;
}

/**
 * Why a file wasn't read: longer than `maxLength`, holding a NUL as binary files do, minified (a
 * line longer than `longestLine`), nested too deeply, with more than `maxTags` names, out of time,
 * out of memory, or failed: a scanner aborted on it, or something else failed, after which the
 * tagger isn't `usable`.
 */
export type Skip =
  | 'too-long'
  | 'binary'
  | 'minified'
  | 'too-deep'
  | 'too-many'
  | 'timed-out'
  | 'out-of-memory'
  | 'failed';

export type Tags = { symbols: Symbols } | { skipped: Skip };

export type Found = { uses: Use[] } | { skipped: Skip };

export interface TagOptions {
  /** How long parsing and querying may take, in milliseconds, before giving up. */
  timeout?: number;
  /** The longest text to read, in UTF-16 code units. A longer file isn't parsed at all. */
  maxLength?: number;
  /** The deepest nesting to read. A file nested deeper isn't parsed at all. */
  maxDepth?: number;
}

/**
 * A million UTF-16 code units, which a file of 1 MB never passes: the index reads no larger file.
 */
export const defaultTagLength = 1_000_000;

/** A line longer than this marks a minified file, which the index doesn't read. */
export const longestLine = 10_000;

/**
 * The most names a file may tag, definitions and uses, before it's skipped, which bounds the memory
 * reading one takes. Real files of a megabyte tag under half as many; a file built of nothing but
 * names can tag five times as many.
 */
export const maxTags = 100_000;

/**
 * The longest name a tag may have. Names are words, except where a query takes an expression
 * whole, as JavaScript's does for the constructor of `new (…)`.
 */
const maxNameLength = 256;

/** How much text one step of a query covers, between checks of the deadline. */
const queryStep = 1 << 16;

/**
 * How deep in the syntax tree a tag may start. Deeper, tree-sitter's query cursor checks the
 * matches it has started at every node after, so a file of names nested in one another, which
 * the depth guard can't see, as a chain of `+`, takes minutes. Real code tags well inside it.
 */
const maxStartDepth = 10_000;

/** What a capture in a tags query marks. */
type Role =
  | { kind: 'name' }
  | { kind: 'ignore' }
  | { kind: 'definition'; of: DefinitionKind }
  | { kind: 'reference' }
  | { kind: 'import' }
  | { kind: 'unused' };

/**
 * What a capture's name marks: `@name` is the name a tag is for, `@definition.<kind>` and
 * `@reference.<kind>` the whole definition or use, `@ignore` a name no later pattern may tag,
 * and `@import` a statement that imports. Anything else, such as `@doc` or a name that only
 * feeds a predicate, marks nothing.
 */
export function roleOf(capture: string): Role {
  if (capture === 'name') return { kind: 'name' };
  if (capture === 'ignore') return { kind: 'ignore' };
  if (capture === 'import') return { kind: 'import' };
  if (capture.startsWith('reference.')) return { kind: 'reference' };
  if (capture.startsWith('definition.')) {
    const of = definitionKinds.find((kind) => `definition.${kind}` === capture);
    return of ? { kind: 'definition', of } : { kind: 'unused' };
  }
  return { kind: 'unused' };
}

interface Compiled {
  language: Language;
  query: Query;
  /** What each of the query's captures marks, by its name. */
  roles: Map<string, Role>;
}

/** A name a pattern tagged, before a file's tags are put together. */
interface Tag {
  /** Where the name is, in UTF-16 code units. */
  from: number;
  to: number;
  /** Which pattern tagged it, the earliest first. */
  pattern: number;
  line: number;
  column: number;
  /** A definition's kind, or `reference`, or `ignore` for a name no later pattern may tag. */
  as: DefinitionKind | 'reference' | 'ignore';
  /** The whole definition, the name included. */
  start: number;
  end: number;
  lastLine: number;
}

type Read = { tags: Tag[]; imports: Imports } | { skipped: Skip };

/**
 * Reads files' tags in every language in `taggedLanguages`. Make one per worker thread, and read
 * one text at a time. A language's grammar loads and its queries compile the first time a text
 * needs them. WebAssembly memory is the thread's, so once a tagger has failed, or the memory has
 * grown past `memoryCeiling`, it says it isn't `usable`, and its thread should be replaced.
 */
export class Tagger {
  #parser: Parser;
  readonly #loader: Loader;
  /** Each grammar once a language has needed it, by its name in `grammars.json`. */
  readonly #grammars = new Map<string, Promise<Language>>();
  readonly #compiled = new Map<TaggedLanguage, Promise<Compiled>>();
  #failed = false;
  #loadMs = 0;

  private constructor(parser: Parser, loader: Loader) {
    this.#parser = parser;
    this.#loader = loader;
  }

  /** Starts tree-sitter in this thread. No grammar loads until a text needs it. */
  static async create(loader: Loader): Promise<Tagger> {
    await startTreeSitter();
    return new Tagger(new Parser(), loader);
  }

  /** How long the tagger has spent loading grammars and compiling queries, in milliseconds. */
  get loadMs(): number {
    return this.#loadMs;
  }

  /** How many bytes of WebAssembly memory the thread's parsers hold. */
  get memory(): number {
    return memoryInUse();
  }

  /**
   * Whether the tagger can go on: it hasn't failed, its thread hasn't aborted too often, and the
   * memory is under the ceiling.
   */
  get usable(): boolean {
    return !this.#failed && !abortedTooOften() && this.memory <= memoryCeiling;
  }

  /** `text`'s definitions, the names it refers to and its imports, read as `language`. */
  async symbols(language: TaggedLanguage, text: string, options: TagOptions = {}): Promise<Tags> {
    const read = await this.#read(language, text, options);
    if ('skipped' in read) return read;
    const definitions: Definition[] = [];
    const references = new Set<string>();
    const defined: Tag[] = [];
    for (const tag of read.tags) {
      if (tag.as === 'ignore') continue;
      const name = text.slice(tag.from, tag.to);
      if (tag.as === 'reference') {
        references.add(name);
        continue;
      }
      defined.push(tag);
      definitions.push({
        name,
        kind: tag.as,
        line: tag.line,
        column: tag.column,
        lastLine: tag.lastLine,
      });
    }
    for (const [index, parent] of parentsOf(defined).entries()) {
      if (parent !== undefined) definitions[index]!.parent = parent;
    }
    const symbols: Symbols = {
      definitions,
      references: [...references].toSorted(),
      imports: read.imports.imports,
    };
    if (read.imports.namespace !== undefined) symbols.namespace = read.imports.namespace;
    return { symbols };
  }

  /** Where `text`, read as `language`, uses `name`, as the names it refers to count them. */
  async find(
    language: TaggedLanguage,
    text: string,
    name: string,
    options: TagOptions = {},
  ): Promise<Found> {
    const read = await this.#read(language, text, options);
    if ('skipped' in read) return read;
    const uses: Use[] = [];
    for (const tag of read.tags) {
      if (tag.as !== 'reference' || tag.to - tag.from !== name.length) continue;
      if (text.startsWith(name, tag.from)) uses.push({ line: tag.line, column: tag.column });
    }
    return { uses };
  }

  /** `text`'s tags, each name's once, in the order the names appear, and its imports. */
  async #read(language: TaggedLanguage, text: string, options: TagOptions): Promise<Read> {
    if (this.#failed || abortedTooOften()) return { skipped: 'failed' };
    if (text.length > (options.maxLength ?? defaultTagLength)) return { skipped: 'too-long' };
    if (text.includes('\0')) return { skipped: 'binary' };
    if (hasLongLine(text, longestLine)) return { skipped: 'minified' };
    if (nestingDepth(text, language) > (options.maxDepth ?? defaultMaxDepth)) {
      return { skipped: 'too-deep' };
    }
    let compiled: Compiled;
    const started = performance.now();
    try {
      compiled = await this.#load(language);
    } catch {
      this.#failed = true;
      return { skipped: 'failed' };
    } finally {
      this.#loadMs += performance.now() - started;
    }
    const deadline = performance.now() + (options.timeout ?? defaultTimeout);
    let stopped: 'timed-out' | 'out-of-memory' | undefined;
    const progressCallback = (): boolean => {
      if (stopped) return true;
      if (performance.now() > deadline) stopped = 'timed-out';
      else if (memoryInUse() > memoryCeiling) stopped = 'out-of-memory';
      return stopped !== undefined;
    };
    try {
      this.#parser.setLanguage(compiled.language);
      const tree = parseText(this.#parser, text, { progressCallback });
      if (!tree) return { skipped: stopped ?? 'timed-out' };
      try {
        return collect(language, compiled, tree.rootNode, text, progressCallback, () => stopped);
      } finally {
        tree.delete();
      }
    } catch (error) {
      if (error instanceof Aborted) {
        // The text fails, and a new parser, with new scanners, takes the next.
        countAbort();
        this.#parser.delete();
        this.#parser = new Parser();
      } else {
        // Any other failure can leave WebAssembly's memory broken, so nothing more runs in it.
        this.#failed = true;
      }
      return { skipped: 'failed' };
    }
  }

  /** `name`'s grammar and compiled query, loaded the first time they're asked for. */
  #load(name: TaggedLanguage): Promise<Compiled> {
    let compiled = this.#compiled.get(name);
    if (!compiled) {
      compiled = this.#compile(name);
      this.#compiled.set(name, compiled);
    }
    return compiled;
  }

  async #compile(name: TaggedLanguage): Promise<Compiled> {
    const { grammar } = languages[name];
    let loaded = this.#grammars.get(grammar);
    if (!loaded) {
      loaded = this.#loader.grammar(grammar).then((wasm) => Language.load(wasm));
      this.#grammars.set(grammar, loaded);
    }
    const [language, ...parts] = await Promise.all([
      loaded,
      ...tagQueries[name].map(([folder, kind]) => this.#loader.query(folder, kind)),
    ]);
    const missing = tagQueries[name].find((_, index) => parts[index] === undefined);
    if (missing) throw new Error(`${name} has no ${missing[1]} query in ${missing[0]}.`);
    const query = new Query(language, parts.join('\n'));
    const roles = new Map(query.captureNames.map((capture) => [capture, roleOf(capture)]));
    return { language, query, roles };
  }
}

/** Whether a line of `text` is longer than `limit`. */
function hasLongLine(text: string, limit: number): boolean {
  if (text.length <= limit) return false;
  let lineStart = 0;
  for (;;) {
    const end = text.indexOf('\n', lineStart);
    if ((end === -1 ? text.length : end) - lineStart > limit) return true;
    if (end === -1) return false;
    lineStart = end + 1;
  }
}

/**
 * Runs `compiled`'s query over the tree, a step at a time, and puts its tags together: each name
 * tagged once, in the order the names appear. Where patterns tag a name both ways, it's a
 * definition; otherwise the earliest pattern's tag wins, so the grammar's own win over Lo's, and
 * an `@ignore` keeps later patterns from using the name.
 */
function collect(
  language: TaggedLanguage,
  compiled: Compiled,
  root: Node,
  text: string,
  progressCallback: () => boolean,
  stopped: () => Skip | undefined,
): Read {
  const found: Tag[] = [];
  const statements: Node[] = [];
  const { startIndex: from, endIndex: to } = root;
  for (let start = from; start < to && !progressCallback(); start += queryStep) {
    const end = Math.min(start + queryStep, to);
    const matches = compiled.query.matches(root, {
      startIndex: start,
      endIndex: end,
      maxStartDepth,
      progressCallback,
    });
    for (const match of matches) {
      // A match that spans steps is taken in the step its name, or its statement, starts in.
      const tag = tagOf(match.captures, match.patternIndex, compiled.roles, text);
      if (tag && tag.from >= start && tag.from < end) found.push(tag);
      for (const { name, node } of match.captures) {
        if (compiled.roles.get(name)?.kind !== 'import' || statements.length >= maxImports)
          continue;
        if (node.startIndex >= start && node.startIndex < end) statements.push(node);
      }
    }
    // Before duplicates are dropped, a name may have a tag from each of a few patterns.
    if (found.length > maxTags * 2) return { skipped: 'too-many' };
  }
  const halted = stopped();
  if (halted) return { skipped: halted };
  // Of the tags for one name, a definition wins over a use, and then the earliest pattern.
  found.sort(
    (a, b) =>
      a.from - b.from ||
      a.to - b.to ||
      Number(a.as === 'reference' || a.as === 'ignore') -
        Number(b.as === 'reference' || b.as === 'ignore') ||
      a.pattern - b.pattern,
  );
  const tags: Tag[] = [];
  for (const tag of found) {
    const last = tags.at(-1);
    if (last && last.from === tag.from && last.to === tag.to) continue;
    tags.push(tag);
  }
  if (tags.length > maxTags) return { skipped: 'too-many' };
  return { tags, imports: importsOf(language, uniqueStatements(statements), text) };
}

/** The statements, each once, in the order they start. */
function uniqueStatements(statements: readonly Node[]): Node[] {
  const sorted = statements.toSorted(
    (a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex,
  );
  return sorted.filter(
    (node, index) => index === 0 || node.startIndex !== sorted[index - 1]!.startIndex,
  );
}

/**
 * The tag a match makes, if any: its `@name` with its `@definition.…` or `@reference.…`, or an
 * `@ignore`d name. Names that are too long, run over lines, hold a space or a syntax error, or
 * are empty make none.
 */
function tagOf(
  captures: readonly QueryCapture[],
  pattern: number,
  roles: Map<string, Role>,
  text: string,
): Tag | undefined {
  let name: Node | undefined;
  let tagged: Node | undefined;
  let as: Tag['as'] | undefined;
  let ignored = false;
  for (const capture of captures) {
    const role = roles.get(capture.name);
    switch (role?.kind) {
      case 'name':
        name = capture.node;
        break;
      case 'ignore':
        ignored = true;
        name = capture.node;
        break;
      case 'definition':
        tagged = capture.node;
        as = role.of;
        break;
      case 'reference':
        tagged = capture.node;
        as = 'reference';
        break;
      case 'import':
      case 'unused':
      case undefined:
        break;
      default:
        role satisfies never;
        break;
    }
  }
  if (!name) return undefined;
  if (!tagged || !as) {
    if (!ignored) return undefined;
    tagged = name;
    as = 'ignore';
  }
  const { startIndex: from, endIndex: to, startPosition } = name;
  if (to <= from || to - from > maxNameLength) return undefined;
  if (name.endPosition.row !== startPosition.row || name.hasError) return undefined;
  if (/\s/.test(text.slice(from, to))) return undefined;
  const { endPosition } = tagged;
  // A definition that ends at the start of a line, after its line break, ends on the line before.
  const lastRow =
    endPosition.column === 0 && endPosition.row > startPosition.row
      ? endPosition.row - 1
      : endPosition.row;
  return {
    from,
    to,
    pattern,
    line: startPosition.row + 1,
    column: startPosition.column,
    as,
    start: Math.min(tagged.startIndex, from),
    end: Math.max(tagged.endIndex, to),
    lastLine: Math.max(lastRow, startPosition.row) + 1,
  };
}

/**
 * Each definition's parent: the innermost other definition whose range holds it. Definitions are
 * syntax nodes, so any two are nested or apart, and walking them by where they start, outermost
 * first, keeps a stack of those still open, each inside the one below it. Definitions can share a
 * range, as Go's `const a, b = 1, 2` does, and none of those is another's parent.
 */
export function parentsOf(
  definitions: readonly { start: number; end: number }[],
): (number | undefined)[] {
  const order = definitions
    .map((_, index) => index)
    .toSorted(
      (a, b) =>
        definitions[a]!.start - definitions[b]!.start || definitions[b]!.end - definitions[a]!.end,
    );
  const parents: (number | undefined)[] = Array.from({ length: definitions.length });
  const open: number[] = [];
  for (const index of order) {
    const { start, end } = definitions[index]!;
    while (open.length > 0 && definitions[open.at(-1)!]!.end < end) open.pop();
    // Of those open with the same range, only the last stays open, so this looks past one at most.
    const parent = open.findLast(
      (candidate) => definitions[candidate]!.start !== start || definitions[candidate]!.end !== end,
    );
    parents[index] = parent;
    const top = open.at(-1);
    if (top !== undefined && definitions[top]!.start === start && definitions[top]!.end === end) {
      open.pop();
    }
    open.push(index);
  }
  return parents;
}
