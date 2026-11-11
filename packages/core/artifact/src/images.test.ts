import { describe, expect, test } from 'vitest';

import {
  APP0,
  chunk,
  extension,
  frame,
  gif,
  jpeg,
  join,
  png,
  PNG_SIGNATURE,
  segment,
  sof,
  u32le,
  vp8,
  vp8l,
  vp8x,
  webp,
} from '../test/images.ts';
import { imageHeader, imageType, type ImageHeader, type ImageType } from './images.ts';

const encoder = new TextEncoder();

function size(width: number, height: number): ImageHeader {
  return { kind: 'size', width, height };
}

function damaged(why: string): ImageHeader {
  return { kind: 'damaged', why };
}

describe('the type', () => {
  test.each([
    ['png', png(1, 1)],
    ['jpeg', jpeg(sof(1, 1))],
    ['gif', gif(1, 1, [frame(0, 0, 1, 1)])],
    ['gif', join('GIF87a', new Uint8Array(7))],
    ['webp', vp8(1, 1)],
  ] as const)('is %s, from the first bytes', (type, bytes) => {
    expect(imageType(bytes)).toBe(type);
  });

  test.each([
    ['nothing', new Uint8Array()],
    ['a PNG signature cut short', Uint8Array.from(PNG_SIGNATURE.slice(0, 7))],
    ['a PNG signature changed', Uint8Array.from([...PNG_SIGNATURE.slice(0, 7), 0x0b])],
    ['a JPEG start without a marker after it', Uint8Array.from([0xff, 0xd8, 0x00])],
    ['GIF of another version', encoder.encode('GIF90a')],
    ['a RIFF file of another kind', join('RIFF', u32le(4), 'WAVE')],
    ['an SVG', encoder.encode('<svg viewBox="0 0 1 1"/>')],
    ['HTML', encoder.encode('<!doctype html><script>alert(1)</script>')],
    ['a BMP', encoder.encode('BM')],
  ])('is no image’s, from %s', (_what, bytes) => {
    expect(imageType(bytes)).toBeUndefined();
  });
});

describe('a PNG', () => {
  test('is sized by its IHDR chunk', () => {
    expect(imageHeader('png', png(320, 180), true)).toEqual(size(320, 180));
    expect(imageHeader('png', png(65_535, 65_535), true)).toEqual(size(65_535, 65_535));
    expect(imageHeader('png', png(0x7fffffff, 1), true)).toEqual(size(0x7fffffff, 1));
  });

  test.each([
    [0, 0],
    [1, 2],
    [2, 4],
    [16, 3],
    [4, 6],
    [8, 5],
    [8, 1],
  ])('refuses depth %i in color type %i', (depth, color) => {
    expect(imageHeader('png', png(1, 1, { depth, color }), true)).toEqual(
      damaged('has an IHDR chunk no PNG has'),
    );
  });

  test.each([
    ['a compression', { compression: 1 }],
    ['a filter', { filter: 1 }],
    ['an interlace', { interlace: 2 }],
  ])('refuses %s no PNG has', (_what, fields) => {
    expect(imageHeader('png', png(1, 1, fields), true).kind).toBe('damaged');
  });

  test('refuses a size past 2^31 - 1, or of 0', () => {
    expect(imageHeader('png', png(0x80000000, 1), true).kind).toBe('damaged');
    expect(imageHeader('png', png(0, 1), true)).toEqual(damaged('has a width or a height of 0'));
    expect(imageHeader('png', png(1, 0), true)).toEqual(damaged('has a width or a height of 0'));
  });

  test('refuses an IHDR chunk whose checksum doesn’t match', () => {
    const bytes = png(10, 10);
    for (const at of [16, 19, 24, 28, 29, 32]) {
      const changed = bytes.slice();
      changed[at] = changed[at]! ^ 0x01;
      expect(imageHeader('png', changed, true), `byte ${at}`).toEqual(
        damaged("has an IHDR chunk that's been damaged"),
      );
    }
  });

  test('refuses another chunk first, or an IHDR of another length', () => {
    const other = join(PNG_SIGNATURE, chunk('CgBI', [0, 0, 0, 0]), png(1, 1).subarray(8));
    expect(imageHeader('png', other, true).kind).toBe('damaged');
    const longer = join(PNG_SIGNATURE, chunk('IHDR', new Uint8Array(14)));
    expect(imageHeader('png', longer, true).kind).toBe('damaged');
    const html = join(PNG_SIGNATURE, '<html><script>alert(1)</script></html>');
    expect(imageHeader('png', html, true)).toEqual(
      damaged("doesn't start with an IHDR chunk, which holds a PNG's size"),
    );
  });

  test('cut short anywhere in its header, it ends before its header does', () => {
    const bytes = png(10, 10);
    for (let length = 8; length < 33; length++) {
      const cut = bytes.subarray(0, length);
      expect(imageHeader('png', cut, true), `${length} bytes`).toEqual(
        damaged('ends before its header does'),
      );
      expect(imageHeader('png', cut, false), `${length} bytes of more`).toEqual({ kind: 'more' });
    }
    expect(imageHeader('png', bytes.subarray(0, 33), true)).toEqual(size(10, 10));
  });

  test('followed by HTML, is sized by its header alone', () => {
    const polyglot = join(png(1, 1).subarray(0, 33), '<html><script>alert(1)</script></html>');
    expect(imageHeader('png', polyglot, true)).toEqual(size(1, 1));
  });
});

describe('a JPEG', () => {
  test('is sized by its first frame header, past the segments before it', () => {
    expect(imageHeader('jpeg', jpeg(APP0, sof(640, 480)), true)).toEqual(size(640, 480));
    const exif = segment(0xe1, new Uint8Array(65_533));
    expect(imageHeader('jpeg', jpeg(APP0, exif, exif, sof(3, 2)), true)).toEqual(size(3, 2));
    expect(imageHeader('jpeg', jpeg(sof(1, 1), sof(9, 9)), true)).toEqual(size(1, 1));
  });

  test.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])(
    'takes frame header 0x%s',
    (marker) => {
      expect(imageHeader('jpeg', jpeg(sof(7, 5, marker)), true)).toEqual(size(7, 5));
    },
  );

  test('skips tables, and the markers that aren’t frame headers', () => {
    // A Huffman table, an arithmetic table and the reserved JPG marker, each shaped as a frame
    // header would be, to be skipped.
    const decoys = [0xc4, 0xc8, 0xcc].map((marker) => sof(60_000, 60_000, marker));
    expect(imageHeader('jpeg', jpeg(...decoys, sof(2, 3)), true)).toEqual(size(2, 3));
  });

  test('takes fill bytes before a marker, and markers that stand alone', () => {
    const bytes = jpeg([0xff, 0xff, 0xff], [0xff, 0xd0], [0xff, 0x01], sof(4, 4));
    expect(imageHeader('jpeg', bytes, true)).toEqual(size(4, 4));
  });

  test.each([
    [
      'image data first',
      jpeg(),
      "has no frame header, which holds a JPEG's size, before its image",
    ],
    [
      'the end first',
      join([0xff, 0xd8, 0xff, 0xd9], sof(1, 1)),
      "has no frame header, which holds a JPEG's size, before its image",
    ],
    ['a second start', jpeg([0xff, 0xd8], sof(1, 1)), 'has a marker no header has'],
    ['a stuffed zero', jpeg([0xff, 0x00], sof(1, 1)), 'has a marker no header has'],
    ['bytes between segments', jpeg([0x00], sof(1, 1)), "has bytes between its header's segments"],
    [
      'a segment shorter than its length',
      jpeg([0xff, 0xe0, 0, 1], sof(1, 1)),
      'has a segment shorter than its own length',
    ],
    [
      'a frame header too short',
      jpeg([0xff, 0xc0, 0, 7, 8, 0, 1, 0, 1]),
      'has a frame header too short to hold its size',
    ],
    [
      'a height left to later',
      jpeg(sof(1, 0)),
      "leaves its height to after its image, which Lo doesn't read",
    ],
    ['a width of 0', jpeg(sof(0, 1)), 'has a width or a height of 0'],
  ])('refuses %s', (_what, bytes, why) => {
    expect(imageHeader('jpeg', bytes, true)).toEqual(damaged(why));
  });

  test('with its frame header past the bytes, needs more', () => {
    const bytes = jpeg(APP0, segment(0xe1, new Uint8Array(10_000)), sof(5, 5));
    expect(imageHeader('jpeg', bytes.subarray(0, 4_096), false)).toEqual({ kind: 'more' });
    expect(imageHeader('jpeg', bytes.subarray(0, 4_096), true)).toEqual(
      damaged('ends before its header does'),
    );
    expect(imageHeader('jpeg', bytes, true)).toEqual(size(5, 5));
  });
});

describe('a GIF', () => {
  test('is sized by its screen and its first frame', () => {
    expect(imageHeader('gif', gif(24, 12, [frame(0, 0, 24, 12)]), true)).toEqual(size(24, 12));
    expect(imageHeader('gif', gif(24, 12, [frame(2, 2, 4, 4)]), true)).toEqual(size(24, 12));
    // A first frame past the screen grows it, as browsers grow it; later frames don't.
    expect(
      imageHeader('gif', gif(1, 1, [frame(10, 20, 30, 40), frame(0, 0, 9_000, 9_000)]), true),
    ).toEqual(size(40, 60));
    expect(imageHeader('gif', gif(0, 0, [frame(0, 0, 5, 6)]), true)).toEqual(size(5, 6));
    expect(imageHeader('gif', gif(1, 1, [frame(65_535, 65_535, 65_535, 65_535)]), true)).toEqual(
      size(131_070, 131_070),
    );
  });

  test('skips its color table and the extensions before its first frame', () => {
    const comment = extension(0xfe, encoder.encode('x'.repeat(1_000)));
    const loop = extension(0xff, encoder.encode('NETSCAPE2.0\u0001\u0000\u0000'), 11);
    const control = extension(0xf9, Uint8Array.from([0, 10, 0, 0]));
    for (const table of [0, 1, 8]) {
      const bytes = gif(16, 9, [loop, comment, control, frame(0, 0, 16, 9)], table);
      expect(imageHeader('gif', bytes, true), `a table of ${table} bits`).toEqual(size(16, 9));
    }
  });

  test.each([
    ['no frames', gif(10, 10, []), 'has no frames'],
    [
      'a block no GIF has',
      gif(10, 10, [[0x00], frame(0, 0, 1, 1)]),
      'has a block no GIF has before its first frame',
    ],
    ['a frame of no size', gif(0, 0, [frame(0, 0, 0, 0)]), 'has a width or a height of 0'],
  ])('refuses %s', (_what, bytes, why) => {
    expect(imageHeader('gif', bytes, true)).toEqual(damaged(why));
  });

  test('cut short before its first frame, ends before its header does', () => {
    const bytes = gif(10, 10, [extension(0xfe, new Uint8Array(600)), frame(0, 0, 10, 10)], 2);
    const end = bytes.length - 1 - 13;
    for (const length of [6, 9, 12, 20, 30, 100, 500, end]) {
      expect(imageHeader('gif', bytes.subarray(0, length), true), `${length} bytes`).toEqual(
        damaged('ends before its header does'),
      );
      expect(imageHeader('gif', bytes.subarray(0, length), false)).toEqual({ kind: 'more' });
    }
  });
});

describe('a WebP', () => {
  test('is sized by its first chunk', () => {
    expect(imageHeader('webp', vp8(16_383, 1), true)).toEqual(size(16_383, 1));
    expect(imageHeader('webp', vp8l(16_384, 16_384), true)).toEqual(size(16_384, 16_384));
    expect(imageHeader('webp', vp8x(16_777_216, 16_777_216), true)).toEqual(
      size(16_777_216, 16_777_216),
    );
  });

  test('takes only the 14 bits of a lossy size, without its scale', () => {
    const scaled = vp8(1, 1);
    scaled[27] = 0xc0;
    scaled[29] = 0x40;
    expect(imageHeader('webp', scaled, true)).toEqual(size(1, 1));
  });

  test.each([
    [
      'a frame that isn’t a key frame',
      vp8(1, 1, false),
      "starts with a frame that isn't a key frame",
    ],
    [
      'a key frame without its start code',
      (() => {
        const bytes = vp8(1, 1);
        bytes[24] = 0;
        return bytes;
      })(),
      'has a key frame with no start code',
    ],
    [
      'a lossless image without its signature',
      (() => {
        const bytes = vp8l(1, 1);
        bytes[20] = 0;
        return bytes;
      })(),
      'has a lossless image with no signature',
    ],
    [
      'a lossless image of another version',
      vp8l(1, 1, 1),
      "has a lossless image of a version Lo doesn't read",
    ],
    [
      'a VP8X chunk too short',
      webp('VP8X', [0, 0, 0, 0, 1, 0, 0, 1, 0, 0]).map((byte, at) => (at === 16 ? 9 : byte)),
      'has a VP8X chunk too short to hold its size',
    ],
    [
      'another chunk first',
      webp(
        'ALPH',
        Array.from({ length: 20 }, () => 0),
      ),
      "doesn't start with an image chunk, which holds a WebP's size",
    ],
    ['a lossy size of 0', vp8(0, 1), 'has a width or a height of 0'],
  ])('refuses %s', (_what, bytes, why) => {
    expect(imageHeader('webp', bytes, true)).toEqual(damaged(why));
  });

  test('cut short in its first chunk, ends before its header does', () => {
    for (const bytes of [vp8(1, 1), vp8l(1, 1), vp8x(1, 1)]) {
      for (let length = 12; length < 25; length++) {
        expect(imageHeader('webp', bytes.subarray(0, length), true)).toEqual(
          damaged('ends before its header does'),
        );
      }
    }
  });
});

/** A generator of the same numbers every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** What's wrong with `header`, read from bytes that were or weren't `whole`, if anything. */
function wrong(header: ImageHeader, whole: boolean): string | undefined {
  switch (header.kind) {
    case 'size':
      return [header.width, header.height].every((side) => Number.isSafeInteger(side) && side > 0)
        ? undefined
        : `a size of ${header.width} by ${header.height}`;
    case 'more':
      return whole ? 'more, from the whole file' : undefined;
    case 'damaged':
      return /^[a-z][\w ,.'-]+$/.test(header.why) ? undefined : `damaged, as ${header.why}`;
    default:
      header satisfies never;
      return `an answer of another kind: ${JSON.stringify(header)}`;
  }
}

describe('any bytes at all', () => {
  test.each(['png', 'jpeg', 'gif', 'webp'] as const)(
    'read as a %s, give an answer and never throw',
    (type: ImageType) => {
      const next = random(type.length);
      const starts: Record<ImageType, Uint8Array> = {
        png: png(1, 1).subarray(0, 16),
        jpeg: Uint8Array.from([0xff, 0xd8, 0xff]),
        gif: encoder.encode('GIF89a'),
        webp: join('RIFF', u32le(0), 'WEBP'),
      };
      const problems: string[] = [];
      for (let n = 0; n < 2_000; n++) {
        const bytes = join(
          starts[type],
          Array.from({ length: Math.floor(next() * 64) }, () => Math.floor(next() * 256)),
        );
        for (const whole of [true, false]) {
          const problem = wrong(imageHeader(type, bytes, whole), whole);
          if (problem !== undefined) problems.push(`${n}: ${problem}`);
        }
      }
      expect(problems).toEqual([]);
    },
  );
});

describe('reading a header takes time in proportion to its bytes', () => {
  /**
   * How long each may take, in milliseconds: each walks 10 MiB, the most an image may be, which
   * takes under 100 ms on a laptop. A CI runner is some five times slower, and three times that is
   * the margin.
   */
  const BUDGET = 1_500;
  const MIB = 1024 * 1024;

  test.each([
    [
      'a JPEG of 10 MiB of fill bytes',
      () => join([0xff, 0xd8], new Uint8Array(10 * MIB).fill(0xff)),
    ],
    [
      'a JPEG of 10 MiB of the shortest segments',
      () => {
        const bytes = new Uint8Array(2 + 4 * Math.floor((10 * MIB - 2) / 4));
        bytes.set([0xff, 0xd8]);
        for (let at = 2; at + 4 <= bytes.length; at += 4) bytes.set([0xff, 0xe0, 0, 2], at);
        return bytes;
      },
    ],
    [
      'a GIF of 10 MiB of the shortest blocks',
      () => {
        const bytes = new Uint8Array(10 * MIB);
        bytes.set(gif(1, 1, []).subarray(0, 13));
        bytes.set([0x21, 0xfe], 13);
        for (let at = 15; at + 2 <= bytes.length; at += 2) bytes.set([1, 0x78], at);
        return bytes;
      },
    ],
  ])('%s', (_what, make) => {
    const bytes = make();
    const started = performance.now();
    const header = imageHeader(bytes[0] === 0xff ? 'jpeg' : 'gif', bytes, true);
    const elapsed = performance.now() - started;
    expect(header).toEqual(damaged('ends before its header does'));
    expect(elapsed, `took ${elapsed} ms`).toBeLessThan(BUDGET);
  });
});
