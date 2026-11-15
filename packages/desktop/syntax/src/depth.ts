// The depth guard: how deeply a text nests, read without parsing it, so that a text nested too
// deeply to parse safely isn't parsed at all. Highlighting and tagging both guard with it.

import type { LanguageName } from './languages.ts';

/**
 * A hundred levels of brackets, Markdown quotes, or YAML and Markdown indentation. Code rarely goes
 * past twenty: the deepest of 9,714 published JavaScript files, a bundle, goes to 34. Deeper, each
 * step of a query takes longer, YAML's scanner outgrows the state it can save, and nested Markdown
 * quotes take gigabytes to parse.
 */
export const defaultMaxDepth = 100;

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
