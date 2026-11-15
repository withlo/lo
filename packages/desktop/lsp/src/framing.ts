/**
 * A watch on the size of what a server sends. `vscode-jsonrpc` reads each message whole into
 * memory, however large its header says it is, and keeps reading a header that never ends, so a
 * server could fill main's memory. This follows the same framing beside it (`Content-Length`
 * headers, then that many bytes) and says when a message's header or body passes its limit, so
 * the server can be stopped before much of it arrives.
 */

/** The largest message a server may send, in bytes. */
export const MESSAGE_LIMIT = 64 * 1024 * 1024;

/** The longest a message's header may be, in bytes. */
export const HEADER_LIMIT = 8 * 1024;

export class FrameMeter {
  readonly #limit: number;
  /** The current header's bytes so far, as Latin-1 text, while reading one. */
  #header = '';
  /** How many bytes of the current message's body are still to come. */
  #body = 0;

  constructor(limit: number = MESSAGE_LIMIT) {
    this.#limit = limit;
  }

  /** Measures the next piece of the stream. It returns what's wrong once a limit is passed. */
  feed(chunk: Uint8Array): string | undefined {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      if (this.#body > 0) {
        const taken = Math.min(this.#body, bytes.length - offset);
        this.#body -= taken;
        offset += taken;
        continue;
      }
      const before = this.#header.length;
      this.#header += bytes.toString('latin1', offset, offset + HEADER_LIMIT + 4);
      const end = this.#header.indexOf('\r\n\r\n');
      if (end === -1) {
        if (this.#header.length > HEADER_LIMIT) return 'It sent a header too long to read.';
        return undefined;
      }
      const length = contentLength(this.#header.slice(0, end));
      if (length === undefined) return 'It sent a message without its length.';
      if (length > this.#limit) {
        return `It sent a message of ${megabytes(length)}, past the limit of ${megabytes(this.#limit)}.`;
      }
      offset += end + 4 - before;
      this.#header = '';
      this.#body = length;
    }
    return undefined;
  }
}

/** The `Content-Length` a message's header gives, if it gives one. */
function contentLength(header: string): number | undefined {
  for (const line of header.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1 || line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue;
    const value = line.slice(colon + 1).trim();
    return /^\d{1,15}$/.test(value) ? Number(value) : undefined;
  }
  return undefined;
}

/** `bytes` in whole megabytes, rounded up. */
function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024)).toLocaleString('en-US')} MB`;
}
