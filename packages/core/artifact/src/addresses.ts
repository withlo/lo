/**
 * Links Markdown doesn't read, though they're meant for the format: `[the timer](term:wake timer)`.
 * A bare address ends at its first space, so Markdown makes no link of it, and Lo shows the text as
 * it's written. This reads the address as Markdown does, to tell such a link from a link Markdown
 * reads, and says how to write it instead.
 */

import { slug } from '@lo/markdown';

import { UNSAFE, quote } from './findings.ts';
import { LIMITS } from './limits.ts';
import { CODE, TERM } from './targets.ts';

/**
 * What stands for a token that isn't text, in the text a paragraph's tokens make: a control
 * character, which ends a bare address as a space does.
 */
export const OTHER = '\0';

/** The most characters of an address a fix repeats. */
const LONGEST = 200;

/** The kinds of address the format reads in a link, by how each is written. */
type Kind = 'code' | 'term' | 'section';

/**
 * What's wrong with the link whose label is in `text` from `open`, its `[`, to `close`, its `]`,
 * when it points where the format does, at code, a term or a section, and Markdown can't read its
 * address: the message for the finding. Undefined for a link Markdown reads, and for any other
 * address, which is Markdown's own to read. `text` has {@link OTHER} where a token that isn't text
 * is, and `\n` for a line break, and `(` follows `close`.
 */
export function unreadLink(text: string, open: number, close: number): string | undefined {
  let from = close + 2;
  while (text[from] === ' ' || text[from] === '\t' || text[from] === '\n') from += 1;
  const angle = text[from] === '<';
  const start = angle ? from + 1 : from;
  const kind = kindOf(text, start);
  if (kind === undefined || readable(text, from)) return undefined;

  const end = closing(text, start);
  const stop = end >= 0 ? end : unclosed(text, start);
  let address = text.slice(start, stop);
  if (angle) address = address.replace(/>\s*$/, '');
  const reason = reasonOf(address);
  const written = text.slice(open, end >= 0 ? end + 1 : stop);
  const shown = quote(written.replaceAll(OTHER, '').replaceAll(/[\t\n]/g, ' ')).trimEnd();
  return `${shown}${end >= 0 || shown.endsWith('…') ? '' : '…'} isn't a link, ${reason.cause}, so it shows as text. ${fix(kind, reason, end >= 0 ? address : undefined, labelOf(text, open, close))}`;
}

function kindOf(text: string, at: number): Kind | undefined {
  if (text.startsWith(CODE, at)) return 'code';
  if (text.startsWith(TERM, at)) return 'term';
  return text[at] === '#' ? 'section' : undefined;
}

/** Why an address that Markdown can't read can't be, as far as its text shows. */
interface Reason {
  cause: string;
  /** Whether it's written across lines. */
  lines: boolean;
}

function reasonOf(address: string): Reason {
  if (address.includes('\n')) return { cause: "a line break ends a link's address", lines: true };
  if (/[ \t]/.test(address)) return { cause: "a space ends a link's address", lines: false };
  return { cause: "Markdown can't read its address", lines: false };
}

/**
 * How to write the link instead: `address`, the whole of it as written, when it's known, or the
 * form to use when it isn't.
 */
function fix(kind: Kind, reason: Reason, address: string | undefined, label: string): string {
  const written = address === undefined ? undefined : oneLine(address);
  if (kind === 'section') {
    const anchor = written === undefined ? '' : slug(written.slice(1).trim());
    const example = anchor === '' ? 'how-it-works' : anchor;
    return `A heading's anchor is its text in lower case, with - for spaces: [${label}](#${example}).`;
  }
  const lead = reason.lines
    ? 'Write the address on one line, in angle brackets'
    : 'Put the address in angle brackets';
  if (
    written === undefined ||
    written.length > LONGEST ||
    UNSAFE.test(written) ||
    /[<>]/.test(written)
  ) {
    const example = kind === 'term' ? 'term:two words' : 'code:docs/read me.md';
    return `${lead}, such as [${label}](<${example}>).`;
  }
  return `${lead}: [${label}](<${written}>).`;
}

/** `address` on one line: each line break, and the space around it, as one space. */
function oneLine(address: string): string {
  return address
    .trim()
    .replaceAll(/[ \t]*\n[ \t]*/g, ' ')
    .replaceAll('\t', ' ');
}

/** The label of the link, as plain text, or `text` when it holds more than that. */
function labelOf(text: string, open: number, close: number): string {
  const label = text.slice(open + 1, close).replaceAll('\n', ' ');
  return label.length > 40 || label.includes(OTHER) || UNSAFE.test(label) ? 'text' : label;
}

/**
 * Whether Markdown reads the link whose address is at `from`: a destination, then perhaps a title,
 * then `)`, as markdown-it reads one. A link it reads is made, so one that's here, in the text, is
 * either unread or inside another link, whose label can't hold one.
 */
function readable(text: string, from: number): boolean {
  const end = destination(text, from);
  if (end < 0) return false;
  let at = skipSpace(text, end);
  if (text[at] === ')') return true;
  // A title needs a space before it.
  if (at === end) return false;
  const titled = title(text, at);
  if (titled < 0) return false;
  at = skipSpace(text, titled);
  return text[at] === ')';
}

function skipSpace(text: string, from: number): number {
  let at = from;
  while (text[at] === ' ' || text[at] === '\t' || text[at] === '\n') at += 1;
  return at;
}

/**
 * Where the destination at `from` ends, or -1 when there isn't one: in `<` and `>` on one line, or
 * bare, up to a space or control character, with balanced parentheses.
 */
function destination(text: string, from: number): number {
  const length = text.length;
  if (text[from] === '<') {
    for (let at = from + 1; at < length; at++) {
      const char = text[at];
      if (char === '\n' || char === '<') return -1;
      if (char === '>') return at + 1;
      if (char === '\\' && at + 1 < length) at += 1;
    }
    return -1;
  }
  let level = 0;
  let at = from;
  while (at < length) {
    const code = text.charCodeAt(at);
    if (code <= 0x20 || code === 0x7f) break;
    if (code === 0x5c && at + 1 < length) {
      if (text[at + 1] === ' ') break;
      at += 2;
      continue;
    }
    if (code === 0x28) {
      level += 1;
      // As far as markdown-it nests them.
      if (level > 32) return -1;
    } else if (code === 0x29) {
      if (level === 0) break;
      level -= 1;
    }
    at += 1;
  }
  return at === from || level !== 0 ? -1 : at;
}

/** Where the title at `from` ends, in quotes or parentheses, or -1 when there isn't one. */
function title(text: string, from: number): number {
  const opener = text[from];
  const closer = opener === '(' ? ')' : opener;
  if (opener !== '"' && opener !== "'" && opener !== '(') return -1;
  for (let at = from + 1; at < text.length; at++) {
    const char = text[at];
    if (char === closer) return at + 1;
    if (char === '(' && opener === '(') return -1;
    if (char === '\\' && at + 1 < text.length) at += 1;
  }
  return -1;
}

/**
 * The index of the `)` that closes the link whose address starts at `start`, when it's in the same
 * text and within the longest a link's address may be: the first with no `(` open before it.
 */
function closing(text: string, start: number): number {
  const last = Math.min(text.length, start + LIMITS.argument + 2);
  let level = 0;
  for (let at = start; at < last; at++) {
    const char = text[at];
    if (char === OTHER) return -1;
    if (char === '\\') at += 1;
    else if (char === '(') level += 1;
    else if (char === ')') {
      if (level === 0) return at;
      level -= 1;
    }
  }
  return -1;
}

/** Where what's known of an address that isn't closed ends: at a token that isn't text, or its limit. */
function unclosed(text: string, start: number): number {
  const last = Math.min(text.length, start + LIMITS.argument + 2);
  let at = start;
  while (at < last && text[at] !== OTHER) at += 1;
  return at;
}
