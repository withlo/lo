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
 *   disagreed couldn't hold more;
 * - more than {@link FLOOD_MESSAGES} messages, {@link FLOOD_BYTES} of output or
 *   {@link FLOOD_LINES} lines of stderr arrive within {@link FLOOD_WINDOW}: a flood, each message
 *   or line within the limits. No real server comes near: a large workspace's diagnostics are
 *   thousands of messages over many seconds, and a server logs far fewer lines.
 *
 * It also says when Lo is {@link FrameMeter.behind}, holding many whole messages it hasn't handed
 * on, so the server's output can wait in its pipe while main catches up.
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

/** The most messages a server may send within {@link FLOOD_WINDOW}, answers and notifications alike. */
export const FLOOD_MESSAGES = 50_000;

/** The most output a server may write within {@link FLOOD_WINDOW}, in bytes, stderr included. */
export const FLOOD_BYTES = 256 * 1024 * 1024;

/**
 * The most lines a server may write to stderr within {@link FLOOD_WINDOW}. Bytes alone don't bound
 * it: a flood of empty lines is a line a byte, far more lines than bytes cost.
 */
export const FLOOD_LINES = 50_000;

/** The window a server's rate is measured over, in milliseconds. */
export const FLOOD_WINDOW = 10_000;

/** How many whole messages, or bytes of them, the reader may hold unhanded before it's behind. */
const BEHIND_MESSAGES = 512;
const BEHIND_BYTES = 1024 * 1024;

/** How many slots a rate's window has: it reaches back between 9 and 10 of them. */
const SLOTS = 10;

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

/** What a meter allows, which tests can make smaller. */
export interface MeterLimits {
  readonly message?: number | undefined;
  readonly unread?: number | undefined;
  readonly messages?: number | undefined;
  readonly bytes?: number | undefined;
  readonly lines?: number | undefined;
  readonly within?: number | undefined;
  /** The clock, in milliseconds. */
  readonly now?: (() => number) | undefined;
}

export class FrameMeter {
  readonly #limit: number;
  readonly #unreadLimit: number;
  readonly #messages: number;
  readonly #bytes: number;
  readonly #lines: number;
  readonly #within: number;
  readonly #now: () => number;
  readonly #window: Window;
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
  /** Their sizes' sum. */
  #wholeBytes = 0;
  /** Bytes read and not yet handed on. */
  #unread = 0;

  constructor(limits: MeterLimits = {}) {
    this.#limit = limits.message ?? MESSAGE_LIMIT;
    this.#unreadLimit = limits.unread ?? UNREAD_LIMIT;
    this.#messages = limits.messages ?? FLOOD_MESSAGES;
    this.#bytes = limits.bytes ?? FLOOD_BYTES;
    this.#lines = limits.lines ?? FLOOD_LINES;
    this.#within = limits.within ?? FLOOD_WINDOW;
    this.#now = limits.now ?? (() => performance.now());
    this.#window = new Window(this.#within);
  }

  /** Whether the reader holds so many whole messages it hasn't handed on that reading should wait. */
  get behind(): boolean {
    return this.#whole.length >= BEHIND_MESSAGES || this.#wholeBytes >= BEHIND_BYTES;
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
    const whole = this.#whole.length;
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
    return this.#count(this.#whole.length - whole, chunk.byteLength, 0);
  }

  /** Counts what the server wrote to stderr, `bytes` holding `lines` line ends, toward its rate. */
  counted(bytes: number, lines = 0): string | undefined {
    return this.#count(0, bytes, lines);
  }

  /** The reader handed on a message. It returns what's wrong if the meter knew of no whole one. */
  handedOn(): string | undefined {
    const size = this.#whole.shift();
    if (size === undefined) return 'It sent a message Lo didn’t see the end of.';
    this.#unread -= size;
    this.#wholeBytes -= size;
    return undefined;
  }

  /** Adds to the rate's window, and says if what it holds passes a limit. */
  #count(messages: number, bytes: number, lines: number): string | undefined {
    const sum = this.#window.add(this.#now(), { messages, bytes, lines });
    const seconds = `${(this.#within / 1000).toLocaleString('en-US')} s`;
    if (sum.messages > this.#messages) {
      return `It sent more than ${this.#messages.toLocaleString('en-US')} messages in ${seconds}.`;
    }
    if (sum.bytes > this.#bytes)
      return `It sent more than ${megabytes(this.#bytes)} in ${seconds}.`;
    if (sum.lines > this.#lines) {
      return `It wrote more than ${this.#lines.toLocaleString('en-US')} lines to stderr in ${seconds}.`;
    }
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
    this.#wholeBytes += this.#size;
    this.#size = 0;
    this.#body = -1;
  }
}

/** What a rate counts. */
interface Counts {
  messages: number;
  bytes: number;
  lines: number;
}

/** Sums over a window that slides a slot at a time. */
class Window {
  readonly #slot: number;
  readonly #slots: (Counts & { readonly at: number })[] = [];
  readonly #sum: Counts = { messages: 0, bytes: 0, lines: 0 };

  constructor(within: number) {
    this.#slot = within / SLOTS;
  }

  /** Adds `counts` to the window at `now`, and returns what it holds. */
  add(now: number, counts: Readonly<Counts>): Readonly<Counts> {
    const at = Math.floor(now / this.#slot);
    for (
      let old = this.#slots[0];
      old !== undefined && old.at <= at - SLOTS;
      old = this.#slots[0]
    ) {
      this.#slots.shift();
      this.#sum.messages -= old.messages;
      this.#sum.bytes -= old.bytes;
      this.#sum.lines -= old.lines;
    }
    let slot = this.#slots.at(-1);
    if (slot?.at !== at) {
      slot = { at, messages: 0, bytes: 0, lines: 0 };
      this.#slots.push(slot);
    }
    slot.messages += counts.messages;
    slot.bytes += counts.bytes;
    slot.lines += counts.lines;
    this.#sum.messages += counts.messages;
    this.#sum.bytes += counts.bytes;
    this.#sum.lines += counts.lines;
    return this.#sum;
  }
}

/** `bytes` in whole megabytes, rounded up. */
function megabytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'more than anything can hold';
  return `${Math.ceil(bytes / (1024 * 1024)).toLocaleString('en-US')} MB`;
}
