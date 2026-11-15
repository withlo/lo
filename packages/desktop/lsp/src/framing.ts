/**
 * A watch on what a server sends, beside `vscode-jsonrpc`'s reader. The reader keeps whatever it's
 * sent until a message is whole, however large its header says it is, and decodes whole messages
 * one at a time, so a server could fill main's memory with one huge message or a flood of small
 * ones. The meter follows the same framing, byte for byte as the reader does, and says when:
 *
 * - a header is too long, can't be read, or gives no length or two lengths;
 * - a message's length passes {@link MESSAGE_LIMIT};
 * - what's been read but not yet handed on, whole messages and the one arriving, passes
 *   {@link UNREAD_LIMIT}. That holds whatever the headers say, so even a reader and meter that
 *   disagreed couldn't hold more.
 *
 * The reader finds a header's end with a small state machine (below), reads the header as ASCII
 * with each byte's high bit dropped, splits it into lines at CRLF, takes each line's name up to its
 * first colon in lowercase and its value trimmed, keeps the last `Content-Length`, and reads it with
 * `parseInt`. The meter does each the same way, so the two always agree on a message's length; it
 * refuses a second `Content-Length` outright.
 */

/** The largest message a server may send, in bytes. */
export const MESSAGE_LIMIT = 64 * 1024 * 1024;

/** The longest a message's header may be, in bytes. */
export const HEADER_LIMIT = 8 * 1024;

/**
 * The most of a server's output Lo holds before handing it on, in bytes: a message at the limit,
 * and as much as 16 MB of smaller ones waiting behind it.
 */
export const UNREAD_LIMIT = MESSAGE_LIMIT + 16 * 1024 * 1024;

const CR = 13;
const LF = 10;

/**
 * The reader's state machine for a header's end, `\r\n\r\n`: 1 after a CR, 2 after CR LF, 3 after
 * CR LF CR, 4 at the end. Any other byte, or a CR or LF out of turn, goes back to 0.
 */
function next(state: number, byte: number): number {
  if (byte === CR) return state === 0 ? 1 : state === 2 ? 3 : 0;
  if (byte === LF) return state === 1 ? 2 : state === 3 ? 4 : 0;
  return 0;
}

export class FrameMeter {
  readonly #limit: number;
  readonly #unreadLimit: number;
  /** Where the current header's end is, in the reader's state machine. */
  #state = 0;
  /** The current header so far, as the reader decodes it. */
  #header = '';
  /** How many bytes of the current message's body are still to come, or -1 while in its header. */
  #body = -1;
  /** The size of the current message so far, header and body. */
  #size = 0;
  /** The size of each whole message not yet handed on, oldest first. */
  readonly #whole: number[] = [];
  /** Bytes read and not yet handed on. */
  #unread = 0;

  constructor(limits: { readonly message?: number; readonly unread?: number } = {}) {
    this.#limit = limits.message ?? MESSAGE_LIMIT;
    this.#unreadLimit = limits.unread ?? UNREAD_LIMIT;
  }

  /** Bytes read and not yet handed on. */
  get unread(): number {
    return this.#unread;
  }

  /** Measures the next piece of the stream. It returns what's wrong once a limit is passed. */
  feed(chunk: Uint8Array): string | undefined {
    this.#unread += chunk.byteLength;
    if (this.#unread > this.#unreadLimit) {
      return `It sent more than ${megabytes(this.#unreadLimit)} before Lo could read it.`;
    }
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (this.#body > 0) {
        const taken = Math.min(this.#body, chunk.byteLength - offset);
        this.#body -= taken;
        this.#size += taken;
        offset += taken;
        if (this.#body === 0) this.#end();
        continue;
      }
      const byte = chunk[offset] ?? 0;
      offset += 1;
      this.#size += 1;
      // The reader decodes a header as ASCII, which drops each byte's high bit.
      this.#header += String.fromCharCode(byte & 0x7f);
      this.#state = next(this.#state, byte);
      if (this.#state !== 4) {
        if (this.#header.length > HEADER_LIMIT) return 'It sent a header too long to read.';
        continue;
      }
      const length = this.#length();
      if (typeof length === 'string') return length;
      this.#state = 0;
      this.#header = '';
      this.#body = length;
      if (length === 0) this.#end();
    }
    return undefined;
  }

  /** The reader handed on a message. It returns what's wrong if the meter knew of no whole one. */
  handedOn(): string | undefined {
    const size = this.#whole.shift();
    if (size === undefined) return 'It sent a message Lo didn’t see the end of.';
    this.#unread -= size;
    return undefined;
  }

  /** The current header's `Content-Length`, as the reader reads it, or what's wrong with it. */
  #length(): number | string {
    // The last two pieces are the empty ones after the closing CRLFs.
    const lines = this.#header.split('\r\n').slice(0, -2);
    let value: string | undefined;
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon === -1) return 'It sent a header Lo can’t read.';
      if (line.slice(0, colon).toLowerCase() !== 'content-length') continue;
      if (value !== undefined) return 'It sent a message with two lengths.';
      value = line.slice(colon + 1).trim();
    }
    if (value === undefined || value === '') return 'It sent a message without its length.';
    const length = Number.parseInt(value);
    if (Number.isNaN(length) || length < 0) return 'It sent a message with a length Lo can’t read.';
    if (length > this.#limit) {
      return `It sent a message of ${megabytes(length)}, past the limit of ${megabytes(this.#limit)}.`;
    }
    return length;
  }

  /** The current message is whole. */
  #end(): void {
    this.#whole.push(this.#size);
    this.#size = 0;
    this.#body = -1;
  }
}

/** `bytes` in whole megabytes, rounded up. */
function megabytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'more than anything can hold';
  return `${Math.ceil(bytes / (1024 * 1024)).toLocaleString('en-US')} MB`;
}
