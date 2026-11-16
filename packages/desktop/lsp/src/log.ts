/**
 * A server's log: what it writes to stderr, the messages it sends (`window/logMessage` and
 * `window/showMessage`), and what Lo notes about it, such as a request it refused or why it
 * stopped. Only the last {@link LOG_LINES} lines are kept, in memory, as plain text, and nothing is
 * written to disk.
 */

/** How many lines a server's log keeps. */
export const LOG_LINES = 1000;

/** The longest line kept, in characters. A longer one is cut, and says so. */
export const LINE_LENGTH = 2000;

/** A terminal's escape sequences, such as colors. */
const ESCAPES = /\p{Cc}\[[0-9;?]*[ -/]*[@-~]/gu;
/** Control characters other than a tab. */
const CONTROLS = /[\p{Cc}--[\t]]/gv;

const LF = 10;

/** `line` as plain text, at most {@link LINE_LENGTH} characters long. */
function plain(line: string): string {
  const text = line.replace(ESCAPES, '').replace(CONTROLS, '');
  return text.length > LINE_LENGTH ? `${text.slice(0, LINE_LENGTH)} … (cut)` : text;
}

export class Log {
  readonly #lines: string[] = [];
  /** What the stream has written since its last line ended. */
  #partial = '';

  /** The lines kept, oldest first. */
  get lines(): readonly string[] {
    return [...this.#lines];
  }

  /** Adds `text`, one line or several, as whole lines. */
  add(text: string): void {
    const whole = text.endsWith('\n') ? text : `${text}\n`;
    for (const line of lastLines(whole, lineEnds(whole))) this.#keep(line);
  }

  /** Adds what a stream wrote, holding a line back until it ends, and says how many lines it ended. */
  write(text: string): number {
    const ends = lineEnds(text);
    if (ends === 0) {
      this.#partial += text;
    } else {
      for (const line of lastLines(this.#partial + text, ends)) this.#keep(line);
      this.#partial = text.slice(text.lastIndexOf('\n') + 1);
    }
    // A line that never ends is kept in pieces, so the part held back stays small.
    while (this.#partial.length > LINE_LENGTH) {
      this.#keep(this.#partial.slice(0, LINE_LENGTH));
      this.#partial = this.#partial.slice(LINE_LENGTH);
    }
    return ends;
  }

  /** Ends the stream's last line, if it has one. */
  end(): void {
    if (this.#partial !== '') this.#keep(this.#partial);
    this.#partial = '';
  }

  #keep(line: string): void {
    this.#lines.push(plain(line));
    if (this.#lines.length > LOG_LINES) this.#lines.shift();
  }
}

/** How many lines `text` ends: its `\n`s. */
function lineEnds(text: string): number {
  let ends = 0;
  for (let at = 0; at < text.length; at += 1) if (text.charCodeAt(at) === LF) ends += 1;
  return ends;
}

/**
 * The lines `text` ends, `ends` of them, each with `\n` or `\r\n`, but only the last
 * {@link LOG_LINES}: those before them would leave the log at once, so they're never split or
 * cleaned. However many lines a server writes at once, they cost a pass over their characters.
 */
function lastLines(text: string, ends: number): string[] {
  const last = text.lastIndexOf('\n');
  // The end of the last line the log wouldn't keep.
  let before = -1;
  if (ends > LOG_LINES) {
    before = last;
    for (let line = 0; line < LOG_LINES; line += 1) before = text.lastIndexOf('\n', before - 1);
  }
  const lines = text.slice(before + 1, last + 1).split(/\r?\n/);
  // What follows the last line's end.
  lines.pop();
  return lines;
}
