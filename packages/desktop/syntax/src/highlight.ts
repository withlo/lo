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
}

export type Highlight =
  | { tokens: Uint32Array }
  /** Not highlighted: too long to parse, or parsing ran out of time. */
  | { skipped: 'too-long' | 'timed-out' };

/** Two seconds: enough for a 50,000-line file. */
export const defaultTimeout = 2000;

/** About 4 million UTF-16 code units, some 4 MB of code. */
export const defaultMaxLength = 1 << 22;

let initialized: Promise<void> | undefined;

/** How deep injections nest: Markdown's inline text, and the code in Markdown's code blocks. */
const maxDepth = 3;

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

/** Highlights text in every language in `languages`. Make one per worker thread. */
export class Highlighter {
  readonly #parser: Parser;
  readonly #compiled: ReadonlyMap<LanguageName, Compiled>;

  private constructor(parser: Parser, compiled: ReadonlyMap<LanguageName, Compiled>) {
    this.#parser = parser;
    this.#compiled = compiled;
  }

  /** Loads every grammar and compiles every query. A query that doesn't compile fails. */
  static async create(loader: Loader): Promise<Highlighter> {
    initialized ??= Parser.init();
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

  /** Highlights `text` as `language`. */
  highlight(language: LanguageName, text: string, options: HighlightOptions = {}): Highlight {
    if (text.length > (options.maxLength ?? defaultMaxLength)) return { skipped: 'too-long' };
    const deadline = performance.now() + (options.timeout ?? defaultTimeout);
    let timedOut = false;
    // Parsing and querying both stop when this returns true.
    const progressCallback = (): boolean => (timedOut ||= performance.now() > deadline);
    const captures: Capture[] = [];
    this.#collect(language, text, [], 0, progressCallback, captures);
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
      for (const capture of compiled.highlights.captures(tree.rootNode, options)) {
        const token = tokenOf(capture.name);
        const { startIndex, endIndex } = capture.node;
        if (token !== undefined && endIndex > startIndex) {
          out.push({
            from: startIndex,
            to: endIndex,
            token,
            priority: base + capture.patternIndex,
          });
        }
      }
      if (!compiled.injections || depth + 1 >= maxDepth) return;
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
