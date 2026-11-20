// The one line of a release's notes Lo shows with its offer: the first line of text, as plain text,
// cut to the contract's limit. GitHub's releases feed holds the notes as HTML, and a release's
// `latest-*.yml` may hold them as text; Lo never renders either, so tags go and the entities HTML
// writes are read back as the characters they stand for. Nothing here calls Electron, so it runs
// under unit tests.

import { characters, LINE_LIMIT } from '../contract.ts';

/** The most of the notes Lo reads to find their first line. */
const READ_LIMIT = 64 * 1024;

/** Tags that end a line of text where they stand. */
const BREAKS =
  /<\/?(?:address|article|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|ol|p|pre|section|summary|table|td|th|tr|ul)\b[^>]*>/gi;

/** The entities HTML names that the notes are likely to hold. Others stay as they are. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** The character a numbered entity stands for, or the entity as it was for one that's no character. */
function numbered(entity: string, code: number): string {
  return Number.isInteger(code) &&
    code > 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : entity;
}

/** `html`'s text: its tags gone, a line break where a block ends, and its entities read. */
function textOf(html: string): string {
  return html
    .replace(BREAKS, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (entity, decimal, hex, name) => {
      if (typeof decimal === 'string') return numbered(entity, Number.parseInt(decimal, 10));
      if (typeof hex === 'string') return numbered(entity, Number.parseInt(hex, 16));
      return NAMED[String(name).toLowerCase()] ?? entity;
    });
}

/**
 * Controls, and the characters that turn the direction of the text after them around until they're
 * closed (embeddings, overrides and isolates), as Lo takes them out of what others write. The marks
 * right-to-left text places numbers with, and the joiners emoji are made of, stay.
 */
const UNSEEN = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

/** `text` cut to {@link LINE_LIMIT} characters as a person counts them, ending in `…` if cut. */
export function cut(text: string): string {
  if (characters(text) <= LINE_LIMIT) return text;
  const kept = [...new Intl.Segmenter().segment(text)].slice(0, LINE_LIMIT - 1);
  return `${kept
    .map(({ segment }) => segment)
    .join('')
    .trimEnd()}…`;
}

/** The notes' text: the latest release's, when electron-updater gives notes for several. */
function notesOf(notes: unknown): string {
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    const [latest]: unknown[] = notes;
    if (typeof latest === 'object' && latest !== null && 'note' in latest) {
      return typeof latest.note === 'string' ? latest.note : '';
    }
  }
  return '';
}

/**
 * The first line of a release's notes, as electron-updater gives them (text or HTML, or a list of
 * them, newest first), as plain text cut to {@link LINE_LIMIT} characters: empty for notes with
 * no text. A Markdown heading's or list item's mark goes too.
 */
export function firstLine(notes: unknown): string {
  const text = textOf(notesOf(notes).slice(0, READ_LIMIT));
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw
      .replace(/\s+/g, ' ')
      .replace(UNSEEN, '')
      .trim()
      .replace(/^(?:#{1,6}|[-*+>])\s+/, '');
    if (line !== '') return cut(line);
  }
  return '';
}
