import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  APP0,
  chunk,
  exifSegment,
  gif,
  frame,
  jpeg,
  join,
  orientation,
  png,
  pngWith,
  segment,
  sof,
  tiff,
  vp8x,
} from '../test/images.ts';
import { imageHeader } from './images.ts';
import { imageOrientation, isTurned, type Orientation } from './orientation.ts';

const ALL: Orientation[] = [1, 2, 3, 4, 5, 6, 7, 8];
const LONG = 4;

/** A JPEG whose one Exif segment holds `entries`. */
function jpegWith(...entries: Parameters<typeof tiff>[0]): Uint8Array {
  return jpeg(APP0, exifSegment(tiff(entries)), sof(40, 20));
}

describe('a JPEG', () => {
  test.each(ALL)('is drawn in orientation %i, in either byte order', (value) => {
    for (const little of [false, true]) {
      const bytes = jpeg(exifSegment(tiff([orientation(value)], { little })), sof(40, 20));
      expect(imageOrientation(bytes)).toBe(value);
    }
  });

  test('without Exif data, is drawn as stored', () => {
    expect(imageOrientation(jpeg(APP0, sof(40, 20)))).toBe(1);
  });

  test('takes its first Exif segment, whatever comes before it, and only that one', () => {
    const xmp = segment(0xe1, join('http://ns.adobe.com/xap/1.0/', [0], '<x/>'));
    const six = exifSegment(tiff([orientation(6)]));
    expect(imageOrientation(jpeg(APP0, xmp, six, sof(40, 20)))).toBe(6);
    // The first holds no orientation, or can't be read: a later one doesn't count.
    const none = exifSegment(tiff([[0x010f, 2, 1, 0x41]]));
    expect(imageOrientation(jpeg(none, six, sof(40, 20)))).toBe(1);
    expect(imageOrientation(jpeg(exifSegment(join('I')), six, sof(40, 20)))).toBe(1);
  });

  test('reads Exif data after its frame header, but never after its image data starts', () => {
    const six = exifSegment(tiff([orientation(6)]));
    expect(imageOrientation(jpeg(sof(40, 20), six))).toBe(6);
    const after = join([0xff, 0xd8], sof(40, 20), [0xff, 0xda, 0, 2], six, [0xff, 0xd9]);
    expect(imageOrientation(after)).toBe(1);
  });

  test('skips the bytes libjpeg skips between segments (jpeg-sof-junk-then-o6)', () => {
    const six = exifSegment(tiff([orientation(6)]));
    const bytes = jpeg(sof(40, 20), [0x00, 0x12], six);
    // The check reads its size from its frame header, and stops there, so it's kept.
    expect(imageHeader('jpeg', bytes, true)).toEqual({ kind: 'size', width: 40, height: 20 });
    expect(imageOrientation(bytes)).toBe(6);
    // 0xFF 0x00, bytes around 0xFF runs, and many bytes, as Chromium turns each.
    expect(imageOrientation(jpeg(sof(40, 20), [0xff, 0x00], six))).toBe(6);
    expect(imageOrientation(jpeg(sof(40, 20), [0x41, 0xff, 0xff, 0x00, 0x42], six))).toBe(6);
    expect(imageOrientation(jpeg(sof(40, 20), new Uint8Array(1_000).fill(0x37), six))).toBe(6);
    expect(imageOrientation(jpeg(APP0, [0x12], six, sof(40, 20)))).toBe(6);
  });

  test('reads only an APP1 segment that starts Exif\\0\\0', () => {
    const data = tiff([orientation(6)]);
    expect(imageOrientation(jpeg(segment(0xe2, join('Exif', [0, 0], data)), sof(1, 1)))).toBe(1);
    expect(imageOrientation(jpeg(segment(0xe1, join('exif', [0, 0], data)), sof(1, 1)))).toBe(1);
    expect(imageOrientation(jpeg(segment(0xe1, data), sof(1, 1)))).toBe(1);
  });

  test('takes the first entry that is an orientation: one short, from 1 to 8', () => {
    expect(imageOrientation(jpegWith(orientation(6), orientation(1)))).toBe(6);
    expect(imageOrientation(jpegWith(orientation(1), orientation(6)))).toBe(1);
    expect(imageOrientation(jpegWith([0x010f, 2, 1, 0x41], orientation(8)))).toBe(8);
    for (const wrong of [
      [0x0112, LONG, 1, 6],
      [0x0112, 3, 2, 6],
      orientation(0),
      orientation(9),
      orientation(0xffff),
    ] as const) {
      expect(imageOrientation(jpegWith(wrong))).toBe(1);
      expect(imageOrientation(jpegWith(wrong, orientation(7)))).toBe(7);
    }
  });

  test('finds its directory where the TIFF data says', () => {
    const bytes = jpeg(exifSegment(tiff([orientation(5)], { directory: 40 })), sof(1, 1));
    expect(imageOrientation(bytes)).toBe(5);
  });

  test('with TIFF data cut short, or of no byte order TIFF has, is drawn as stored', () => {
    const whole = tiff([orientation(6)]);
    // Up to its entry's end, with no next directory, it's whole enough.
    for (let length = 0; length < 22; length++) {
      expect(imageOrientation(jpeg(exifSegment(whole.subarray(0, length)), sof(1, 1)))).toBe(1);
    }
    expect(imageOrientation(jpeg(exifSegment(whole.subarray(0, 22)), sof(1, 1)))).toBe(6);
    const wrong = Uint8Array.from(whole);
    wrong[0] = 0x4e;
    expect(imageOrientation(jpeg(exifSegment(wrong), sof(1, 1)))).toBe(1);
    const magic = Uint8Array.from(whole);
    magic[3] = 43;
    expect(imageOrientation(jpeg(exifSegment(magic), sof(1, 1)))).toBe(1);
    const far = jpeg(
      exifSegment(tiff([orientation(6)], { directory: 8 }).with(7, 0xff)),
      sof(1, 1),
    );
    expect(imageOrientation(far)).toBe(1);
  });

  test('cut short anywhere, is drawn as stored or as its Exif data says, and never throws', () => {
    const bytes = jpeg(APP0, exifSegment(tiff([orientation(6)])), sof(40, 20));
    for (let length = 0; length <= bytes.length; length++) {
      expect([1, 6]).toContain(imageOrientation(bytes.subarray(0, length)));
    }
  });
});

/** A PNG's Exif chunk, holding `data`. */
function eXIf(data: Uint8Array): Uint8Array {
  return chunk('eXIf', data);
}

describe('a PNG', () => {
  test.each(ALL)('is drawn in orientation %i, in either byte order', (value) => {
    for (const little of [false, true]) {
      const bytes = pngWith(40, 20, eXIf(tiff([orientation(value)], { little })));
      expect(imageOrientation(bytes)).toBe(value);
    }
  });

  test('without an eXIf chunk, is drawn as stored', () => {
    expect(imageOrientation(png(40, 20))).toBe(1);
  });

  test('reads eXIf only before its image data', () => {
    const six = eXIf(tiff([orientation(6)]));
    const whole = pngWith(40, 20);
    const after = join(whole.subarray(0, whole.length - 12), six, chunk('IEND', []));
    expect(imageOrientation(after)).toBe(1);
  });

  test('takes the first eXIf chunk whose checksum matches', () => {
    const six = eXIf(tiff([orientation(6)]));
    const one = eXIf(tiff([orientation(1)]));
    const damaged = Uint8Array.from(six).with(six.length - 1, six.at(-1)! ^ 1);
    expect(imageOrientation(pngWith(40, 20, one, six))).toBe(1);
    expect(imageOrientation(pngWith(40, 20, six, one))).toBe(6);
    expect(imageOrientation(pngWith(40, 20, damaged))).toBe(1);
    expect(imageOrientation(pngWith(40, 20, damaged, six))).toBe(6);
  });

  test('holds TIFF data alone, with nothing before it', () => {
    const prefixed = eXIf(join('Exif', [0, 0], tiff([orientation(6)])));
    expect(imageOrientation(pngWith(40, 20, prefixed))).toBe(1);
  });

  test('cut short anywhere, never throws', () => {
    const bytes = pngWith(40, 20, chunk('tEXt', join('a', [0], 'b')), eXIf(tiff([orientation(8)])));
    for (let length = 0; length <= bytes.length; length++) {
      expect([1, 8]).toContain(imageOrientation(bytes.subarray(0, length)));
    }
  });

  test('takes a chunk’s length as it is, however large', () => {
    const huge = join(png(1, 1).subarray(0, 33), [0xff, 0xff, 0xff, 0xff], 'tEXt');
    expect(imageOrientation(huge)).toBe(1);
  });
});

describe('other images', () => {
  test('a WebP’s Exif data and a GIF don’t turn it', () => {
    const exif = tiff([orientation(6)]);
    const webp = join(vp8x(40, 20), 'EXIF', [exif.length, 0, 0, 0], exif);
    expect(imageOrientation(webp)).toBe(1);
    expect(imageOrientation(gif(40, 20, [frame(0, 0, 40, 20)]))).toBe(1);
    expect(imageOrientation(new Uint8Array())).toBe(1);
    expect(imageOrientation(join('<svg>', exif))).toBe(1);
  });

  test('the fixtures’ JPEGs, whose Exif data holds no orientation, are drawn as stored', () => {
    const folder = new URL(
      '../../../../testing/fixtures/artifacts/valid/figures/figures/',
      import.meta.url,
    );
    for (const name of ['photo.jpg', 'banner.jpeg', 'shot.png']) {
      expect(imageOrientation(readFileSync(new URL(name, folder)))).toBe(1);
    }
  });
});

describe('isTurned', () => {
  test('is true for the orientations that trade width and height', () => {
    expect(ALL.filter(isTurned)).toEqual([5, 6, 7, 8]);
  });
});

describe('any bytes at all', () => {
  test('give an orientation, in time in proportion to their length', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed;
    };
    for (let round = 0; round < 2_000; round++) {
      const body = Uint8Array.from({ length: random() % 64 }, () => random() % 256);
      for (const start of [
        [0xff, 0xd8, 0xff],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ]) {
        expect(ALL).toContain(imageOrientation(join(start, body)));
      }
    }
    // Many segments, and a directory claiming many entries, are walked once each.
    const one = segment(0xe2, [0, 0, 0, 0]);
    const many = new Uint8Array(one.length * 100_000);
    for (let at = 0; at < many.length; at += one.length) many.set(one, at);
    const directory = join('MM', [0, 42, 0, 0, 0, 8, 0xff, 0xff], new Uint8Array(12 * 0xffff));
    const started = performance.now();
    expect(imageOrientation(jpeg(many, exifSegment(tiff([orientation(3)])), sof(1, 1)))).toBe(3);
    expect(imageOrientation(pngWith(1, 1, chunk('eXIf', directory)))).toBe(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
