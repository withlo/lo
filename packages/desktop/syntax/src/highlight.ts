// Highlighting: a file's text in, its tokens out as a `Uint32Array` of `[from, to, token]` triples,
// in order and never overlapping, with offsets in UTF-16 code units as CodeMirror counts them.
// It runs on worker threads in the background process, which hold the grammars and the compiled
// queries, and sends the triples to the window, where only the visible part is decorated.

import { Language, Parser, Query, type Node, type Range } from 'web-tree-sitter';

import { defaultMaxDepth, nestingDepth } from './depth.ts';
import { languageNamed, languages, type LanguageName } from './languages.ts';
import {
  Aborted,
  breakRuntime,
  countAbort,
  isFault,
  memoryCeiling,
  memoryInUse,
  parseText,
  runtimeUsable,
  startTreeSitter,
} from './runtime.ts';
import { tokenOf } from './tokens.ts';

/**
 * A language's queries: the highlights and injections it's highlighted with, the tags of its
 * grammar's own and Lo's that find its definitions and references, and the patterns that find
 * its imports.
 */
export type QueryKind = 'highlights' | 'injections' | 'tags' | 'lo-tags' | 'imports';

/** Where a highlighter or a tagger gets its grammars and queries from. */
export interface Loader {
  /** A grammar's WebAssembly, by its name in `grammars.json`. */
  grammar(name: string): Promise<Uint8Array>;
  /** One of a language's queries, or `undefined` when it has none. */
  query(language: LanguageName, kind: QueryKind): Promise<string | undefined>;
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
   * Not highlighted: too long or nested too deeply to parse safely, out of time, out of memory
   * (the memory passed `memoryCeiling` as it parsed), or failed: a grammar's scanner aborted on
   * the text, or something else failed, or had before, and the highlighter isn't `usable`.
   */
  | { skipped: 'too-long' | 'too-deep' | 'timed-out' | 'out-of-memory' | 'failed' };

/** Two seconds: enough for a 50,000-line file. */
export const defaultTimeout = 2000;

/**
 * Eight million UTF-16 code units, more than twice the longest files in the pull requests the perf
 * app opens: Kubernetes's 3.27-million-character `swagger.json` and 3.17-million-character
 * generated OpenAPI Go, which take a quarter and half a second to highlight. The deadline and the
 * memory ceiling stop a long file that's slow to parse; this only saves starting on one longer than
 * any source file.
 */
export const defaultMaxLength = 8_000_000;

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

/** One call to `highlight`: what stops it, and how it loads a language it meets. */
interface Run {
  /** Whether to stop now: the deadline has passed, or the memory the ceiling. */
  progressCallback: () => boolean;
  /** A language's grammar and queries, with the time loading them took left off the deadline. */
  load: (language: LanguageName) => Promise<Compiled>;
}

/**
 * A grammar or query that didn't load, for a reason other than a fault: it isn't there, or doesn't
 * compile. It fails the highlighter, but leaves the memory whole.
 */
class NotLoaded extends Error {}

/**
 * Highlights text in every language in `languages`. Make one per worker thread, and highlight one
 * text at a time. A language's grammar loads and its queries compile the first time a text needs
 * them, so a job that meets one language loads one grammar. WebAssembly memory is the thread's,
 * so once a highlighter has failed, a fault in any of the thread's highlighters and taggers has
 * broken the memory, or the memory has grown past `memoryCeiling`, it says it isn't `usable`,
 * skips every text after as failed, and its thread should be replaced.
 */
export class Highlighter {
  #parser: Parser;
  readonly #loader: Loader;
  /** Each grammar once a language has needed it, by its name in `grammars.json`. */
  readonly #grammars = new Map<string, Promise<Language>>();
  /** Each language's grammar and queries once a text has needed them. */
  readonly #compiled = new Map<LanguageName, Promise<Compiled>>();
  /**
   * Whether a grammar or query didn't load, which stops this highlighter but leaves the memory
   * whole.
   */
  #failed = false;
  #loadMs = 0;

  private constructor(parser: Parser, loader: Loader) {
    this.#parser = parser;
    this.#loader = loader;
  }

  /** Starts tree-sitter in this thread. No grammar loads until a text needs it. */
  static async create(loader: Loader): Promise<Highlighter> {
    await startTreeSitter();
    return new Highlighter(new Parser(), loader);
  }

  /** How long the highlighter has spent loading grammars and compiling queries, in milliseconds. */
  get loadMs(): number {
    return this.#loadMs;
  }

  /** How many bytes of WebAssembly memory the thread's highlighters hold. */
  get memory(): number {
    return memoryInUse();
  }

  /**
   * Whether the highlighter can go on: it hasn't failed, and its thread can parse again: nothing
   * has broken its memory, its scanners haven't aborted too often, and the memory is under the
   * ceiling.
   */
  get usable(): boolean {
    return !this.#failed && runtimeUsable();
  }

  /**
   * Highlights `text` as `language`, loading its grammar, and those of the languages it injects,
   * the first time they're needed. A grammar or query that doesn't load fails the highlighter.
   */
  async highlight(
    language: LanguageName,
    text: string,
    options: HighlightOptions = {},
  ): Promise<Highlight> {
    if (!this.usable) return { skipped: 'failed' };
    if (text.length > (options.maxLength ?? defaultMaxLength)) return { skipped: 'too-long' };
    if (nestingDepth(text, language) > (options.maxDepth ?? defaultMaxDepth)) {
      return { skipped: 'too-deep' };
    }
    let deadline = performance.now() + (options.timeout ?? defaultTimeout);
    let stopped: 'timed-out' | 'out-of-memory' | undefined;
    const run: Run = {
      // Parsing, querying and every injection stop once this returns true.
      progressCallback: () => {
        if (stopped) return true;
        if (performance.now() > deadline) stopped = 'timed-out';
        else if (memoryInUse() > memoryCeiling) stopped = 'out-of-memory';
        return stopped !== undefined;
      },
      // Loading is the highlighter's own work, the same for any text, so it isn't the text's time.
      load: async (name) => {
        const started = performance.now();
        try {
          return await this.#load(name);
        } catch (error) {
          // A fault as the grammar loads breaks the memory, as one as it parses does.
          if (isFault(error)) throw error;
          throw new NotLoaded(`${name} didn't load.`, { cause: error });
        } finally {
          const elapsed = performance.now() - started;
          deadline += elapsed;
          this.#loadMs += elapsed;
        }
      },
    };
    const captures: Capture[] = [];
    try {
      await this.#collect(language, text, [], 0, run, captures);
    } catch (error) {
      if (error instanceof Aborted) {
        // The text fails, and a new parser, with new scanners, takes the next.
        countAbort();
        this.#parser.delete();
        this.#parser = new Parser();
      } else if (error instanceof NotLoaded) {
        this.#failed = true;
      } else {
        // Any other failure can leave WebAssembly's memory broken, so nothing more runs in it.
        breakRuntime();
      }
      return { skipped: 'failed' };
    }
    if (stopped) return { skipped: stopped };
    return { tokens: resolve(captures) };
  }

  /** `name`'s grammar and compiled queries, loaded the first time they're asked for. */
  #load(name: LanguageName): Promise<Compiled> {
    let compiled = this.#compiled.get(name);
    if (!compiled) {
      compiled = this.#compile(name);
      this.#compiled.set(name, compiled);
    }
    return compiled;
  }

  async #compile(name: LanguageName): Promise<Compiled> {
    const { grammar } = languages[name];
    let loaded = this.#grammars.get(grammar);
    if (!loaded) {
      loaded = this.#loader.grammar(grammar).then((wasm) => Language.load(wasm));
      this.#grammars.set(grammar, loaded);
    }
    const [language, highlights, injections] = await Promise.all([
      loaded,
      this.#loader.query(name, 'highlights'),
      this.#loader.query(name, 'injections'),
    ]);
    if (highlights === undefined) throw new Error(`${name} has no highlights query.`);
    return {
      language,
      highlights: new Query(language, highlights),
      injections: injections === undefined ? undefined : injectionQuery(language, injections),
    };
  }

  /** Adds the captures of `language` over `ranges` of `text`, or all of it, and its injections'. */
  async #collect(
    name: LanguageName,
    text: string,
    ranges: Range[],
    depth: number,
    run: Run,
    out: Capture[],
  ): Promise<void> {
    const { progressCallback } = run;
    // Past the deadline or the memory ceiling, nothing more is loaded or parsed: a parse checks
    // only every so often, and an injection can be too small to reach a check.
    if (progressCallback()) return;
    const compiled = await run.load(name);
    this.#parser.setLanguage(compiled.language);
    const tree = parseText(this.#parser, text, { includedRanges: ranges, progressCallback });
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
        if (progressCallback()) break;
        await this.#collect(language, text, injected, depth + 1, run, out);
      }
    } finally {
      tree.delete();
    }
  }
}

/**
 * What an injection's captures and properties are called, `injection.` and all, and the older
 * names without it that some queries still use (`@content`, `(#set! "language" "regex")`).
 */
const injection = {
  isLanguage: (name: string): boolean => name === 'injection.language' || name === 'language',
  isContent: (name: string): boolean => name === 'injection.content' || name === 'content',
  language: (properties: Record<string, string | null> | undefined): string | null | undefined =>
    properties && 'injection.language' in properties
      ? properties['injection.language']
      : properties?.['language'],
  combined: (properties: Record<string, string | null> | undefined): boolean =>
    properties !== undefined && ('injection.combined' in properties || 'combined' in properties),
};

/**
 * An injections query, without the patterns that inject languages Lo doesn't highlight. Running
 * those, such as the ones for every comment, took longer than highlighting.
 */
function injectionQuery(language: Language, source: string): Query {
  const query = new Query(language, source);
  for (let pattern = 0; pattern < query.patternCount(); pattern++) {
    const named = injection.language(query.setProperties[pattern]);
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
    let named = injection.language(match.setProperties) ?? undefined;
    const ranges: Range[] = [];
    for (const { name, node } of match.captures) {
      if (injection.isLanguage(name)) named = node.text;
      else if (injection.isContent(name) && node.endIndex > node.startIndex) {
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
    if (injection.combined(match.setProperties)) {
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
 * equal ranges, the higher priority, which is the later pattern in a query, as Lo's queries are
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
