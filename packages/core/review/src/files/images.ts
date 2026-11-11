/**
 * Changed images (`docs/design.md`, "The diff view"): which files show as images, read from their
 * headers alone, and the line that describes each side.
 */

import { sizeText } from './display.ts';

/** The image formats Lo shows. */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg';

/** An image's width and height in pixels. */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * One side of a changed image. Only its header is read here: it's decoded only when it shows.
 */
export interface ImageSide {
  readonly format: ImageFormat;
  /** Its size in bytes. */
  readonly size: number;
  /** The image itself, until its preview is decoded. */
  readonly bytes: Uint8Array | undefined;
  /** Width and height, from the image's header. Nothing for SVG. */
  readonly dimensions: Dimensions | undefined;
  /**
   * How many frames a GIF has, counted from its blocks, when it has more than one. Only the first
   * shows.
   */
  readonly frames: number | undefined;
}

/** The two sides of a changed image. A side is missing when the pull request adds or deletes it. */
export interface Images {
  readonly old: ImageSide | undefined;
  readonly new: ImageSide | undefined;
}

/** The extensions of files that may be images, besides SVG. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/**
 * `bytes` as an image, when `path` names one of the formats Lo shows (PNG, JPEG, GIF, WebP and
 * SVG) and the bytes are one of them. Nothing otherwise, such as for a Git LFS pointer, which is
 * text. Reads only the image's header.
 */
export function readImage(path: string, bytes: Uint8Array): ImageSide | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return undefined;
  const extension = path.slice(dot + 1).toLowerCase();
  if (extension === 'svg') {
    return holdsSvg(bytes)
      ? { format: 'svg', size: bytes.length, bytes, dimensions: undefined, frames: undefined }
      : undefined;
  }
  if (!IMAGE_EXTENSIONS.has(extension)) return undefined;
  // By its bytes, not its name: a `.png` holding a JPEG still shows.
  const format = formatOf(bytes);
  if (format === undefined) return undefined;
  const dimensions = dimensionsOf(format, bytes);
  if (dimensions === undefined) return undefined;
  const frames = format === 'gif' ? gifFrames(bytes) : undefined;
  return {
    format,
    size: bytes.length,
    bytes,
    dimensions,
    frames: frames !== undefined && frames > 1 ? frames : undefined,
  };
}

/** The image's line in the diff: its format, dimensions, frames and size. */
export function imageSummary(image: ImageSide): string {
  const parts = [`${FORMAT_NAMES[image.format]} image`];
  if (image.dimensions !== undefined) {
    parts.push(`${image.dimensions.width} × ${image.dimensions.height}`);
  }
  if (image.frames !== undefined) parts.push(`animated, ${image.frames} frames`);
  parts.push(sizeText(image.size));
  return parts.join(', ');
}

const FORMAT_NAMES: Readonly<Record<ImageFormat, string>> = {
  png: 'PNG',
  jpeg: 'JPEG',
  gif: 'GIF',
  webp: 'WebP',
  svg: 'SVG',
};

/** Whether `bytes` are UTF-8 text with an `<svg` element in it. */
function holdsSvg(bytes: Uint8Array): boolean {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('<svg');
  } catch {
    return false;
  }
}

/** The format `bytes` start like, of those with a header to read. */
function formatOf(bytes: Uint8Array): Exclude<ImageFormat, 'svg'> | undefined {
  if (startsWith(bytes, 0, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'webp';
  return undefined;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function dimensionsOf(
  format: Exclude<ImageFormat, 'svg'>,
  bytes: Uint8Array,
): Dimensions | undefined {
  switch (format) {
    case 'png':
      return pngDimensions(bytes);
    case 'jpeg':
      return jpegDimensions(bytes);
    case 'gif':
      return bytes.length < 13
        ? undefined
        : { width: uint16(bytes, 6, true), height: uint16(bytes, 8, true) };
    case 'webp':
      return webpDimensions(bytes);
    default:
      throw new Error(`an image format Lo doesn't know: ${JSON.stringify(format satisfies never)}`);
  }
}

/** A PNG's size, from its first chunk, which is always its header (`IHDR`). */
function pngDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (bytes.length < 24 || uint32(bytes, 8) !== 13 || !startsWith(bytes, 12, ascii('IHDR'))) {
    return undefined;
  }
  return sized(uint32(bytes, 16), uint32(bytes, 20));
}

/**
 * A JPEG's size, from its frame header (one of the `SOF` markers), which comes before the image's
 * first scan.
 */
function jpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    // Any number of fill bytes may come before a marker.
    let marker = bytes[at + 1];
    while (marker === 0xff) {
      at++;
      marker = bytes[at + 1];
    }
    if (marker === undefined) return undefined;
    at += 2;
    // Markers that stand alone, without a length: TEM, the restart markers and SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // The end of the image or its first scan, with no frame header before it.
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (at + 2 > bytes.length) return undefined;
    const length = uint16(bytes, at, false);
    if (length < 2) return undefined;
    // SOF0 to SOF15, except DHT, JPG and DAC, which share their range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 7 > bytes.length) return undefined;
      return sized(uint16(bytes, at + 5, false), uint16(bytes, at + 3, false));
    }
    at += length;
  }
  return undefined;
}

/** A WebP's size, from its first chunk: lossy (`VP8 `), lossless (`VP8L`) or extended (`VP8X`). */
function webpDimensions(bytes: Uint8Array): Dimensions | undefined {
  const data = 20;
  if (startsWith(bytes, 12, ascii('VP8 '))) {
    if (bytes.length < data + 10 || !startsWith(bytes, data + 3, [0x9d, 0x01, 0x2a])) {
      return undefined;
    }
    return sized(uint16(bytes, data + 6, true) & 0x3fff, uint16(bytes, data + 8, true) & 0x3fff);
  }
  if (startsWith(bytes, 12, ascii('VP8L'))) {
    if (bytes.length < data + 5 || bytes[data] !== 0x2f) return undefined;
    const bits = uint16(bytes, data + 1, true) + uint16(bytes, data + 3, true) * 0x1_0000;
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (startsWith(bytes, 12, ascii('VP8X'))) {
    if (bytes.length < data + 10) return undefined;
    return sized(uint24(bytes, data + 4) + 1, uint24(bytes, data + 7) + 1);
  }
  return undefined;
}

/**
 * How many frames a GIF has, counted from its blocks, or nothing when they don't add up. Each
 * image descriptor is a frame; extensions are skipped.
 */
function gifFrames(bytes: Uint8Array): number | undefined {
  const flags = bytes[10];
  if (flags === undefined) return undefined;
  // After the header, the logical screen descriptor and the global colour table, if there is one.
  let at = 13 + colourTable(flags);
  let frames = 0;
  // Skips a run of sub-blocks, each a length byte then that many bytes, up to the empty one.
  const skipSubBlocks = (): boolean => {
    for (;;) {
      const length = bytes[at];
      if (length === undefined) return false;
      at += 1 + length;
      if (length === 0) return true;
    }
  };
  for (;;) {
    const block = bytes[at];
    if (block === undefined) return undefined;
    switch (block) {
      // The trailer.
      case 0x3b:
        return frames;
      // An extension: its label, then sub-blocks.
      case 0x21:
        at += 2;
        if (!skipSubBlocks()) return undefined;
        break;
      // An image descriptor, an optional local colour table, the LZW code size, sub-blocks.
      case 0x2c: {
        const local = bytes[at + 9];
        if (local === undefined) return undefined;
        at += 10 + colourTable(local) + 1;
        if (!skipSubBlocks()) return undefined;
        frames++;
        break;
      }
      default:
        return undefined;
    }
  }
}

/** The size of the colour table a GIF's flags byte says follows, if any. */
function colourTable(flags: number): number {
  return (flags & 0x80) === 0 ? 0 : 3 << ((flags & 0x07) + 1);
}

/** A size, unless either side is zero. */
function sized(width: number, height: number): Dimensions | undefined {
  return width === 0 || height === 0 ? undefined : { width, height };
}

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  return prefix.every((byte, offset) => bytes[at + offset] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function uint16(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  const first = bytes[at] ?? 0;
  const second = bytes[at + 1] ?? 0;
  return littleEndian ? first | (second << 8) : (first << 8) | second;
}

function uint24(bytes: Uint8Array, at: number): number {
  return uint16(bytes, at, true) + (bytes[at + 2] ?? 0) * 0x1_0000;
}

function uint32(bytes: Uint8Array, at: number): number {
  return uint16(bytes, at, false) * 0x1_0000 + uint16(bytes, at + 2, false);
}
