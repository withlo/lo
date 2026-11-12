/**
 * Images' headers for tests, built byte by byte: a PNG's signature and IHDR chunk, a JPEG's
 * segments, a GIF's screen, blocks and frames, and a WebP's first chunk. Only the headers are
 * real: what follows them is never an image.
 */

import { crc32 } from '../src/images.ts';

const encoder = new TextEncoder();

export function join(...parts: (Uint8Array | readonly number[] | string)[]): Uint8Array {
  const arrays = parts.map((part) =>
    typeof part === 'string' ? encoder.encode(part) : Uint8Array.from(part),
  );
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

export function u32le(value: number): number[] {
  return [...u16le(value & 0xffff), ...u16le(Math.floor(value / 0x10000))];
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function chunk(kind: string, data: Uint8Array | readonly number[]): Uint8Array {
  const typed = join(kind, data);
  return join(u32be(data.length), typed, u32be(crc32(typed)));
}

/** A PNG's signature and `IHDR` chunk, with its fields as given. */
export function png(
  width: number,
  height: number,
  { depth = 8, color = 2, compression = 0, filter = 0, interlace = 0 } = {},
): Uint8Array {
  const fields = [...u32be(width), ...u32be(height), depth, color, compression, filter, interlace];
  return join(PNG_SIGNATURE, chunk('IHDR', fields), chunk('IEND', []));
}

/** A JPEG's start, the segments given, then image data and its end. */
export function jpeg(...segments: (Uint8Array | readonly number[])[]): Uint8Array {
  return join([0xff, 0xd8], ...segments, [0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

export function segment(marker: number, data: readonly number[] | Uint8Array): Uint8Array {
  return join([0xff, marker, ...u16be(data.length + 2)], data);
}

export function sof(width: number, height: number, marker = 0xc0): Uint8Array {
  return segment(marker, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]);
}

export const APP0 = segment(0xe0, [...encoder.encode('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

/** A GIF's header and screen, then `blocks`, then its end. */
export function gif(
  width: number,
  height: number,
  blocks: (Uint8Array | readonly number[])[],
  table = 0,
): Uint8Array {
  const flags = table > 0 ? 0x80 | (table - 1) : 0;
  return join(
    'GIF89a',
    [...u16le(width), ...u16le(height), flags, 0, 0],
    new Uint8Array(table > 0 ? 3 * 2 ** table : 0),
    ...blocks,
    [0x3b],
  );
}

export function frame(left: number, top: number, width: number, height: number): number[] {
  return [
    0x2c,
    ...u16le(left),
    ...u16le(top),
    ...u16le(width),
    ...u16le(height),
    0,
    2,
    2,
    0x44,
    0x01,
    0,
  ];
}

/** An extension, its data in blocks of `size`. */
export function extension(label: number, data: Uint8Array, size = 255): Uint8Array {
  const parts: (Uint8Array | number[])[] = [[0x21, label]];
  for (let at = 0; at < data.length; at += size) {
    const part = data.subarray(at, at + size);
    parts.push([part.length], part);
  }
  parts.push([0]);
  return join(...parts);
}

/** A WebP holding the one chunk given. */
export function webp(kind: string, data: readonly number[]): Uint8Array {
  const body = join('WEBP', kind, u32le(data.length), data);
  return join('RIFF', u32le(body.length), body);
}

export function vp8(width: number, height: number, key = true): Uint8Array {
  return webp('VP8 ', [
    key ? 0x30 : 0x31,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    ...u16le(width),
    ...u16le(height),
    0,
    0,
  ]);
}

export function vp8l(width: number, height: number, version = 0): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14) | (version << 29);
  return webp('VP8L', [0x2f, ...u32le(bits >>> 0), 0, 0]);
}

export function vp8x(width: number, height: number): Uint8Array {
  return webp('VP8X', [0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]);
}

/**
 * TIFF data as Exif holds it: a byte order, then one directory at `directory` holding `entries`,
 * each a tag, a type, a count and four bytes of value, then no next directory.
 */
export function tiff(
  entries: readonly (readonly [tag: number, type: number, count: number, value: number])[],
  { little = false, directory = 8 } = {},
): Uint8Array {
  const u16 = little ? u16le : u16be;
  const u32 = little ? u32le : u32be;
  const fields = entries.flatMap(([tag, type, count, value]) => [
    ...u16(tag),
    ...u16(type),
    ...u32(count),
    // A short sits in the value's first two bytes.
    ...(type === 3 ? [...u16(value), 0, 0] : u32(value)),
  ]);
  return join(
    little ? 'II' : 'MM',
    u16(42),
    u32(directory),
    new Uint8Array(directory - 8),
    u16(entries.length),
    fields,
    u32(0),
  );
}

/** An orientation entry: tag 0x0112, one short. */
export function orientation(value: number): [number, number, number, number] {
  return [0x0112, 3, 1, value];
}

/** A JPEG's Exif segment, holding `data` after `Exif\0\0`. */
export function exifSegment(data: Uint8Array): Uint8Array {
  return segment(0xe1, join('Exif', [0, 0], data));
}

/** A PNG with the chunks given after its `IHDR`, then image data and its end. */
export function pngWith(width: number, height: number, ...chunks: Uint8Array[]): Uint8Array {
  const whole = png(width, height);
  // The signature and IHDR: 8 bytes, then 12 around its 13 of data.
  return join(whole.subarray(0, 33), ...chunks, chunk('IDAT', [0]), chunk('IEND', []));
}
