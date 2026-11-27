// Whether a post's Markdown holds an HTML tag, which Lo's own reading of the Markdown shows as
// written, `<picture>` and all, and only GitHub's rendering draws: such a post waits for that
// rendering rather than show its source. A tag is `<` then a letter, `/`, `!` or `?`, outside code,
// which GitHub shows as written too. A whole HTML comment and an autolink aren't tags: Lo's reading
// of the Markdown drops the one and draws the other as a link. What it can't tell for sure is code,
// a comment or an autolink, it reads as text, so it would sooner hold a post that needn't wait
// than show a tag.

/** Where an HTML tag, a closing tag, a comment, a declaration or an instruction starts. */
const TAG = /<[a-z/!?]/i;

/**
 * An autolink to an address or a mail address, without a backtick or a pipe, which could end code
 * or a table's cell.
 */
const AUTOLINK =
  /<(?:[a-z][a-z\d+.-]{1,31}:[^\s<>`|]*|[\w.!#$%&'*+/=?^{}~-]+@[a-z\d][a-z\d.-]*)>/gi;

/** What a comment can't hold to be taken out: a backtick, a pipe or a tilde fence. */
const UNSURE = /[`|]|~~~/g;

/**
 * A line that opens a fenced code block: its quote markers, its indent (three spaces at most), the
 * fence, and what follows it.
 */
const FENCE = /^((?:[ \t]{0,3}>)*)( {0,3})(`{3,}|~{3,})(.*)$/;

/** A line that could close a fenced code block, however far it's indented. */
const CLOSE = /^((?:[ \t]{0,3}>)*)[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** A line's quote markers, then the rest of it. */
const QUOTED = /^((?:[ \t]{0,3}>)*)(.*)$/;

/** A run of backticks, which opens or closes a code span. */
const TICKS = /`+/g;

/**
 * How many steps, lines and characters looked through, a post's code is looked for in. Past them,
 * all of it is read as text.
 */
const LOOKING = 1_000_000;

/** What's left of {@link LOOKING} for one post. */
interface Budget {
  left: number;
}

/** Spends `steps` of `budget`: whether any is left. */
function spend(budget: Budget, steps = 1): boolean {
  budget.left -= steps;
  return budget.left >= 0;
}

/** Whether `markdown` holds an HTML tag outside its code. */
export function holdsTag(markdown: string): boolean {
  if (!TAG.test(markdown)) return false;
  const left = withoutComments(markdown).replaceAll(AUTOLINK, 'x');
  return TAG.test(left) && TAG.test(outsideCode(left));
}

/**
 * `text` without its whole HTML comments, each with a letter in its place, so what was either side
 * of it doesn't meet. One that holds a backtick, a pipe or a tilde fence, which could end code or a
 * table's cell or start a fence, stays.
 */
function withoutComments(text: string): string {
  let kept = '';
  let from = 0;
  let at = text.indexOf('<!--');
  while (at !== -1) {
    const end = text.indexOf('-->', at + 4);
    if (end === -1) break;
    // The last of what it can't hold: a comment opened after that, ending here, holds none.
    let unsure = -1;
    for (const found of text.slice(at + 4, end).matchAll(UNSURE)) unsure = at + 4 + found.index;
    if (unsure === -1) {
      kept += `${text.slice(from, at)}x`;
      from = end + 3;
      at = text.indexOf('<!--', from);
    } else {
      at = text.indexOf('<!--', unsure + 1);
    }
  }
  return kept + text.slice(from);
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

/**
 * Whether `line` closes `open`: a fence of its kind, as long or longer, and nothing after it. It's
 * taken as one however far it's indented, which may end a block sooner than it ends.
 */
function closes(line: string, open: Fence): boolean {
  const [, prefix = '', fence = ''] = CLOSE.exec(line) ?? [];
  return (
    quotesIn(prefix) === open.quotes &&
    fence[0] === open.fence[0] &&
    fence.length >= open.fence.length
  );
}

/** Whether `line` is in `open`'s code: with its quote markers, and blank or indented as far. */
function within(line: string, open: Fence): boolean {
  const [, prefix = '', rest = ''] = QUOTED.exec(line) ?? [];
  const indent = rest.length - rest.trimStart().length;
  return quotesIn(prefix) === open.quotes && (rest.trim() === '' || indent >= open.indent);
}

/**
 * `markdown` without its code: each fenced code block whose closing fence comes with every line
 * before it in its code, and the code spans of each line. Anything else is read as text: a fence
 * with no end, or one that ends sooner than its closing fence, as a list it's in can, and a code
 * span across lines. Past {@link LOOKING} steps, all of it is read as text.
 */
function outsideCode(markdown: string): string {
  const lines = markdown.split(/\r\n|\r|\n/);
  const kept: string[] = [];
  const budget = { left: LOOKING };
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    const open = opens(line);
    const end = open ? endOf(lines, at, open, budget) : -1;
    if (end === -1) kept.push(withoutSpans(line, budget));
    else at = end;
    if (budget.left < 0) return markdown;
  }
  return kept.join('\n');
}

/**
 * The line that closes `open`, opened on line `at` of `lines`, with every line before it in its
 * code, or -1.
 */
function endOf(lines: readonly string[], at: number, open: Fence, budget: Budget): number {
  for (let next = at + 1; next < lines.length && spend(budget); next += 1) {
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

/**
 * Where an inline link's address and title end, from `start`, just past its `](`: the index of
 * its `)`, or -1 where there's no address and title as Markdown reads them.
 */
function linkEnd(line: string, start: number, budget: Budget): number {
  let at = start;
  const step = () => {
    at += 1;
    return spend(budget);
  };
  const spaces = () => {
    while (line[at] === ' ' || line[at] === '\t') if (!step()) return;
  };
  /** Steps to the next `char` not escaped: whether it's there. */
  const past = (char: string) => {
    do if (!step()) return false;
    while (at < line.length && !(line[at] === char && !escaped(line, at)));
    return at < line.length;
  };
  spaces();
  if (line[at] === '<') {
    if (!past('>')) return -1;
    at += 1;
  } else {
    let depth = 0;
    while (at < line.length && !/\s/.test(line[at] ?? '')) {
      const char = line[at];
      if (char === '(' && !escaped(line, at)) depth += 1;
      if (char === ')' && !escaped(line, at)) {
        if (depth === 0) break;
        depth -= 1;
      }
      if (!step()) return -1;
    }
  }
  spaces();
  const quote = line[at];
  const ends = quote === '"' ? '"' : quote === "'" ? "'" : quote === '(' ? ')' : undefined;
  if (ends !== undefined) {
    if (!past(ends)) return -1;
    at += 1;
    spaces();
  }
  return line[at] === ')' ? at : -1;
}

/**
 * `line` cut where a code span can't run across: at each pipe, which a table cell ends at before
 * its code is read, and around each inline link's address and title, which a backtick in doesn't
 * open or close code. Cutting where it needn't only reads more as text.
 */
function pieces(line: string, budget: Budget): string[] {
  const cuts: number[] = [];
  for (let at = 0; at < line.length; at += 1) {
    if (line[at] === '|' && !escaped(line, at)) cuts.push(at);
    if (line[at] === ']' && line[at + 1] === '(' && !escaped(line, at)) {
      cuts.push(at + 1);
      const end = linkEnd(line, at + 2, budget);
      if (end !== -1) cuts.push(end);
    }
  }
  const all: string[] = [];
  let from = 0;
  for (const cut of cuts.toSorted((a, b) => a - b)) {
    all.push(line.slice(from, cut));
    from = cut + 1;
  }
  all.push(line.slice(from));
  return all;
}

/** A run of backticks: where it starts, and how long it is. */
interface Run {
  readonly index: number;
  readonly length: number;
}

/** The index of the first run in `runs` after the one at `at` that's `length` long, or -1. */
function closing(runs: readonly Run[], at: number, length: number, budget: Budget): number {
  for (let index = at + 1; index < runs.length && spend(budget); index += 1) {
    if (runs[index]?.length === length) return index;
  }
  return -1;
}

/** `line` without its code spans, each read in a piece of it that a span can't run out of. */
function withoutSpans(line: string, budget: Budget): string {
  return pieces(line, budget)
    .map((piece) => withoutSpansIn(piece, budget))
    .join(' ');
}

/**
 * `text` without its code spans: each from a run of backticks to the next run as long. A backslash
 * escapes a run's first backtick only, and the rest of it can open a span; in a span a backslash is
 * itself, so a run after one closes it all the same.
 */
function withoutSpansIn(text: string, budget: Budget): string {
  const runs: Run[] = [...text.matchAll(TICKS)].map((run) => ({
    index: run.index,
    length: run[0].length,
  }));
  let kept = '';
  let from = 0;
  for (let at = 0; at < runs.length; at += 1) {
    const run = runs[at];
    if (run === undefined) continue;
    const open = escaped(text, run.index) ? { index: run.index + 1, length: run.length - 1 } : run;
    if (open.length === 0) continue;
    const end = closing(runs, at, open.length, budget);
    const close = runs[end];
    if (close === undefined) continue;
    kept += text.slice(from, open.index);
    from = close.index + close.length;
    at = end;
  }
  return kept + text.slice(from);
}
