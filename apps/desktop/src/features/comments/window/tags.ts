// Whether a post's Markdown holds an HTML tag, which Lo's own reading of the Markdown shows as
// written, `<picture>` and all, and only GitHub's rendering draws: such a post waits for that
// rendering rather than show its source. A tag is `<` then a letter, `/` or `!`, outside code,
// which GitHub shows as written too. Where it can't tell code for sure, it reads text, so a tag a
// post holds is never missed: at worst a post waits for GitHub's rendering that needn't have.

/** Where an HTML tag, a closing tag or a comment starts. */
const TAG = /<[a-z/!]/i;

/**
 * A line that opens or closes a fenced code block: its quote markers, its indent (three spaces at
 * most), the fence, and what follows it.
 */
const FENCE = /^((?:[ \t]{0,3}>)*)( {0,3})(`{3,}|~{3,})(.*)$/;

/** A line's quote markers, then the rest of it. */
const QUOTED = /^((?:[ \t]{0,3}>)*)(.*)$/;

/** A run of backticks, which opens or closes a code span. */
const TICKS = /`+/g;

/** Whether `markdown` holds an HTML tag outside its code. */
export function holdsTag(markdown: string): boolean {
  return TAG.test(markdown) && TAG.test(outsideCode(markdown));
}

/** An opening fence: a fenced code block starts at it, if a closing fence comes. */
interface Fence {
  /** How many quote markers each of its lines has. */
  readonly quotes: number;
  /** How far its fence was indented, which each of its lines is, at least. */
  readonly indent: number;
  /** Its fence: a run of backticks or of tildes. */
  readonly fence: string;
}

function quotesIn(prefix: string): number {
  return prefix.split('>').length - 1;
}

/** The fence `line` opens, if it opens one: a backtick fence's words after it hold no backtick. */
function opens(line: string): Fence | undefined {
  const [, prefix = '', indent = '', fence = '', rest = ''] = FENCE.exec(line) ?? [];
  if (fence === '' || (fence.startsWith('`') && rest.includes('`'))) return undefined;
  return { quotes: quotesIn(prefix), indent: indent.length, fence };
}

/** Whether `line` closes `open`: a fence of its kind, as long or longer, and nothing after it. */
function closes(line: string, open: Fence): boolean {
  const [, prefix = '', , fence = '', rest = ''] = FENCE.exec(line) ?? [];
  return (
    quotesIn(prefix) === open.quotes &&
    fence[0] === open.fence[0] &&
    fence.length >= open.fence.length &&
    rest.trim() === ''
  );
}

/** Whether `line` is in `open`'s code: with its quote markers, and blank or indented as far as it. */
function within(line: string, open: Fence): boolean {
  const [, prefix = '', rest = ''] = QUOTED.exec(line) ?? [];
  const indent = rest.length - rest.trimStart().length;
  return quotesIn(prefix) === open.quotes && (rest.trim() === '' || indent >= open.indent);
}

/** How many lines, all fences' together, are read past an opening fence looking for its end. */
const LOOKING = 100_000;

/**
 * `markdown` without its code: each fenced code block whose closing fence comes with every line
 * before it in its code, and the code spans of each line. Anything else is read as text: a fence
 * with no end, or one that ends sooner than its closing fence, as a list it's in can, and a code
 * span across lines. Past {@link LOOKING} lines looked through, all of it is read as text.
 */
function outsideCode(markdown: string): string {
  const lines = markdown.split(/\r\n|\r|\n/);
  const kept: string[] = [];
  const looked = { lines: 0 };
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    const open = opens(line);
    const end = open ? endOf(lines, at, open, looked) : -1;
    if (end === undefined) return markdown;
    if (end === -1) kept.push(withoutSpans(line));
    else at = end;
  }
  return kept.join('\n');
}

/**
 * The line that closes `open`, opened on line `at` of `lines`, with every line before it in its
 * code; -1 for none; nothing once `looked` has passed {@link LOOKING} lines.
 */
function endOf(
  lines: readonly string[],
  at: number,
  open: Fence,
  looked: { lines: number },
): number | undefined {
  for (let next = at + 1; next < lines.length; next += 1) {
    looked.lines += 1;
    if (looked.lines > LOOKING) return undefined;
    const line = lines[next] ?? '';
    if (closes(line, open)) return next;
    if (!within(line, open)) return -1;
  }
  return -1;
}

/** Whether the character at `index` of `text` is escaped by a backslash. */
function escaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === '\\'; at -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** The index of the first run of `length` backticks in `runs` after the one at `at`, or -1. */
function closing(runs: readonly RegExpExecArray[], at: number, length: number): number {
  for (let index = at + 1; index < runs.length; index += 1) {
    if (runs[index]?.[0].length === length) return index;
  }
  return -1;
}

/**
 * `line` without its code spans: each from a run of backticks to the next run as long. An escaped
 * backtick opens none, but in a span a backslash is itself, so one before a run closes it all the
 * same.
 */
function withoutSpans(line: string): string {
  const runs = [...line.matchAll(TICKS)];
  let kept = '';
  let from = 0;
  for (let at = 0; at < runs.length; at += 1) {
    const open = runs[at];
    if (open === undefined || escaped(line, open.index)) continue;
    const end = closing(runs, at, open[0].length);
    const close = runs[end];
    if (close === undefined) continue;
    kept += line.slice(from, open.index);
    from = close.index + close[0].length;
    at = end;
  }
  return kept + line.slice(from);
}
