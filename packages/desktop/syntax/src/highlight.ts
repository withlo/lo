// Highlighting: a file's text in, its tokens out as a `Uint32Array` of `[from, to, token]` triples,
// in order and never overlapping, with offsets in UTF-16 code units as CodeMirror counts them.
// It runs on worker threads in the background process, which hold the grammars and the compiled
// queries, and sends the triples to the window, where only the visible part is decorated.

import { Language, Parser, Query, type Node, type Range } from 'web-tree-sitter';

import { languageNamed, languages, type LanguageName } from './languages.ts';
import {
  Aborted,
  breakRuntime,
  countAbort,
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

/**
 * A hundred levels of brackets, Markdown quotes, or YAML and Markdown indentation. Code rarely goes
 * past twenty: the deepest of 9,714 published JavaScript files, a bundle, goes to 34. Deeper, each
 * step of a query takes longer, YAML's scanner outgrows the state it can save, and nested Markdown
 * quotes take gigabytes to parse.
 */
export const defaultMaxDepth = 100;

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

/** A grammar or query that didn't load, which fails the highlighter but leaves the memory whole. */
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
 * How a language writes what nests and what doesn't, as the depth guard reads it: the comments and
 * strings whose brackets it skips, and the nesting at the start of a line it counts.
 */
interface Lexis {
  /** Comments from `//` to the end of the line, and from `/*` to the next `*` and `/`. */
  slashComments?: boolean;
  /** Only the comments from `/*` to the next `*` and `/`, where `//` can start a URL. */
  blockComments?: boolean;
  /** Comments from a `#` at the start of a line or after a space to the end of the line. */
  hashComments?: boolean;
  /** Quotes whose strings end at the same quote or the line's end, with `\` escaping. */
  quotes?: readonly number[];
  /** Whether three of one of `quotes` start a string that runs over lines to the next three. */
  tripleQuotes?: boolean;
  /** A quote whose strings can run over lines, and whether `\` escapes in them. */
  longQuote?: { quote: number; escapes: boolean };
  /**
   * What starts code in the strings of `quotes`, such as Kotlin's `${`, ending with the bracket
   * whose match ends the code. The code nests a level inside its string, and can run over lines.
   */
  interpolation?: { opens: readonly string[]; quotes: readonly number[] };
  /** Regular expression literals, `/` starting one wherever it can't divide. */
  regexes?: boolean;
  /** Markdown's quotes, `>` at the start of a line. */
  blockQuotes?: boolean;
  /** Indentation that nests, in levels of two spaces. */
  indents?: boolean;
}

const [doubleQuote, singleQuote, backtick] = [34, 39, 96];
const javascript: Lexis = {
  slashComments: true,
  quotes: [doubleQuote, singleQuote],
  longQuote: { quote: backtick, escapes: true },
  interpolation: { opens: ['${'], quotes: [backtick] },
  regexes: true,
};
/** C's comments and quotes, with strings in three quotes over lines, as Java and Kotlin have. */
const cLike: Lexis = {
  slashComments: true,
  quotes: [doubleQuote, singleQuote],
  tripleQuotes: true,
};
/** Comments from `#`, and both quotes, alone or in threes, as Python, Elixir and TOML have. */
const hashed: Lexis = {
  hashComments: true,
  quotes: [doubleQuote, singleQuote],
  tripleQuotes: true,
};
const hcl: Lexis = {
  slashComments: true,
  hashComments: true,
  quotes: [doubleQuote],
  interpolation: { opens: ['${', '%{'], quotes: [doubleQuote] },
};
const lexes: Record<LanguageName, Lexis> = {
  bash: {
    hashComments: true,
    quotes: [doubleQuote, singleQuote],
    interpolation: { opens: ['$(', '${'], quotes: [doubleQuote] },
  },
  csharp: cLike,
  css: { blockComments: true, quotes: [doubleQuote, singleQuote] },
  elixir: { ...hashed, interpolation: { opens: ['#{'], quotes: [doubleQuote, singleQuote] } },
  go: {
    slashComments: true,
    quotes: [doubleQuote, singleQuote],
    longQuote: { quote: backtick, escapes: false },
  },
  hcl,
  html: { quotes: [doubleQuote] },
  java: cLike,
  javascript,
  json: { quotes: [doubleQuote] },
  jsonc: { slashComments: true, quotes: [doubleQuote] },
  kotlin: { ...cLike, interpolation: { opens: ['${'], quotes: [doubleQuote] } },
  markdown: { blockQuotes: true, indents: true },
  'markdown-inline': {},
  php: { slashComments: true, hashComments: true, quotes: [doubleQuote, singleQuote] },
  python: hashed,
  ruby: {
    hashComments: true,
    quotes: [doubleQuote, singleQuote],
    interpolation: { opens: ['#{'], quotes: [doubleQuote] },
  },
  // A `'` starts a lifetime as often as a character, so only `"` quotes, and its strings run over
  // lines.
  rust: { slashComments: true, longQuote: { quote: doubleQuote, escapes: true } },
  swift: {
    slashComments: true,
    quotes: [doubleQuote],
    tripleQuotes: true,
    interpolation: { opens: ['\\('], quotes: [doubleQuote] },
  },
  terraform: hcl,
  toml: hashed,
  tsx: javascript,
  typescript: javascript,
  yaml: { hashComments: true, quotes: [doubleQuote, singleQuote], indents: true },
};

/** The words after which a `/` starts a regular expression rather than dividing. */
const beforeRegex = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

/** Whether `code` is part of a name or a number. */
function isWord(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 36 ||
    code === 95 ||
    code > 127
  );
}

/** How a string ends: at its quote or the line's end, at three of its quote, or at its quote. */
type Form = 'line' | 'triple' | 'long';

/**
 * How deeply `text` nests as `language` writes it: its deepest brackets outside comments, strings
 * and regular expressions, with code interpolated into a string a level deeper than the string,
 * and where the language nests at the start of a line, its deepest run of Markdown quotes or of
 * indentation. It reads the text once without parsing it, so where it takes a division for a
 * regular expression or the other way round, it can be a level or two out.
 */
export function nestingDepth(text: string, language: LanguageName): number {
  const lexis = lexes[language];
  const [quote, otherQuote] = lexis.quotes ?? [];
  const opens = (lexis.interpolation?.opens ?? []).map(
    (open) => [open.charCodeAt(0), open] as const,
  );
  const length = text.length;
  let deepest = 0;
  let brackets = 0;
  // The strings whose interpolated code the text is in, innermost last, each with the brackets
  // open once the code's own had opened.
  const strings: { quote: number; form: Form; level: number }[] = [];
  /**
   * Reads a string from `from`, inside its quote, to its end: the index of its closing quote, the
   * last of three, or of the character before the line break that ends it. Or, where code is
   * interpolated into it first, the index of the bracket that starts the code, which it opens.
   */
  const stringEnd = (from: number, closing: number, form: Form): number => {
    const interpolates = lexis.interpolation?.quotes.includes(closing) === true;
    const escapes = form !== 'long' || lexis.longQuote?.escapes === true;
    for (let index = from; index < length; index++) {
      const char = text.charCodeAt(index);
      const opened = interpolates
        ? opens.find(([first, open]) => char === first && text.startsWith(open, index))
        : undefined;
      if (opened) {
        brackets++;
        if (brackets > deepest) deepest = brackets;
        strings.push({ quote: closing, form, level: brackets });
        return index + opened[1].length - 1;
      }
      if (char === 92 && escapes) index++;
      else if (char === closing) {
        if (form !== 'triple') return index;
        const next = text.charCodeAt(index + 1) === closing;
        if (next && text.charCodeAt(index + 2) === closing) return index + 2;
      } else if (char === 10 && form === 'line') return index - 1;
    }
    return length;
  };
  let lineStart = true;
  let indent = 0;
  let blockQuotes = 0;
  // In JavaScript, whether what came last can end an expression, so that a `/` after it divides.
  let operand = false;
  // The last character outside a comment or space.
  let previous = 0;
  for (let at = 0; at < length; at++) {
    const code = text.charCodeAt(at);
    if (code === 10) {
      lineStart = true;
      indent = 0;
      blockQuotes = 0;
      continue;
    }
    if (lineStart) {
      if (code === 32 || code === 9) {
        indent += code === 9 ? 4 : 1;
        continue;
      }
      if (code === 62 && lexis.blockQuotes) {
        blockQuotes++;
        continue;
      }
      lineStart = false;
      deepest = Math.max(deepest, blockQuotes, lexis.indents ? indent >> 1 : 0);
    }
    if (code === 32 || code === 9 || code === 13) continue;
    if (code === 47 && (lexis.slashComments || lexis.blockComments)) {
      const next = text.charCodeAt(at + 1);
      if (next === 47 && lexis.slashComments) {
        at = lineEnd(text, at);
        continue;
      }
      if (next === 42) {
        const end = text.indexOf('*/', at + 2);
        at = end === -1 ? length : end + 1;
        continue;
      }
    }
    if (code === 35 && lexis.hashComments) {
      const before = text.charCodeAt(at - 1);
      if (at === 0 || before === 32 || before === 9 || before === 10) {
        at = lineEnd(text, at);
        continue;
      }
    }
    if (code === quote || code === otherQuote || code === lexis.longQuote?.quote) {
      // To the closing quote or the end of the line, to the next three of the quote over lines,
      // or to the closing long quote over lines, where `\` escapes; or into code inside it.
      const long = code === lexis.longQuote?.quote;
      const triple =
        !long &&
        lexis.tripleQuotes === true &&
        text.charCodeAt(at + 1) === code &&
        text.charCodeAt(at + 2) === code;
      at = stringEnd(at + (triple ? 3 : 1), code, long ? 'long' : triple ? 'triple' : 'line');
      operand = true;
      previous = code;
      continue;
    }
    if (lexis.regexes) {
      // A regular expression can start where an expression can, but `</` closes a JSX element.
      if (code === 47 && !operand && previous !== 60) {
        let inClass = false;
        for (at++; at < length; at++) {
          const inner = text.charCodeAt(at);
          if (inner === 92) at++;
          else if (inner === 91) inClass = true;
          else if (inner === 93) inClass = false;
          else if (inner === 47 && !inClass) break;
          else if (inner === 10) {
            at--;
            break;
          }
        }
        operand = true;
        previous = code;
        continue;
      }
      if (isWord(code)) {
        const start = at;
        while (at + 1 < length && isWord(text.charCodeAt(at + 1))) at++;
        operand = at - start > 9 || !beforeRegex.has(text.slice(start, at + 1));
        previous = code;
        continue;
      }
      operand = code === 41 || code === 93 || code === 125;
    }
    previous = code;
    if (code === 40 || code === 91 || code === 123) {
      brackets++;
      if (brackets > deepest) deepest = brackets;
    } else if ((code === 41 || code === 93 || code === 125) && brackets > 0) {
      const string = strings.at(-1);
      brackets--;
      if (string && brackets < string.level) {
        // The end of code interpolated into a string, which goes on.
        strings.pop();
        at = stringEnd(at + 1, string.quote, string.form);
        operand = true;
        previous = string.quote;
      }
    }
  }
  return deepest;
}

/** Where the line `at` is on ends: the index before its line break, or the text's last. */
function lineEnd(text: string, at: number): number {
  const end = text.indexOf('\n', at);
  return end === -1 ? text.length : end - 1;
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
