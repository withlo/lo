/**
 * Which way up an image figure is drawn: the orientation its Exif data gives, read where Chromium's
 * decoders read it, so a renderer can lay the figure out before decoding it. Orientations 5 to 8
 * turn it a quarter, so it's drawn as tall as its header says it's wide, and as wide as it's tall.
 *
 * Chromium takes a JPEG's orientation from its first `APP1` segment that starts `Exif\0\0`, before
 * its image data, and a PNG's from its first `eXIf` chunk before its image data whose checksum
 * matches. Within either, it's the first entry of the first image's directory that's an
 * orientation: a tag of 0x0112, holding one short from 1 to 8. A WebP's Exif data, and a GIF, don't
 * turn the image. Anything that can't be read leaves the image as it is, as it does there.
 */

import { crc32 } from './images.ts';

/** Exif's orientations: 1 as stored, then mirrored and turned, as TIFF numbers them. */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Whether `orientation` turns an image a quarter, so its width and height trade places. */
export function isTurned(orientation: Orientation): boolean {
  return orientation >= 5;
}

/**
 * The orientation `bytes`, a whole image file, are drawn in: 1, unless it's a JPEG or a PNG whose
 * Exif data says otherwise. Never throws, and takes time in proportion to the bytes at most.
 */
export function imageOrientation(bytes: Uint8Array): Orientation {
  if (startsWith(bytes, JPEG)) return fromTiff(jpegExif(bytes));
  if (startsWith(bytes, PNG)) return fromTiff(pngExif(bytes));
  return 1;
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** What a JPEG's Exif segment starts with, before its TIFF data. */
const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const EXIF_CHUNK = [0x65, 0x58, 0x49, 0x66];
const IDAT = [0x49, 0x44, 0x41, 0x54];
const IEND = [0x49, 0x45, 0x4e, 0x44];

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  return (
    bytes.length >= at + signature.length &&
    signature.every((byte, index) => bytes[at + index] === byte)
  );
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32be(bytes: Uint8Array, at: number): number {
  return u16be(bytes, at) * 0x10000 + u16be(bytes, at + 2);
}

/**
 * The TIFF data of a JPEG's Exif segment: the first `APP1` that starts `Exif\0\0`, among the
 * segments before its image data. Undefined when there's none, or the segments can't be walked.
 */
function jpegExif(bytes: Uint8Array): Uint8Array | undefined {
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    // Any number of 0xFF may come before a marker.
    while (bytes[at] === 0xff) at += 1;
    const marker = bytes[at];
    at += 1;
    if (marker === undefined) return undefined;
    // Markers that stand alone: restarts, and `TEM`.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    // The image's data, or its end: nothing after counts.
    if (marker === 0xda || marker === 0xd9 || marker === 0x00 || marker === 0xd8) return undefined;
    const length = u16be(bytes, at);
    if (length < 2 || at + length > bytes.length) return undefined;
    if (marker === 0xe1 && startsWith(bytes, EXIF, at + 2)) {
      return bytes.subarray(at + 2 + EXIF.length, at + length);
    }
    at += length;
  }
  return undefined;
}

/**
 * The TIFF data of a PNG's `eXIf` chunk: the first, among the chunks before its image data, whose
 * checksum matches. Undefined when there's none, or the chunks can't be walked.
 */
function pngExif(bytes: Uint8Array): Uint8Array | undefined {
  let at = PNG.length;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    const kind = at + 4;
    const end = kind + 4 + length;
    if (length > 0x7fffffff || end + 4 > bytes.length) return undefined;
    if (startsWith(bytes, IDAT, kind) || startsWith(bytes, IEND, kind)) return undefined;
    if (
      startsWith(bytes, EXIF_CHUNK, kind) &&
      u32be(bytes, end) === crc32(bytes.subarray(kind, end))
    ) {
      return bytes.subarray(kind + 4, end);
    }
    at = end + 4;
  }
  return undefined;
}

/** The orientation tag, and the type of a short. */
const ORIENTATION = 0x0112;
const SHORT = 3;

/**
 * The orientation TIFF data gives: its first image's first entry that's an orientation, a tag of
 * 0x0112 holding one short from 1 to 8. The directory's entries are read only as far as the data
 * goes, and a byte order or start TIFF doesn't have gives 1.
 */
function fromTiff(tiff: Uint8Array | undefined): Orientation {
  if (!tiff || tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const u16 = (at: number): number =>
    little ? (tiff[at] ?? 0) | ((tiff[at + 1] ?? 0) << 8) : u16be(tiff, at);
  const u32 = (at: number): number => (little ? u16(at) + u16(at + 2) * 0x10000 : u32be(tiff, at));
  if (u16(2) !== 42) return 1;
  const directory = u32(4);
  if (directory + 2 > tiff.length) return 1;
  const entries = u16(directory);
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) !== ORIENTATION || u16(entry + 2) !== SHORT || u32(entry + 4) !== 1) continue;
    const value = u16(entry + 8);
    if (isOrientation(value)) return value;
  }
  return 1;
}

function isOrientation(value: number): value is Orientation {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}
