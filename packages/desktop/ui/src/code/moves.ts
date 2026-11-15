// The two ends of moved code, line for line. Move detection (`@lo/diff`) pairs a block's lines one
// for one with blank lines left out, as lines trimmed of their whitespace, so either end can hold
// blank lines the other hasn't: a line's other end is the line as far into the other end's lines
// that aren't blank.

/** One end of a moved block: its file's lines on that side, and the block's first and last. */
export interface MovedLines {
  lines: readonly string[];
  first: number;
  last: number;
}

/**
 * The line at end `there` that line `line` of end `here` moved with: the line that isn't blank as
 * far into `there`, by its lines that aren't blank, as it is into `here`. A blank line goes with
 * the next line that isn't, or at the block's end the one before it. So every line that isn't
 * blank comes back to itself from its other end.
 */
export function otherLine(here: MovedLines, line: number, there: MovedLines): number {
  const blank = (end: MovedLines, number: number): boolean =>
    (end.lines[number - 1] ?? '').trim() === '';
  let at = Math.min(Math.max(line, here.first), here.last);
  while (at < here.last && blank(here, at)) at++;
  while (at > here.first && blank(here, at)) at--;
  let count = 0;
  for (let number = here.first; number <= at; number++) if (!blank(here, number)) count++;
  let seen = 0;
  for (let number = there.first; number <= there.last; number++) {
    if (!blank(there, number) && ++seen >= count) return number;
  }
  return there.last;
}
