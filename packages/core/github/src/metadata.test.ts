import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';

import { expect, test } from 'vitest';

import type { AttachmentKind } from './attachments.ts';
import {
  crc32,
  describeMetadata,
  MAX_BOX_DEPTH,
  readExif,
  stripMetadata,
  UnreadableMetadata,
} from './metadata.ts';

// Bytes.

function hex(lines: readonly string[]): Uint8Array {
  return new Uint8Array(Buffer.from(lines.join(''), 'hex'));
}

/** `text`'s characters as bytes, one each. */
function latin1(characters: string): Uint8Array {
  return Uint8Array.from(characters, (character) => character.charCodeAt(0));
}

function of(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function zeros(length: number): Uint8Array {
  return new Uint8Array(length);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

function be16(value: number): Uint8Array {
  const out = zeros(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function be32(value: number): Uint8Array {
  const out = zeros(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function le32(value: number): Uint8Array {
  const out = zeros(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u16(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at);
}

function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
}

function text(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Where `needle` first is in `bytes` from `from` on, or -1. */
function indexOf(bytes: Uint8Array, needle: Uint8Array, from = 0): number {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(needle, from);
}

function contains(bytes: Uint8Array, needle: Uint8Array): boolean {
  return indexOf(bytes, needle) !== -1;
}

/** How many times `needle` is in `bytes`. */
function count(bytes: Uint8Array, needle: Uint8Array): number {
  let found = 0;
  for (let at = indexOf(bytes, needle); at !== -1; at = indexOf(bytes, needle, at + 1)) found++;
  return found;
}

const EXIF_HEADER = latin1('Exif\0\0');

/** `VP8X`'s flags for EXIF and XMP. */
const WEBP_EXIF = 0x08;
const WEBP_XMP = 0x04;

// EXIF and where a file was.

/**
 * A TIFF structure, big-endian, with `orientation` and, when `gps`, a GPS IFD holding a latitude
 * reference, as a phone's photo has.
 */
function exif(orientation: number, gps: boolean): Uint8Array {
  const entries = gps ? 3 : 2;
  const gpsAt = 8 + 2 + 12 * entries + 4;
  return concat(
    latin1('MM\0*'),
    be32(8),
    be16(entries),
    // Make: "Lo", inline.
    be16(0x010f),
    be16(2),
    be32(3),
    latin1('Lo\0\0'),
    be16(0x0112),
    be16(3),
    be32(1),
    be16(orientation),
    zeros(2),
    ...(gps ? [be16(0x8825), be16(4), be32(1), be32(gpsAt)] : []),
    be32(0),
    // GPSLatitudeRef "N".
    ...(gps ? [be16(1), be16(0x0001), be16(2), be32(2), latin1('N\0\0\0'), be32(0)] : []),
  );
}

/** The GPS IFD {@link exif} writes when asked for one, which no stripped file may hold. */
function gpsIfd(): Uint8Array {
  return exif(1, true).slice(-18);
}

/** EXIF's TIFF structure holding only `orientation`, as Lo writes it back. */
function orientationOnly(orientation: number): Uint8Array {
  return concat(
    latin1('MM\0*'),
    be32(8),
    be16(1),
    be16(0x0112),
    be16(3),
    be32(1),
    be16(orientation),
    zeros(2),
    be32(0),
  );
}

/** Where a photo or a video was, as fixtures write it in XMP and ISO 6709. */
const COORDINATES = ['48,51.29N', '+37.3349-122.0090', '+010.000/'];

/** The XMP fixtures write: a latitude, in a packet. */
const XMP_GPS = latin1('<x:xmpmeta><exif:GPSLatitude>48,51.29N</exif:GPSLatitude></x:xmpmeta>');

/**
 * Expects none of `needles` anywhere in `bytes`: what a stripper removed must be gone from the
 * file, not renamed and kept.
 */
function expectGone(bytes: Uint8Array, needles: readonly Uint8Array[]): void {
  const stayed = needles.filter((needle) => contains(bytes, needle));
  expect(stayed.map((needle) => text(needle, 0, needle.length))).toEqual([]);
}

/** Expects everything a location fixture holds, the GPS IFD among it, gone from `bytes`. */
function expectNoLocation(bytes: Uint8Array): void {
  expectGone(bytes, [
    ...COORDINATES.map(latin1),
    gpsIfd(),
    latin1('GPSLatitude'),
    latin1('xmpmeta'),
  ]);
}

/** Whether stripping `bytes`, a file of `kind`, refuses it because Lo can't read through it. */
function refuses(kind: AttachmentKind, bytes: Uint8Array): boolean {
  try {
    stripMetadata(kind, bytes);
    return false;
  } catch (error) {
    if (error instanceof UnreadableMetadata) return true;
    throw error;
  }
}

// JPEG.

/** A 2×2 red JPEG, as an encoder writes it: SOI, JFIF's APP0, then its tables and its scan. */
const JPEG = hex([
  'ffd8ffe000104a46494600010200000100010000ffc00011080002000203011100021101031101ffdb004300',
  '080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c',
  '2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232',
  '3232323232323232323232323232323232323232323232323232323232323232323232323232323232323232',
  '32ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303',
  '020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f024',
  '33627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a63646566',
  '6768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7',
  'b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc400',
  '1f0100030101010101010101010000000000000102030405060708090a0bffc400b511000201020404030407',
  '05040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a',
  '162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a63646566676869',
  '6a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9',
  'bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c030100',
  '02110311003f00e42bc53f4c3fffd9',
]);

/** A 2×2 JPEG with `segments` after its JFIF header, and `trailing` after its end. */
function jpegWith(segments: [number, Uint8Array][], trailing = zeros(0)): Uint8Array {
  const app0End = 4 + u16(JPEG, 4);
  return concat(
    JPEG.subarray(0, app0End),
    ...segments.flatMap(([marker, payload]) => [
      of(0xff, marker),
      be16(payload.length + 2),
      payload,
    ]),
    JPEG.subarray(app0End),
    trailing,
  );
}

function exifSegment(orientation: number, gps: boolean): [number, Uint8Array] {
  return [0xe1, concat(EXIF_HEADER, exif(orientation, gps))];
}

/** The markers of `jpeg`'s segments, up to its first scan. */
function markers(jpeg: Uint8Array): number[] {
  const found: number[] = [];
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1] ?? 0;
    found.push(marker);
    if (marker === 0xda) break;
    at += 2 + u16(jpeg, at + 2);
  }
  return found;
}

/**
 * The width and height `jpeg`'s frame gives, read as a decoder reads the file: every segment in
 * place from its start to its end, with tables and a frame before a scan, and each scan's data
 * running to the next marker. Throws when it doesn't read through.
 */
function readJpeg(jpeg: Uint8Array): { width: number; height: number } {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('it has no start of image');
  let at = 2;
  let frame: { width: number; height: number } | undefined;
  const tables = new Set<number>();
  for (;;) {
    if (jpeg[at] !== 0xff) throw new Error(`there's no marker at ${at}`);
    while (jpeg[at] === 0xff) at++;
    const marker = jpeg[at++];
    if (marker === undefined) throw new Error('it ends before its end of image');
    if (marker === 0xd9) break;
    const length = u16(jpeg, at);
    if (length < 2 || at + length > jpeg.length) throw new Error(`a segment runs past the end`);
    if (marker === 0xc0) frame = { height: u16(jpeg, at + 3), width: u16(jpeg, at + 5) };
    if (marker === 0xdb || marker === 0xc4) tables.add(marker);
    at += length;
    if (marker !== 0xda) continue;
    if (!frame || !tables.has(0xdb) || !tables.has(0xc4)) {
      throw new Error('a scan comes before its frame and tables');
    }
    for (;;) {
      at = jpeg.indexOf(0xff, at);
      const following = at === -1 ? undefined : jpeg[at + 1];
      if (following === undefined) throw new Error('a scan runs past the end');
      if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) at += 2;
      else if (following === 0xff) at += 1;
      else break;
    }
  }
  if (!frame) throw new Error('it has no frame');
  return frame;
}

/** `bytes` from their first scan on: a JPEG's pixels' data, after its headers. */
function fromFirstScan(bytes: Uint8Array): Uint8Array {
  return bytes.subarray(indexOf(bytes, of(0xff, 0xda)));
}

test('a photos location and camera go and its pixels stay', () => {
  const xmp = concat(latin1('http://ns.adobe.com/xap/1.0/\0'), XMP_GPS);
  const photo = jpegWith([
    exifSegment(1, true),
    [0xe1, xmp],
    [0xed, latin1('Photoshop 3.0\0IPTC')],
    [0xfe, latin1('a comment')],
    [0xe2, latin1('ICC_PROFILE\0\x01\x01profile')],
  ]);
  const { bytes: stripped, metadata } = stripMetadata('jpeg', photo);
  expect(metadata).toEqual({
    kind: 'image',
    removed: { location: true, other: true, embedded: false },
  });
  expect(describeMetadata(metadata)).toBe('removed its location and other metadata');
  // JFIF and the colour profile stay; EXIF, XMP, IPTC and the comment go.
  const kept = markers(stripped);
  expect(kept[0]).toBe(0xe0);
  expect(kept).toContain(0xe2);
  expect(kept.filter((marker) => [0xe1, 0xed, 0xfe].includes(marker))).toEqual([]);
  expectNoLocation(stripped);
  expectGone(stripped, [latin1('Exif'), latin1('IPTC'), latin1('a comment')]);
  expect(readJpeg(stripped)).toEqual(readJpeg(photo));
  // The pixels' data, after the headers, is the same.
  expect(fromFirstScan(stripped)).toEqual(fromFirstScan(photo));
});

test('a turned photo keeps its orientation alone', () => {
  const photo = jpegWith([exifSegment(6, false)]);
  const { bytes: stripped, metadata } = stripMetadata('jpeg', photo);
  expect(describeMetadata(metadata)).toBe('removed its metadata (no location in it)');
  const at = indexOf(stripped, EXIF_HEADER);
  const found = readExif(stripped.subarray(at + 6));
  expect(found.orientation).toBe(6);
  expect(found.gps).toBe(false);
  // The orientation alone: the make went.
  expect([...stripped.subarray(at + 6 + 8, at + 6 + 10)]).toEqual([0, 1]);
  // Right after JFIF.
  expect(markers(stripped).slice(0, 2)).toEqual([0xe0, 0xe1]);
  expect(readJpeg(stripped)).toEqual(readJpeg(photo));
});

test('images stored after the picture go with it', () => {
  const gainMap = jpegWith([exifSegment(1, true)]);
  const photo = jpegWith([[0xe2, latin1('MPF\0index')]], gainMap);
  const { bytes: stripped, metadata } = stripMetadata('jpeg', photo);
  expect(metadata).toEqual({
    kind: 'image',
    removed: { location: false, other: true, embedded: true },
  });
  expect(count(stripped, of(0xff, 0xd8))).toBe(1);
  expect([...stripped.subarray(-2)]).toEqual([0xff, 0xd9]);
  expectNoLocation(stripped);
  expect(readJpeg(stripped)).toEqual({ width: 2, height: 2 });
});

test('a plain jpeg comes back as it was', () => {
  const plain = jpegWith([]);
  const { bytes: stripped, metadata } = stripMetadata('jpeg', plain);
  expect(stripped).toEqual(plain);
  expect(describeMetadata(metadata)).toBe('no metadata to remove');
});

test('a broken jpeg isnt sent', () => {
  const broken = jpegWith([exifSegment(1, true)]).subarray(0, 30);
  expect(() => stripMetadata('jpeg', broken)).toThrow(UnreadableMetadata);
  expect(() => stripMetadata('jpeg', latin1('not a jpeg'))).toThrow(UnreadableMetadata);
});

// PNG.

/** A 3×2 green PNG, as an encoder writes it: its signature, IHDR, one IDAT and IEND. */
const PNG = hex([
  '89504e470d0a1a0a0000000d49484452000000030000000208060000009d74661a0000002549444154780101',
  '1a00e5ff000ac81eff0ac81eff0ac81eff000ac81eff0ac81eff0ac81eff904d0b9b22652228000000004945',
  '4e44ae426082',
]);

/** The PNG with `chunks` inserted after IHDR. */
function pngWith(chunks: [string, Uint8Array][]): Uint8Array {
  const ihdrEnd = 8 + 12 + 13;
  return concat(
    PNG.subarray(0, ihdrEnd),
    ...chunks.flatMap(([type, data]) => {
      const typed = concat(latin1(type), data);
      return [be32(data.length), typed, be32(zlibCrc32(typed))];
    }),
    PNG.subarray(ihdrEnd),
  );
}

function pngChunks(png: Uint8Array): string[] {
  const types: string[] = [];
  for (let at = 8; at + 8 <= png.length; at += 12 + u32(png, at)) {
    types.push(text(png, at + 4, at + 8));
  }
  return types;
}

/**
 * `png` decoded, as a decoder reads it: every chunk's CRC checked, a critical chunk it doesn't know
 * refused, and its 8-bit RGB or RGBA pixels inflated and unfiltered.
 */
function decodePng(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  if (!contains(png.subarray(0, 8), PNG.subarray(0, 8))) throw new Error('it has no signature');
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; ;) {
    const length = u32(png, at);
    const type = text(png, at + 4, at + 8);
    if (zlibCrc32(png.subarray(at + 4, at + 8 + length)) !== u32(png, at + 8 + length)) {
      throw new Error(`${type}'s CRC is wrong`);
    }
    const chunk = png.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IEND') break;
    if (type === 'IHDR') {
      [width, height] = [u32(chunk, 0), u32(chunk, 4)];
      channels = chunk[9] === 6 ? 4 : 3;
      if (chunk[8] !== 8 || ![2, 6].includes(chunk[9] ?? 0) || chunk[12] !== 0) {
        throw new Error("its pixels aren't 8-bit RGB or RGBA");
      }
    } else if (type === 'IDAT') {
      data.push(chunk);
    } else if (/^[A-Z]/.test(type)) {
      throw new Error(`it holds a critical chunk ${type}`);
    }
  }
  const raw = new Uint8Array(inflateSync(concat(...data)));
  const stride = width * channels;
  const pixels = zeros(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)] ?? -1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[row * stride + x - channels] ?? 0) : 0;
      const up = row > 0 ? (pixels[(row - 1) * stride + x] ?? 0) : 0;
      const corner =
        x >= channels && row > 0 ? (pixels[(row - 1) * stride + x - channels] ?? 0) : 0;
      const value = raw[row * (stride + 1) + 1 + x] ?? 0;
      pixels[row * stride + x] = value + predict(filter, left, up, corner);
    }
  }
  return { width, height, pixels };
}

/** What a PNG row's `filter` adds to each byte, from the bytes left of it, above it and above left. */
function predict(filter: number, left: number, up: number, corner: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const estimate = left + up - corner;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toCorner = Math.abs(estimate - corner);
      if (toLeft <= toUp && toLeft <= toCorner) return left;
      return toUp <= toCorner ? up : corner;
    }
    default:
      throw new Error(`a row has filter ${filter}`);
  }
}

test('a screenshots text and exif go and its colour stays', () => {
  // What macOS writes into a screenshot: sRGB, EXIF, the pixel density, XMP and iDOT.
  const xmp = latin1('XML:com.adobe.xmp\0\0\0\0\0<exif:UserComment>Screenshot</exif:UserComment>');
  const screenshot = pngWith([
    ['sRGB', of(0)],
    ['eXIf', exif(1, false)],
    ['pHYs', of(0, 0, 22, 37, 0, 0, 22, 37, 1)],
    ['iTXt', xmp],
    ['iDOT', zeros(28)],
  ]);
  const { bytes: stripped, metadata } = stripMetadata('png', screenshot);
  expect(describeMetadata(metadata)).toBe('removed its metadata (no location in it)');
  expect(pngChunks(stripped)).toEqual(['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  expectGone(stripped, ['Screenshot', 'com.adobe.xmp', 'eXIf', 'iDOT'].map(latin1));
  // The same size, and the same pixels.
  expect(decodePng(stripped)).toEqual(decodePng(screenshot));
});

test('a pngs location goes and its orientation stays', () => {
  const xmp = concat(latin1('XML:com.adobe.xmp\0\0\0\0\0'), XMP_GPS);
  const photo = pngWith([
    ['eXIf', exif(3, true)],
    ['iTXt', xmp],
  ]);
  const { bytes: stripped, metadata } = stripMetadata('png', photo);
  expect(describeMetadata(metadata)).toBe('removed its location and other metadata');
  expect(pngChunks(stripped)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
  const at = indexOf(stripped, latin1('eXIf'));
  const found = readExif(stripped.subarray(at + 4));
  expect(found.orientation).toBe(3);
  expect(found.gps).toBe(false);
  expectNoLocation(stripped);
  // Its CRC is right: the decoder checks it.
  expect(decodePng(stripped)).toEqual(decodePng(photo));
});

// WebP.

function webpWith(extra: [string, Uint8Array][], flags: number): Uint8Array {
  const body = concat(
    latin1('VP8X'),
    le32(10),
    of(flags, 0, 0, 0, 1, 0, 0, 1, 0, 0),
    latin1('VP8L'),
    le32(5),
    of(0x2f, 1, 2, 3, 4, 0),
    ...extra.map(([type, data]) =>
      concat(latin1(type), le32(data.length), data, zeros(data.length % 2)),
    ),
  );
  return concat(latin1('RIFF'), le32(4 + body.length), latin1('WEBP'), body);
}

test('a webps exif and xmp go and vp8x stops naming them', () => {
  const photo = webpWith(
    [
      ['EXIF', exif(1, true)],
      ['XMP ', XMP_GPS],
    ],
    WEBP_EXIF | WEBP_XMP,
  );
  const { bytes: stripped, metadata } = stripMetadata('webp', photo);
  expectNoLocation(stripped);
  expect(describeMetadata(metadata)).toBe('removed its location and other metadata');
  expect(stripped).toEqual(webpWith([], 0));
});

test('a turned webp keeps its orientation', () => {
  const photo = webpWith([['EXIF', exif(8, false)]], WEBP_EXIF);
  const { bytes: stripped } = stripMetadata('webp', photo);
  expect(stripped).toEqual(webpWith([['EXIF', orientationOnly(8)]], WEBP_EXIF));
});

// MP4 and MOV.

/** QuickTime's location in a user data box: `©xyz`. */
const XYZ = '©xyz';

/** The `uuid` box XMP is kept in at a file's top level. */
const XMP_UUID = hex(['be7acfcb97a942e89c71999491e3afac']);

/** A box of `type`, holding `content`. */
function box(type: string | Uint8Array, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content);
  return concat(be32(body.length + 8), typeof type === 'string' ? latin1(type) : type, body);
}

/** An Apple metadata item's value: a `data` box holding UTF-8 `value`. */
function dataValue(value: string): Uint8Array {
  return box('data', of(0, 0, 0, 1, 0, 0, 0, 0), latin1(value));
}

/**
 * A MOV as an iPhone writes it: `ftyp`, `mdat`, then `moov` with a QuickTime `meta` whose keys
 * name its make and its location, and a `udta` with `©xyz`.
 */
function iphoneMov(): Uint8Array {
  const keys = box(
    'keys',
    zeros(4),
    be32(2),
    box('mdta', latin1('com.apple.quicktime.make')),
    box('mdta', latin1('com.apple.quicktime.location.ISO6709')),
  );
  const ilst = box(
    'ilst',
    box(be32(1), dataValue('Apple')),
    box(be32(2), dataValue('+37.3349-122.0090+010.000/')),
  );
  const meta = box('meta', box('hdlr', zeros(25)), keys, ilst);
  const udta = box('udta', box(XYZ, latin1('\0\x11\0\0+37.3349-122.0090/')));
  const ftyp = box('ftyp', latin1('qt  \0\0\0\0qt  '));
  // The video's one sample, in `mdat`, which its track's `stco` points at.
  const sampleAt = ftyp.length + 8;
  const stco = box('stco', of(0, 0, 0, 0, 0, 0, 0, 1), be32(sampleAt));
  const stsd = box('stsd', of(0, 0, 0, 0, 0, 0, 0, 1), box('avc1', zeros(70)));
  const stbl = box('stbl', stsd, stco);
  const videoHdlr = box('hdlr', zeros(8), latin1('vide'), zeros(12));
  const mdia = box('mdia', videoHdlr, box('minf', stbl));
  const trak = box('trak', box('tkhd', zeros(84)), mdia);
  const moov = box('moov', box('mvhd', zeros(100)), trak, meta, udta);
  return concat(ftyp, box('mdat', zeros(64).fill(7)), moov);
}

/** A box's offset, size and type. */
type Placed = [at: number, size: number, type: string];

const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'ilst', 'meta'];

/** Every box `bytes` hold, where readers look for them. */
function layout(bytes: Uint8Array, start = 0, end = bytes.length): Placed[] {
  const found: Placed[] = [];
  for (let at = start; at + 8 <= end;) {
    const size = u32(bytes, at);
    const type = text(bytes, at + 4, at + 8);
    if (size < 8 || at + size > end) throw new Error(`the ${type} box at ${at} doesn't fit`);
    found.push([at, size, type]);
    if (CONTAINERS.includes(type)) found.push(...layout(bytes, at + 8, at + size));
    at += size;
  }
  return found;
}

/** The sample offsets the first `stco` holds. */
function sampleOffsets(bytes: Uint8Array): number[] {
  const [at, size] = layout(bytes).find(([, , type]) => type === 'stco') ?? [0, 0];
  return Array.from({ length: u32(bytes, at + 12) }, (_, index) => {
    const entry = at + 16 + 4 * index;
    if (entry + 4 > at + size) throw new Error('an offset runs past its box');
    return u32(bytes, entry);
  });
}

test('where a video was filmed goes and nothing moves', () => {
  const video = iphoneMov();
  const { bytes: stripped, metadata } = stripMetadata('mov', video);
  expect(describeMetadata(metadata)).toBe(
    'removed where it was filmed; other video metadata, such as when it was filmed and on what, stays',
  );
  // The coordinates, as `©xyz` and Apple's ISO 6709 value held them, are gone from the file; the
  // make stays.
  expectNoLocation(stripped);
  expect(contains(stripped, latin1('Apple'))).toBe(true);
  expect(contains(stripped, latin1(XYZ))).toBe(false);
  // Nothing moved: every box is where it was, of the same size, the two that held the location
  // now `free`; the samples are where the track says, and are the same.
  const [before, after] = [layout(video), layout(stripped)];
  expect(after.map(([at, size]) => [at, size])).toEqual(before.map(([at, size]) => [at, size]));
  const changed = after.filter(([, , type], index) => type !== before[index]?.[2]);
  expect(changed.map(([, , type]) => type)).toEqual(['free', 'free']);
  expect(sampleOffsets(stripped)).toEqual(sampleOffsets(video));
  const sample = sampleOffsets(video)[0] ?? 0;
  expect(stripped.subarray(sample, sample + 64)).toEqual(video.subarray(sample, sample + 64));
});

test('a video without a location is left alone', () => {
  const video = concat(
    box('ftyp', latin1('isom\0\0\0\0isom')),
    box('moov', box('mvhd', zeros(100))),
  );
  const { bytes: stripped, metadata } = stripMetadata('mp4', video);
  expect(stripped).toEqual(video);
  expect(metadata).toEqual({
    kind: 'video',
    removed: { location: false, other: false, embedded: false },
  });
  // It never says there was nothing to remove: Lo keeps a video's other metadata.
  expect(describeMetadata(metadata)).toBe(
    'no location found where QuickTime, Apple, 3GPP or XMP keep one; other video metadata, such as when it was filmed and on what, stays',
  );
});

/** A video with `udta` holding `udta`, `tracks`, and `top` before `moov`. */
function mp4With(udta: Uint8Array[], tracks: Uint8Array[], top: Uint8Array[]): Uint8Array {
  return concat(
    box('ftyp', latin1('isom\0\0\0\0isom')),
    ...top,
    box('moov', box('mvhd', zeros(100)), ...tracks, box('udta', ...udta)),
  );
}

function hdlr(handler: string): Uint8Array {
  return box('hdlr', zeros(8), latin1(handler), zeros(12));
}

/** A track whose handler is `handler`, with one sample entry of `format` holding `entry`. */
function trackOf(handler: string, format: string, entry: Uint8Array): Uint8Array {
  const stsd = box('stsd', of(0, 0, 0, 0, 0, 0, 0, 1), box(format, entry));
  const mdia = box('mdia', hdlr(handler), box('minf', box('stbl', stsd)));
  return box('trak', box('tkhd', zeros(84)), mdia);
}

/** A track built from `media`, each an `mdia` box's content. */
function trackWith(media: Uint8Array[]): Uint8Array {
  return box('trak', box('tkhd', zeros(84)), ...media.map((content) => box('mdia', content)));
}

/** A sample description holding `entries`, each a format and its content. */
function minf(entries: [string, Uint8Array][]): Uint8Array {
  const described = entries.map(([format, entry]) => box(format, entry));
  return box('minf', box('stbl', box('stsd', zeros(4), be32(entries.length), ...described)));
}

test('locations in 3gpp and xmp go too', () => {
  const uuid = box('uuid', XMP_UUID, XMP_GPS);
  const video = mp4With(
    [box('loci', latin1('\0\0\0\0somewhere +37.3349-122.0090')), box('XMP_', XMP_GPS)],
    [trackOf('vide', 'avc1', zeros(70))],
    [uuid],
  );
  const { bytes: stripped, metadata } = stripMetadata('mp4', video);
  expect(stripped.length).toBe(video.length);
  expect(metadata).toEqual({
    kind: 'video',
    removed: { location: true, other: true, embedded: false },
  });
  expectGone(stripped, ['loci', 'XMP_', 'uuid'].map(latin1));
  expectNoLocation(stripped);
  expectGone(stripped, [latin1('somewhere'), XMP_UUID]);
  expect(describeMetadata(metadata)).toMatch(/^removed where it was filmed and its XMP/);
});

test('a track of gps isnt sent', () => {
  const gopro = mp4With([], [trackOf('meta', 'gpmd', zeros(8))], []);
  expect(() => stripMetadata('mp4', gopro)).toThrow('GPS');
  const unknown = mp4With([], [trackOf('camm', 'camm', zeros(8))], []);
  expect(() => stripMetadata('mp4', unknown)).toThrow(UnreadableMetadata);
  const located = mp4With(
    [],
    [trackOf('meta', 'mebx', latin1('mdta com.apple.quicktime.location.ISO6709'))],
    [],
  );
  expect(() => stripMetadata('mov', located)).toThrow(UnreadableMetadata);
  // A phone's timed metadata that names no location goes, kept.
  const plain = mp4With(
    [],
    [trackOf('meta', 'mebx', latin1('mdta com.apple.quicktime.still-image-time'))],
    [],
  );
  expect(stripMetadata('mov', plain).metadata.kind).toBe('video');
});

/**
 * Crafted videos that hide a GPS track past the first media, handler or sample entry, under a
 * picture's handler, in a top-level `skip`, or as coordinates by another name.
 */
test('a gps track hidden in a crafted video isnt sent', () => {
  const videoMedia = concat(hdlr('vide'), minf([['avc1', zeros(70)]]));
  const gpsMedia = concat(hdlr('meta'), minf([['gpmd', zeros(8)]]));
  const crafted: [string, Uint8Array][] = [
    ['a second mdia', mp4With([], [trackWith([videoMedia, gpsMedia])], [])],
    [
      'a second hdlr',
      mp4With(
        [],
        [trackWith([concat(hdlr('vide'), hdlr('meta'), minf([['lmet', zeros(8)]]))])],
        [],
      ),
    ],
    [
      'a second sample entry',
      mp4With(
        [],
        [
          trackWith([
            concat(
              hdlr('meta'),
              minf([
                ['mebx', latin1('mdta plain')],
                ['gpmd', zeros(8)],
              ]),
            ),
          ]),
        ],
        [],
      ),
    ],
    [
      "gpmd under a picture's handler",
      mp4With([], [trackWith([concat(hdlr('vide'), minf([['gpmd', zeros(8)]]))])], []),
    ],
    [
      'a track in a top-level skip',
      mp4With([], [], [box('skip', trackOf('meta', 'gpmd', zeros(8)))]),
    ],
    [
      'coordinates by another name',
      mp4With([], [trackOf('meta', 'mebx', latin1('mdta com.example.camera.iso6709'))], []),
    ],
  ];
  const sent = crafted.filter(([, video]) => !refuses('mp4', video)).map(([what]) => what);
  expect(sent).toEqual([]);
  // A skip box of padding is fine.
  const padding = box('skip', zeros(32).fill(0xff));
  expect(stripMetadata('mp4', mp4With([], [], [padding])).metadata.kind).toBe('video');
});

test('xmp in a meta box goes', () => {
  const xml = box('xml ', XMP_GPS);
  const meta = box('meta', zeros(4), hdlr('mdir'), xml);
  const video = mp4With([meta], [], []);
  const { bytes: stripped, metadata } = stripMetadata('mp4', video);
  expect(contains(stripped, latin1('xml '))).toBe(false);
  expectNoLocation(stripped);
  expect(metadata).toEqual({
    kind: 'video',
    removed: { location: true, other: true, embedded: false },
  });
});

test('a video nesting too deep or with broken keys isnt sent', () => {
  let deep = box(XYZ, latin1('+37.3349-122.0090/'));
  for (let level = 0; level < MAX_BOX_DEPTH + 2; level++) deep = box('udta', deep);
  const video = concat(box('ftyp', latin1('isom\0\0\0\0isom')), box('moov', deep));
  expect(() => stripMetadata('mp4', video)).toThrow(
    new UnreadableMetadata('its boxes nest deeper than Lo reads'),
  );
  const broken = iphoneMov();
  broken.set(be32(3), indexOf(broken, latin1('mdta')) - 4);
  expect(() => stripMetadata('mov', broken)).toThrow(
    new UnreadableMetadata('its metadata keys are broken'),
  );
});

test('crafted jpeg segments go or refuse the file', () => {
  // A second APP0 and a reserved JPGn segment go.
  const photo = jpegWith([
    [0xe0, latin1('JFIF\0second')],
    [0xf3, latin1('hidden')],
  ]);
  const { bytes: stripped, metadata } = stripMetadata('jpeg', photo);
  expect(markers(stripped).filter((marker) => marker === 0xe0)).toHaveLength(1);
  expect(markers(stripped)).not.toContain(0xf3);
  expect(metadata).toEqual({
    kind: 'image',
    removed: { location: false, other: true, embedded: false },
  });
  // A segment Lo doesn't know refuses the file.
  const odd = jpegWith([[0xc8, latin1('what')]]);
  expect(() => stripMetadata('jpeg', odd)).toThrow(UnreadableMetadata);
});

test('an unknown critical png chunk refuses the file', () => {
  const odd = pngWith([['ZZZZ', latin1('hidden')]]);
  expect(() => stripMetadata('png', odd)).toThrow(UnreadableMetadata);
});

test('a webp whose frames or size hide metadata isnt sent', () => {
  const frame = concat(zeros(16), latin1('EXIF'), le32(26), exif(1, true));
  const animated = webpWith([['ANMF', frame]], 0x02);
  expect(() => stripMetadata('webp', animated)).toThrow(
    new UnreadableMetadata('an animation frame holds more than image data'),
  );
  const short = webpWith([['EXIF', exif(1, true)]], WEBP_EXIF);
  short.set(le32(2), 4);
  expect(() => stripMetadata('webp', short)).toThrow(UnreadableMetadata);
});

test('a broken video isnt sent', () => {
  const video = iphoneMov();
  // `moov` says it's longer than the file.
  video.set(be32(0xffffffff), indexOf(video, latin1('moov')) - 4);
  expect(() => stripMetadata('mov', video)).toThrow(UnreadableMetadata);
});

test('gifs svgs and webms are sent as they are', () => {
  for (const kind of ['gif', 'svg', 'webm'] as const) {
    const bytes = latin1('anything');
    expect(stripMetadata(kind, bytes)).toEqual({ bytes, metadata: { kind: 'asIs' } });
  }
  expect(describeMetadata({ kind: 'asIs' })).toBe(
    "sent as it is: Lo doesn't read this kind's metadata",
  );
});

test('the crc is zlibs', () => {
  expect(crc32(latin1('IEND'))).toBe(0xae426082);
});
