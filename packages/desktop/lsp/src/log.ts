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
    for (const line of text.replace(/\r?\n$/, '').split(/\r?\n/)) this.#keep(line);
  }

  /** Adds what a stream wrote, holding a line back until it ends. */
  write(text: string): void {
    const lines = (this.#partial + text).split(/\r?\n/);
    this.#partial = lines.pop() ?? '';
    // A line that never ends is kept in pieces, so the part held back stays small.
    while (this.#partial.length > LINE_LENGTH) {
      lines.push(this.#partial.slice(0, LINE_LENGTH));
      this.#partial = this.#partial.slice(LINE_LENGTH);
    }
    for (const line of lines) this.#keep(line);
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
