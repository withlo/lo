import { expect, test } from 'vitest';

import { imageSummary, readImage } from './images.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function uint32(value: number): number[] {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Deflate's length symbol, its base length and its number of extra bits, for 3 to 257. */
function lengthCode(length: number): [number, number, number] {
  const bases = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227,
  ];
  const index = bases.findLastIndex((base) => base <= length);
  return [257 + index, bases[index] ?? 0, index < 8 ? 0 : Math.floor((index - 4) / 4)];
}

/**
 * A zlib stream of `count` zero bytes, a few bytes per 258 of them: deflate's fixed codes for one
 * literal zero, then copies of the byte before.
 */
function zlibZeros(count: number): Uint8Array {
  const out = [0x78, 0x01];
  let bits = 0;
  let used = 0;
  // `count` bits of `value`, least significant first.
  const put = (value: number, length: number) => {
    for (let at = 0; at < length; at++) {
      bits |= ((value >> at) & 1) << used;
      if (++used === 8) {
        out.push(bits);
        [bits, used] = [0, 0];
      }
    }
  };
  // A Huffman code, most significant bit first.
  const code = (value: number, length: number) => {
    for (let at = length - 1; at >= 0; at--) put((value >> at) & 1, 1);
  };
  // The final block, with fixed codes.
  put(1, 1);
  put(1, 2);
  let left = count;
  if (left > 0) {
    // A literal zero.
    code(0x30, 8);
    left--;
  }
  while (left >= 3) {
    const length = Math.min(left, 258);
    if (length === 258) {
      // Length code 285.
      code(0xc5, 8);
    } else {
      const [symbol, base, extra] = lengthCode(length);
      if (symbol < 280) {
        code(symbol - 256, 7);
      } else {
        code(0xc0 + symbol - 280, 8);
      }
      put(length - base, extra);
    }
    // Distance code 0: one byte back.
    code(0, 5);
    left -= length;
  }
  for (; left > 0; left--) code(0x30, 8);
  // End of block.
  code(0, 7);
  if (used > 0) out.push(bits);
  // Adler-32 of zeros: the first sum stays 1, the second counts them.
  out.push(...uint32((count % 65_521) * 0x1_0000 + 1));
  return Uint8Array.from(out);
}

/**
 * A PNG of `width` × `height` RGBA pixels, every one zero, with an `iCCP` colour profile that
 * inflates to `profile` zero bytes when it's given.
 */
function png(width = 3, height = 2, profile?: number): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (kind: string, ...body: Uint8Array[]) => {
    const typed = concat(encode(kind), ...body);
    parts.push(
      Uint8Array.from(uint32(typed.length - 4)),
      typed,
      Uint8Array.from(uint32(crc32(typed))),
    );
  };
  chunk('IHDR', Uint8Array.from([...uint32(width), ...uint32(height), 8, 6, 0, 0, 0]));
  if (profile !== undefined) chunk('iCCP', encode('x\0\0'), zlibZeros(profile));
  // Each row: filter type 0, then its pixels.
  chunk('IDAT', zlibZeros((1 + width * 4) * height));
  chunk('IEND');
  return concat(...parts);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

/** A GIF of `frames` frames, each a 1 × 1 image, on a `width` × `height` screen. */
function gif(width: number, height: number, frames: number): Uint8Array {
  const bytes = [
    ...encode('GIF89a'),
    width & 0xff,
    width >> 8,
    height & 0xff,
    height >> 8,
    0,
    0,
    0,
  ];
  for (let frame = 0; frame < frames; frame++) {
    // A graphic control extension, then a 1 × 1 frame with a two-colour local table.
    bytes.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00);
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80);
    bytes.push(0, 0, 0, 255, 255, 255);
    bytes.push(0x02, 0x02, 0x44, 0x01, 0x00);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

test('reading an images header skips a huge colour profile', () => {
  // 3 MB that inflate to 480 MiB, which reading the header never does.
  const side = readImage('profile.png', png(1, 1, 480 * 1024 * 1024));
  expect(side?.dimensions).toEqual({ width: 1, height: 1 });
});

test('images are read by their bytes when their name says image', () => {
  const logo = readImage('assets/logo.png', png());
  expect(logo?.format).toBe('png');
  expect(logo?.dimensions).toEqual({ width: 3, height: 2 });
  expect(logo && imageSummary(logo)).toMatch(/^PNG image, 3 × 2, /);

  // The name decides whether it's an image, case aside, and the bytes which format.
  expect(readImage('LOGO.JPG', png())).toBeDefined();
  expect(readImage('logo.jpg', png())?.format).toBe('png');
  expect(readImage('logo.bin', png())).toBeUndefined();
  expect(readImage('logo', png())).toBeUndefined();
  // A Git LFS pointer isn't an image.
  const pointer = encode('version https://git-lfs.github.com/spec/v1\noid sha256:ab\nsize 12\n');
  expect(readImage('logo.png', pointer)).toBeUndefined();
});

test('jpeg and webp images are read by their headers', () => {
  // SOI, an APP0 segment, a fill byte, then a baseline frame header: 8 bits, 30 rows of 40, 3
  // components.
  const jpeg = new Uint8Array(30);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  jpeg.set([0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x1e, 0x00, 0x28, 0x03], 10);
  expect(readImage('photo.jpeg', jpeg)?.dimensions).toEqual({ width: 40, height: 30 });

  // Lossy: a frame tag, the start code, then 14-bit width and height.
  const lossy = webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 40, 0, 30, 0]);
  // Lossless: its signature, then width - 1 and height - 1 in 14 bits each: 39 | 29 << 14.
  const lossless = webp('VP8L', [0x2f, 0x27, 0x40, 0x07, 0x00]);
  // Extended: flags, then width - 1 and height - 1 in 24 bits each.
  const extended = webp('VP8X', [0, 0, 0, 0, 39, 0, 0, 29, 0, 0]);
  expect(
    [lossy, lossless, extended].map((bytes) => readImage('art.webp', bytes)?.dimensions),
  ).toEqual(Array.from({ length: 3 }, () => ({ width: 40, height: 30 })));
  expect(readImage('art.webp', lossy)?.format).toBe('webp');
});

/** A WebP whose first chunk is `chunk`, holding `data`. Sizes are left at zero. */
function webp(chunk: string, data: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(20 + data.length);
  bytes.set(encode('RIFF'));
  bytes.set(encode(`WEBP${chunk}`), 8);
  bytes.set(data, 20);
  return bytes;
}

test('an animated gif says how many frames it has', () => {
  const spin = readImage('spin.gif', gif(30, 20, 3));
  expect(spin?.frames).toBe(3);
  expect(spin && imageSummary(spin)).toMatch(/^GIF image, 30 × 20, animated, 3 frames, /);
  const still = readImage('dot.gif', gif(1, 1, 1));
  expect(still?.frames).toBeUndefined();
  expect(still && imageSummary(still)).toMatch(/^GIF image, 1 × 1, /);
});

test('svg files are images when they hold svg', () => {
  const svg = readImage(
    'icon.svg',
    encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'),
  );
  expect(svg?.format).toBe('svg');
  expect(svg && imageSummary(svg)).toBe('SVG image, 62 B');
  expect(readImage('icon.svg', encode('not svg'))).toBeUndefined();
  // Nor are bytes that aren't UTF-8.
  expect(readImage('icon.svg', Uint8Array.from([...encode('<svg'), 0xff]))).toBeUndefined();
});
