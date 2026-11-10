// Highlighting: a file's text in, its tokens out as a `Uint32Array` of `[from, to, token]` triples,
// in order and never overlapping, with offsets in UTF-16 code units as CodeMirror counts them.
// It runs on worker threads in the background process, which hold the grammars and the compiled
// queries, and sends the triples to the window, where only the visible part is decorated.

import { Language, Parser, Query, type Node, type Range, type Tree } from 'web-tree-sitter';

import { languageNamed, languageNames, languages, type LanguageName } from './languages.ts';
import { tokenOf } from './tokens.ts';

/** Where a highlighter gets its grammars and queries from. */
export interface Loader {
  /** A grammar's WebAssembly, by its name in `grammars.json`. */
  grammar(name: string): Promise<Uint8Array>;
  /** One of a language's queries, or `undefined` when it has none. */
  query(language: LanguageName, kind: 'highlights' | 'injections'): Promise<string | undefined>;
}

export interface HighlightOptions {
  /** How long parsing and querying may take, in milliseconds, before giving up. */
  timeout?: number;
  /** The longest text to highlight, in UTF-16 code units. A longer file isn't parsed at all. */
  maxLength?: number;
  /** The deepest nesting to highlight. A file nested deeper isn't parsed at all. */
  maxDepth?: number;
}

export type Highlight =
  | { tokens: Uint32Array }
  /**
   * Not highlighted: too long or nested too deeply to parse safely, out of time, or failed, after
   * which the highlighter can't be used again.
   */
  | { skipped: 'too-long' | 'too-deep' | 'timed-out' | 'failed' };

/** Two seconds: enough for a 50,000-line file. */
export const defaultTimeout = 2000;

/**
 * Three million UTF-16 code units: room for TypeScript's 2.84-million-character `checker.ts`, which
 * takes half a second and 55 MB of WebAssembly memory to highlight. Dense JSON of 3.4 million took
 * 1.2 seconds and 200 MB.
 */
export const defaultMaxLength = 3_000_000;

/**
 * A hundred levels of brackets, Markdown quotes, or YAML and Markdown indentation. Code rarely goes
 * past twenty. Deeper, each step of a query takes longer, YAML's scanner outgrows the state it can
 * save, and nested Markdown quotes take gigabytes to parse.
 */
export const defaultMaxDepth = 100;

/** WebAssembly memory past which a highlighter should be replaced: it never shrinks. */
export const memoryCeiling = 256 * 1024 * 1024;

/** The part of WebAssembly's API this needs, which the background process's types leave out. */
declare const WebAssembly: {
  Memory: new (descriptor: { initial: number; maximum: number }) => {
    readonly buffer: ArrayBuffer;
  };
};

/**
 * The one WebAssembly memory every highlighter in this thread parses in, capped at 512 MB, so a
 * parse that runs away fails instead of taking the machine's memory.
 */
const memory = new WebAssembly.Memory({ initial: 512, maximum: 8192 });

let initialized: Promise<void> | undefined;

/** How deep injections nest: Markdown's inline text, and the code in Markdown's code blocks. */
const maxInjectionDepth = 3;

/** How much text one step of a query covers, between checks of the deadline. */
const queryStep = 1 << 16;

interface Compiled {
  language: Language;
  highlights: Query;
  injections: Query | undefined;
}

/** A capture with a token, as offsets. Higher priorities win between equal ranges. */
interface Capture {
  from: number;
  to: number;
  token: number;
  priority: number;
}

/**
 * Highlights text in every language in `languages`. Make one per worker thread. WebAssembly
 * memory is the thread's, so once a highlighter has failed, or its memory has grown past
 * `memoryCeiling`, it says it isn't `usable`, and its thread should be replaced.
 */
export class Highlighter {
  readonly #parser: Parser;
  readonly #compiled: ReadonlyMap<LanguageName, Compiled>;
  #failed = false;

  private constructor(parser: Parser, compiled: ReadonlyMap<LanguageName, Compiled>) {
    this.#parser = parser;
    this.#compiled = compiled;
  }

  /** Loads every grammar and compiles every query. A query that doesn't compile fails. */
  static async create(loader: Loader): Promise<Highlighter> {
    initialized ??= Parser.init({ wasmMemory: memory });
    await initialized;
    const grammars = new Map<string, Language>();
    const compiled = new Map<LanguageName, Compiled>();
    for (const name of languageNames) {
      const { grammar } = languages[name];
      let language = grammars.get(grammar);
      if (!language) {
        language = await Language.load(await loader.grammar(grammar));
        grammars.set(grammar, language);
      }
      const highlights = await loader.query(name, 'highlights');
      if (highlights === undefined) throw new Error(`${name} has no highlights query.`);
      const injections = await loader.query(name, 'injections');
      compiled.set(name, {
        language,
        highlights: new Query(language, highlights),
        injections: injections === undefined ? undefined : injectionQuery(language, injections),
      });
    }
    return new Highlighter(new Parser(), compiled);
  }

  /** How many bytes of WebAssembly memory the thread's highlighters hold. */
  get memory(): number {
    return memory.buffer.byteLength;
  }

  /** Whether the highlighter can go on: it hasn't failed, and its memory is under the ceiling. */
  get usable(): boolean {
    return !this.#failed && this.memory <= memoryCeiling;
  }

  /** Highlights `text` as `language`. */
  highlight(language: LanguageName, text: string, options: HighlightOptions = {}): Highlight {
    if (this.#failed) return { skipped: 'failed' };
    if (text.length > (options.maxLength ?? defaultMaxLength)) return { skipped: 'too-long' };
    const shape = {
      quotes: language === 'markdown',
      indents: language === 'markdown' || language === 'yaml',
    };
    if (nestingDepth(text, shape) > (options.maxDepth ?? defaultMaxDepth)) {
      return { skipped: 'too-deep' };
    }
    const deadline = performance.now() + (options.timeout ?? defaultTimeout);
    let timedOut = false;
    // Parsing and querying both stop when this returns true.
    const progressCallback = (): boolean => (timedOut ||= performance.now() > deadline);
    const captures: Capture[] = [];
    try {
      this.#collect(language, text, [], 0, progressCallback, captures);
    } catch {
      // A failure in WebAssembly can leave its memory broken, so nothing more runs in it.
      this.#failed = true;
      return { skipped: 'failed' };
    }
    if (timedOut) return { skipped: 'timed-out' };
    return { tokens: resolve(captures) };
  }

  /** Adds the captures of `language` over `ranges` of `text`, or all of it, and its injections'. */
  #collect(
    name: LanguageName,
    text: string,
    ranges: Range[],
    depth: number,
    progressCallback: () => boolean,
    out: Capture[],
  ): void {
    const compiled = this.#compiled.get(name);
    if (!compiled) return;
    this.#parser.setLanguage(compiled.language);
    let tree: Tree | null;
    try {
      tree = this.#parser.parse(text, null, { includedRanges: ranges, progressCallback });
    } finally {
      this.#parser.reset();
    }
    if (!tree) return;
    try {
      const options = { progressCallback };
      // Injected text wins over the text it sits in, deeper injections over shallower ones.
      const base = depth * 1_000_000;
      const { startIndex: from, endIndex: to } = tree.rootNode;
      // A step at a time, checking the deadline between steps. A node that spans steps is taken
      // in the step it starts in.
      for (let start = from; start < to && !progressCallback(); start += queryStep) {
        const end = Math.min(start + queryStep, to);
        const step = { ...options, startIndex: start, endIndex: end };
        for (const capture of compiled.highlights.captures(tree.rootNode, step)) {
          const token = tokenOf(capture.name);
          const { startIndex, endIndex } = capture.node;
          if (startIndex < start && start > from) continue;
          if (token !== undefined && endIndex > startIndex) {
            out.push({
              from: startIndex,
              to: endIndex,
              token,
              priority: base + capture.patternIndex,
            });
          }
        }
      }
      if (!compiled.injections || depth + 1 >= maxInjectionDepth || progressCallback()) return;
      for (const [language, injected] of injectionsOf(
        compiled.injections,
        tree.rootNode,
        options,
      )) {
        this.#collect(language, text, injected, depth + 1, progressCallback, out);
      }
    } finally {
      tree.delete();
    }
  }
}

/**
 * How deeply `text` nests: its deepest brackets, and with `shape`, its deepest run of Markdown
 * quotes or indentation, in levels of two spaces, at the start of a line.
 */
export function nestingDepth(text: string, shape: { quotes: boolean; indents: boolean }): number {
  let deepest = 0;
  let brackets = 0;
  let lineStart = true;
  let indent = 0;
  let quotes = 0;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (code === 10) {
      lineStart = true;
      indent = 0;
      quotes = 0;
      continue;
    }
    if (lineStart) {
      if (code === 32 || code === 9) {
        indent += code === 9 ? 4 : 1;
        continue;
      }
      if (code === 62 && shape.quotes) {
        quotes++;
        continue;
      }
      lineStart = false;
      deepest = Math.max(deepest, quotes, shape.indents ? indent >> 1 : 0);
    }
    if (code === 40 || code === 91 || code === 123) {
      brackets++;
      if (brackets > deepest) deepest = brackets;
    } else if ((code === 41 || code === 93 || code === 125) && brackets > 0) {
      brackets--;
    }
  }
  return deepest;
}

/**
 * An injections query, without the patterns that inject languages Lo doesn't highlight. Running
 * those, such as the ones for every comment, took longer than highlighting.
 */
function injectionQuery(language: Language, source: string): Query {
  const query = new Query(language, source);
  for (let pattern = 0; pattern < query.patternCount(); pattern++) {
    const named = query.setProperties[pattern]?.['injection.language'];
    if (named !== undefined && (named === null || !languageNamed(named))) {
      query.disablePattern(pattern);
    }
  }
  return query;
}

/**
 * The text `injections` finds in a tree, as the ranges to parse with each language, one entry for
 * each parse. Languages Lo doesn't highlight are left out.
 */
function injectionsOf(
  injections: Query,
  root: Node,
  options: { progressCallback: () => boolean },
): [LanguageName, Range[]][] {
  const separate: [LanguageName, Range[]][] = [];
  // Combined injections parse all their ranges together, one parse per pattern and language.
  const combined = new Map<string, [LanguageName, Range[]]>();
  for (const match of injections.matches(root, options)) {
    let named = match.setProperties?.['injection.language'] ?? undefined;
    const ranges: Range[] = [];
    for (const { name, node } of match.captures) {
      if (name === 'injection.language') named = node.text;
      else if (name === 'injection.content' && node.endIndex > node.startIndex) {
        ranges.push({
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        });
      }
    }
    const language = named ? languageNamed(named) : undefined;
    if (!language || ranges.length === 0) continue;
    if (match.setProperties && 'injection.combined' in match.setProperties) {
      const key = `${match.patternIndex} ${language}`;
      const entry = combined.get(key) ?? [language, []];
      entry[1].push(...ranges);
      combined.set(key, entry);
    } else {
      separate.push([language, ranges]);
    }
  }
  for (const entry of combined.values()) entry[1].sort((a, b) => a.startIndex - b.startIndex);
  return [...separate, ...combined.values()];
}

/**
 * The captures as triples that never overlap. Where captures nest, the innermost wins; between
 * equal ranges, the higher priority, which is the later pattern in a query, as Zed's queries are
 * written. Neighbors with the same token are joined.
 */
export function resolve(captures: Capture[]): Uint32Array {
  captures.sort((a, b) => a.from - b.from || b.to - a.to || a.priority - b.priority);
  const out: number[] = [];
  const emit = (from: number, to: number, token: number): void => {
    const last = out.length - 3;
    if (last >= 0 && out[last + 1] === from && out[last + 2] === token) out[last + 1] = to;
    else out.push(from, to, token);
  };
  const stack: Capture[] = [];
  let at = 0;
  // Emits up to `limit` from the captures open there, innermost first, closing those that end.
  const advance = (limit: number): void => {
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const end = Math.min(top.to, limit);
      if (end > at) {
        emit(at, end, top.token);
        at = end;
      }
      if (top.to > limit) break;
      stack.pop();
    }
    at = Math.max(at, limit);
  };
  for (const capture of captures) {
    advance(capture.from);
    stack.push(capture);
  }
  advance(Number.POSITIVE_INFINITY);
  return Uint32Array.from(out);
}
