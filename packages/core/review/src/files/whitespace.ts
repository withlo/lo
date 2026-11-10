/** A file's diff with changes to whitespace alone hidden, as `git diff -w` shows it. */

import { diffLines } from './diff.ts';

/**
 * `base` with each line whose change was only to whitespace replaced by `head`'s line: compared
 * with `head`, only changes to more than whitespace remain. Whitespace is what git and GitHub
 * ignore: spaces, tabs, carriage returns and line feeds, never other Unicode spaces, which can
 * change what code means. Lines keep their places and their own line endings, so line numbers stay
 * `base`'s, and lines that changed in more than whitespace keep `base`'s text.
 */
export function withoutWhitespaceChanges(base: string, head: string): string {
  const baseLines = linesOf(base);
  const headLines = linesOf(head);
  const hunks = diffLines(baseLines.map(withoutWhitespace), headLines.map(withoutWhitespace));

  const text: string[] = [];
  let atBase = 0;
  let atHead = 0;
  // A matched line is the head's, ended as the base's was, so a head without a final newline never
  // joins two base lines, nor a base without one gains a row.
  const matched = (to: number): void => {
    for (; atBase < to; atBase++, atHead++) {
      const line = headLines[atHead] ?? '';
      text.push(line.endsWith('\n') ? line.slice(0, -1) : line);
      if (baseLines[atBase]?.endsWith('\n')) text.push('\n');
    }
  };
  for (const { before, after } of hunks) {
    matched(before.start);
    text.push(...baseLines.slice(before.start, before.end));
    atBase = before.end;
    atHead = after.end;
  }
  matched(baseLines.length);
  return text.join('');
}

/** The text's lines, each with its line feed if it has one. */
function linesOf(text: string): string[] {
  const lines: string[] = [];
  for (let start = 0; start < text.length;) {
    const end = text.indexOf('\n', start);
    const next = end < 0 ? text.length : end + 1;
    lines.push(text.slice(start, next));
    start = next;
  }
  return lines;
}

function withoutWhitespace(line: string): string {
  return line.replaceAll(/[ \t\r\n]/g, '');
}
