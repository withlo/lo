/**
 * `artifact.md` as it arrives: bytes from git, or a string. Its size is known before its text is
 * read, so a file far past the limit costs no more than one at it.
 */

import { HEADER_WINDOW, LIMITS } from './limits.ts';

export interface Source {
  /**
   * Its size in bytes of UTF-8, a byte-order mark aside. A string is measured only until it's
   * past the limit, so a larger one reads as just past it.
   */
  size: number;
  /** Its first characters, where the header is looked for, with line endings as `\n`. */
  start: string;
  /** All of its text, with line endings as `\n`; or where it first isn't UTF-8. */
  text(): { ok: true; text: string } | { ok: false; line: number };
}

/** `source`, without the byte-order mark it may start with. */
export function readSource(source: Uint8Array | string): Source {
  return typeof source === 'string' ? fromString(source) : fromBytes(source);
}

function fromBytes(bytes: Uint8Array): Source {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(bom);
  // A character is at most four bytes; a character cut off at the end is held back.
  const start = new TextDecoder('utf-8', { ignoreBOM: true })
    .decode(body.subarray(0, HEADER_WINDOW * 4), { stream: true })
    .slice(0, HEADER_WINDOW);
  return {
    size: body.length,
    start: lines(start),
    text: () => {
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
        return { ok: true, text: lines(text) };
      } catch {
        return { ok: false, line: lineAt(body, firstInvalid(body)) };
      }
    },
  };
}

function fromString(source: string): Source {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  return {
    size: utf8Length(text, LIMITS.size + 1),
    start: lines(text.slice(0, HEADER_WINDOW)),
    text: () => {
      if (text.isWellFormed()) return { ok: true, text: lines(text) };
      // A lone surrogate, which no UTF-8 holds.
      let at = 0;
      while (at < text.length) {
        const unit = text.charCodeAt(at);
        const next = text.charCodeAt(at + 1);
        if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) at += 2;
        else if (unit >= 0xd800 && unit <= 0xdfff) break;
        else at += 1;
      }
      return { ok: false, line: lineOf(text, at) };
    },
  };
}

/** `text` with each `\r\n` and lone `\r` as `\n`, as Markdown reads line endings. */
function lines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/** The bytes of UTF-8 `text` takes, counted until they reach `stop`. */
export function utf8Length(text: string, stop = Infinity): number {
  let bytes = 0;
  for (let at = 0; at < text.length && bytes < stop; at++) {
    const unit = text.charCodeAt(at);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(at + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        at += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** The offset of the first byte of `bytes` that doesn't start valid UTF-8, or its length. */
function firstInvalid(bytes: Uint8Array): number {
  let at = 0;
  while (at < bytes.length) {
    const lead = bytes[at]!;
    if (lead < 0x80) {
      at += 1;
      continue;
    }
    let more: number;
    if (lead >= 0xc2 && lead <= 0xdf) more = 1;
    else if (lead >= 0xe0 && lead <= 0xef) more = 2;
    else if (lead >= 0xf0 && lead <= 0xf4) more = 3;
    else return at;
    // The second byte's range rules out overlong forms, surrogates and code points past U+10FFFF.
    const low = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
    const high = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
    const second = bytes[at + 1];
    if (second === undefined || second < low || second > high) return at;
    for (let k = 2; k <= more; k++) {
      const next = bytes[at + k];
      if (next === undefined || next < 0x80 || next > 0xbf) return at;
    }
    at += more + 1;
  }
  return at;
}

/** The line, from 1, that byte `offset` of `bytes` is on. */
function lineAt(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset; at++) {
    const byte = bytes[at];
    if (byte === 0x0a || (byte === 0x0d && bytes[at + 1] !== 0x0a)) line += 1;
  }
  return line;
}

/** The line, from 1, that character `offset` of `text` is on. */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset; at++) {
    const unit = text.charCodeAt(at);
    if (unit === 0x0a || (unit === 0x0d && text.charCodeAt(at + 1) !== 0x0a)) line += 1;
  }
  return line;
}
