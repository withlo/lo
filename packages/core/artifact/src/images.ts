/**
 * Image figures' headers: the type a file's first bytes say it is, and its size in pixels, read
 * from its header alone. Nothing here decodes an image, so nothing here costs more than walking the
 * blocks before the size: a renderer decodes the image later, within the size read here.
 *
 * The type comes from each format's signature, as a browser's image decoders choose, never from
 * the file's name. The size is where a browser takes it from: a PNG's `IHDR` chunk, a JPEG's frame
 * header, a WebP's first chunk, and a GIF's screen, grown to take in its first frame, as browsers
 * grow it. Anything else in a header is refused as damaged rather than guessed at.
 */

/** The types of image a figure may be, besides an SVG. */
export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp';

/** What an image's header says. */
export type ImageHeader =
  | { kind: 'size'; width: number; height: number }
  /** The header goes on past the bytes given, which aren't the whole file. */
  | { kind: 'more' }
  /**
   * It isn't a header the type has: what's wrong, as words that follow the file's name in a
   * sentence.
   */
  | { kind: 'damaged'; why: string };

/** The bytes each type starts with. A JPEG's are its start marker and the next marker's start. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  return (
    bytes.length >= at + signature.length &&
    signature.every((byte, index) => bytes[at + index] === byte)
  );
}

/** The type `bytes`, a file's first, say it is, or undefined when they're no image's. */
export function imageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpeg';
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'gif';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'webp';
  return undefined;
}

/**
 * The size `bytes`, the start of an image of type `kind`, give in their header. `whole` says whether
 * they're the whole file: when they aren't, and the header goes on past them, the answer is `more`.
 * Never throws, and takes time in proportion to the bytes at most.
 */
export function imageHeader(kind: ImageType, bytes: Uint8Array, whole: boolean): ImageHeader {
  const read = new Reader(bytes, whole);
  let header: ImageHeader;
  switch (kind) {
    case 'png':
      header = png(read);
      break;
    case 'jpeg':
      header = jpeg(read);
      break;
    case 'gif':
      header = gif(read);
      break;
    case 'webp':
      header = webp(read);
      break;
    default:
      kind satisfies never;
      return { kind: 'damaged', why: 'is of no type Lo reads' };
  }
  if (header.kind === 'size' && (header.width === 0 || header.height === 0)) {
    return { kind: 'damaged', why: 'has a width or a height of 0' };
  }
  return header;
}

/** Thrown when a header needs bytes past those given. */
class Short extends Error {}

/** Reads numbers from `bytes`, throwing `Short` past their end. */
class Reader {
  readonly bytes: Uint8Array;
  readonly whole: boolean;

  constructor(bytes: Uint8Array, whole: boolean) {
    this.bytes = bytes;
    this.whole = whole;
  }

  /** The byte at `at`. */
  u8(at: number): number {
    const byte = this.bytes[at];
    if (byte === undefined) throw new Short();
    return byte;
  }

  u16be(at: number): number {
    return (this.u8(at) << 8) | this.u8(at + 1);
  }

  u16le(at: number): number {
    return this.u8(at) | (this.u8(at + 1) << 8);
  }

  u24le(at: number): number {
    return this.u8(at) | (this.u8(at + 1) << 8) | (this.u8(at + 2) << 16);
  }

  u32be(at: number): number {
    return this.u16be(at) * 0x10000 + this.u16be(at + 2);
  }

  u32le(at: number): number {
    return this.u16le(at) + this.u16le(at + 2) * 0x10000;
  }

  /** The bytes from `at` for `length`. */
  slice(at: number, length: number): Uint8Array {
    if (at + length > this.bytes.length) throw new Short();
    return this.bytes.subarray(at, at + length);
  }

  /** What a header that ends past the bytes is: `more` if there are more, else cut short. */
  short(): ImageHeader {
    return this.whole ? { kind: 'damaged', why: 'ends before its header does' } : { kind: 'more' };
  }
}

function damaged(why: string): ImageHeader {
  return { kind: 'damaged', why };
}

function sized(width: number, height: number): ImageHeader {
  return { kind: 'size', width, height };
}

/** Runs `read` over the reader, answering `more` or cut short when it runs past the bytes. */
function reading(read: Reader, header: () => ImageHeader): ImageHeader {
  try {
    return header();
  } catch (error) {
    if (error instanceof Short) return read.short();
    throw error;
  }
}

/** The bit depths each PNG color type may have. */
const PNG_DEPTHS = new Map<number, readonly number[]>([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);

/** The `IHDR` chunk's type, as bytes. */
const IHDR = [0x49, 0x48, 0x44, 0x52];

/**
 * A PNG's size, from its `IHDR` chunk, which comes first: 13 bytes of data, each field one a PNG
 * may have, and a checksum that matches.
 */
function png(read: Reader): ImageHeader {
  return reading(read, () => {
    const length = read.u32be(8);
    const chunk = read.slice(12, 17);
    if (length !== 13 || !startsWith(chunk, IHDR)) {
      return damaged("doesn't start with an IHDR chunk, which holds a PNG's size");
    }
    if (read.u32be(29) !== crc32(chunk)) return damaged("has an IHDR chunk that's been damaged");
    const width = read.u32be(16);
    const height = read.u32be(20);
    const depth = read.u8(24);
    const color = read.u8(25);
    if (
      width > 0x7fffffff ||
      height > 0x7fffffff ||
      !PNG_DEPTHS.get(color)?.includes(depth) ||
      read.u8(26) !== 0 ||
      read.u8(27) !== 0 ||
      read.u8(28) > 1
    ) {
      return damaged('has an IHDR chunk no PNG has');
    }
    return sized(width, height);
  });
}

/** A JPEG's frame headers, `SOF0` to `SOF15`, which hold its size: every `0xCn` but these. */
const NOT_FRAMES = new Set([0xc4, 0xc8, 0xcc]);

/**
 * A JPEG's size, from its frame header: the first, after the segments before it, each skipped by
 * its length. Image data, or the image's end, before it, a second start, or bytes between segments
 * are refused.
 */
function jpeg(read: Reader): ImageHeader {
  return reading(read, () => {
    let at = 2;
    for (;;) {
      if (read.u8(at) !== 0xff) return damaged("has bytes between its header's segments");
      // Any number of 0xFF may come before a marker.
      while (read.u8(at) === 0xff) at += 1;
      const marker = read.u8(at);
      at += 1;
      // Markers that stand alone: restarts, and `TEM`.
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (marker === 0x00 || marker === 0xd8) return damaged('has a marker no header has');
      if (marker === 0xd9 || marker === 0xda) {
        return damaged("has no frame header, which holds a JPEG's size, before its image");
      }
      const length = read.u16be(at);
      if (length < 2) return damaged('has a segment shorter than its own length');
      if (marker >= 0xc0 && marker <= 0xcf && !NOT_FRAMES.has(marker)) {
        if (length < 8) return damaged('has a frame header too short to hold its size');
        const height = read.u16be(at + 3);
        if (height === 0)
          return damaged("leaves its height to after its image, which Lo doesn't read");
        return sized(read.u16be(at + 5), height);
      }
      at += length;
    }
  });
}

/**
 * A GIF's size: its screen's, grown to take in its first frame, as browsers grow it, since a frame
 * may be larger than the screen it's on. The blocks before the first frame are skipped.
 */
function gif(read: Reader): ImageHeader {
  return reading(read, () => {
    const screen = { width: read.u16le(6), height: read.u16le(8) };
    const flags = read.u8(10);
    // The global color table, when there is one: three bytes for each of 2 to 256 colors.
    let at = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
    for (;;) {
      const block = read.u8(at);
      if (block === 0x2c) {
        const left = read.u16le(at + 1);
        const top = read.u16le(at + 3);
        const width = read.u16le(at + 5);
        const height = read.u16le(at + 7);
        return sized(Math.max(screen.width, left + width), Math.max(screen.height, top + height));
      }
      if (block === 0x3b) return damaged('has no frames');
      if (block !== 0x21) return damaged('has a block no GIF has before its first frame');
      // An extension: its label, then blocks of data, each after its length, to one of length 0.
      at += 2;
      for (let length = read.u8(at); length !== 0; length = read.u8(at)) at += length + 1;
      at += 1;
    }
  });
}

const VP8 = [0x56, 0x50, 0x38, 0x20];
const VP8L = [0x56, 0x50, 0x38, 0x4c];
const VP8X = [0x56, 0x50, 0x38, 0x58];

/**
 * A WebP's size, from its first chunk: a lossy image's key frame, a lossless image's header, or an
 * extended image's canvas, which every frame of an animation lies in.
 */
function webp(read: Reader): ImageHeader {
  return reading(read, () => {
    const chunk = read.slice(12, 4);
    if (startsWith(chunk, VP8)) {
      // A frame tag of three bytes, its lowest bit 0 for a key frame, then the key frame's start
      // code and its size, 14 bits a side.
      if ((read.u8(20) & 0x01) !== 0) return damaged("starts with a frame that isn't a key frame");
      if (read.u8(23) !== 0x9d || read.u8(24) !== 0x01 || read.u8(25) !== 0x2a) {
        return damaged('has a key frame with no start code');
      }
      return sized(read.u16le(26) & 0x3fff, read.u16le(28) & 0x3fff);
    }
    if (startsWith(chunk, VP8L)) {
      if (read.u8(20) !== 0x2f) return damaged('has a lossless image with no signature');
      const bits = read.u32le(21);
      if (bits >>> 29 !== 0) return damaged("has a lossless image of a version Lo doesn't read");
      return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (startsWith(chunk, VP8X)) {
      if (read.u32le(16) < 10) return damaged('has a VP8X chunk too short to hold its size');
      return sized(read.u24le(24) + 1, read.u24le(27) + 1);
    }
    return damaged("doesn't start with an image chunk, which holds a WebP's size");
  });
}

/** CRC-32's table, as PNG uses it. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as PNG checks a chunk's type and data. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
