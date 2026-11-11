/**
 * What Lo takes out of a file before it attaches it: the metadata a photo carries, where it was
 * taken among it, which GitHub keeps and serves to everyone who can see the comment. Lo changes
 * only metadata, never pixels, and keeps what changes how the image looks: its orientation, colour
 * profile and pixel density. The comment box then says what went.
 *
 * - **JPEG:** EXIF (the camera or phone, the time, settings, a thumbnail, and GPS), XMP, IPTC,
 *   comments and the other application and reserved segments go, but JFIF, the ICC colour profile
 *   and Adobe's colour transform stay. Images stored after the picture itself, such as an iPhone's
 *   HDR gain map with its own metadata, go too. An orientation other than upright is written back
 *   alone. A segment that's neither image data nor one of those isn't sent.
 * - **PNG:** every ancillary chunk that doesn't change how it looks goes: `eXIf`, text (XMP among
 *   it), `tIME`, and Apple's `iDOT`, which points into the file and would be wrong once chunks
 *   before it go. An orientation other than upright is written back alone in `eXIf`. A critical
 *   chunk PNG doesn't define isn't sent.
 * - **WebP:** its `EXIF` and `XMP ` chunks and unknown ones go, and `VP8X` stops saying it has
 *   them; an orientation other than upright is written back alone. An animation frame holding
 *   anything but image data, or a RIFF size that isn't the file's, isn't sent.
 * - **MP4 and MOV:** where it was filmed goes, wherever QuickTime, Apple, 3GPP and XMP keep it:
 *   `©xyz` and `loci` in user data, Apple's `com.apple.quicktime.location.*` values, and XMP
 *   (`XMP_` in user data, `xml ` in a `meta` box, or a top-level `uuid` box); each becomes a `free`
 *   box of the same size, its content zeroed, so nothing else moves and nothing of what it held
 *   stays. The rest of a video's metadata stays, such as when it was filmed and on what, and the
 *   comment box says so. A video with timed metadata that may hold a location isn't sent, since
 *   those samples sit among the video's: a GPS sample entry (a GoPro's `gpmd`, `camm`) under any
 *   track, a timed-metadata track of another kind than Apple's `mebx`, an `mebx` whose keys name a
 *   location or coordinates, or a track of a kind Lo doesn't know. Every track's every media,
 *   handler and sample entry is read, and so are tracks hidden in a top-level `skip` box.
 * - **GIF, SVG and WebM** are sent as they are: Lo doesn't read their metadata, and the comment box
 *   says so. None of them carries a camera's EXIF or GPS in its standard form.
 *
 * A file whose metadata Lo can't read through, because it's malformed or nests deeper than Lo
 * reads, isn't sent at all.
 */

import type { AttachmentKind } from './attachments.ts';

/** What Lo took out of a file. */
export interface RemovedMetadata {
  /** Where it was taken or filmed: GPS coordinates or a location. */
  location: boolean;
  /** Other metadata: the camera or phone, the time, the software, settings, comments, a thumbnail. */
  other: boolean;
  /** Images stored after the picture itself, such as an HDR gain map, with their own metadata. */
  embedded: boolean;
}

/** What Lo did with a file's metadata. */
export type Metadata =
  /** An image's: Lo read through it and took out what `removed` says, which may be nothing. */
  | { kind: 'image'; removed: RemovedMetadata }
  /** A video's: Lo took out where it was filmed, and any XMP, as `removed` says, and kept the rest. */
  | { kind: 'video'; removed: RemovedMetadata }
  /** Lo doesn't read this kind's metadata, so it sends the file as it is. */
  | { kind: 'asIs' };

/** Why Lo can't read through a file's metadata, so can't say what it would send. */
export class UnreadableMetadata extends Error {
  override name = 'UnreadableMetadata';
}

function unreadable(why: string): never {
  throw new UnreadableMetadata(why);
}

/** What a video keeps, as the comment box says it. */
const VIDEO_KEEPS = 'other video metadata, such as when it was filmed and on what, stays';

/** What the comment box says about a file's metadata: "removed its location and other metadata". */
export function describeMetadata(metadata: Metadata): string {
  switch (metadata.kind) {
    case 'asIs':
      return "sent as it is: Lo doesn't read this kind's metadata";
    case 'image': {
      const { removed } = metadata;
      if (!removed.location && !removed.other && !removed.embedded) return 'no metadata to remove';
      const what: string[] = [];
      if (removed.location) what.push('its location');
      if (removed.other) {
        what.push(removed.location ? 'other metadata' : 'its metadata (no location in it)');
      }
      if (removed.embedded) what.push('an image stored inside it');
      return `removed ${listed(what)}`;
    }
    case 'video': {
      const { removed } = metadata;
      if (!removed.location && !removed.other) {
        return `no location found where QuickTime, Apple, 3GPP or XMP keep one; ${VIDEO_KEEPS}`;
      }
      const what: string[] = [];
      if (removed.location) what.push('where it was filmed');
      if (removed.other) what.push('its XMP metadata');
      return `removed ${listed(what)}; ${VIDEO_KEEPS}`;
    }
    default:
      throw new Error(
        `an attachment's metadata Lo doesn't know: ${JSON.stringify(metadata satisfies never)}`,
      );
  }
}

/** "a", "a and b", "a, b and c". */
function listed(what: readonly string[]): string {
  const last = what.at(-1);
  if (last === undefined) return '';
  const rest = what.slice(0, -1);
  return rest.length === 0 ? last : `${rest.join(', ')} and ${last}`;
}

/**
 * `bytes`, a file of `kind`, with what {@link Metadata} says taken out. `bytes` is left as it is.
 * Throws {@link UnreadableMetadata} when Lo can't read through it.
 */
export function stripMetadata(
  kind: AttachmentKind,
  bytes: Uint8Array,
): { bytes: Uint8Array; metadata: Metadata } {
  switch (kind) {
    case 'jpeg': {
      const stripped = jpeg(bytes);
      return { bytes: stripped.bytes, metadata: { kind: 'image', removed: stripped.removed } };
    }
    case 'png': {
      const stripped = png(bytes);
      return { bytes: stripped.bytes, metadata: { kind: 'image', removed: stripped.removed } };
    }
    case 'webp': {
      const stripped = webp(bytes);
      return { bytes: stripped.bytes, metadata: { kind: 'image', removed: stripped.removed } };
    }
    case 'mp4':
    case 'mov': {
      // A video's boxes are freed in place, in a copy.
      const copy = bytes.slice();
      return { bytes: copy, metadata: { kind: 'video', removed: video(copy) } };
    }
    case 'gif':
    case 'svg':
    case 'webm':
      return { bytes, metadata: { kind: 'asIs' } };
    default:
      throw new Error(
        `an attachment kind Lo doesn't know: ${JSON.stringify(kind satisfies never)}`,
      );
  }
}

function nothingRemoved(): RemovedMetadata {
  return { location: false, other: false, embedded: false };
}

// Reading and writing bytes.

/** `text`'s characters as bytes, one each, as file formats spell their four-character codes. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/** The four bytes at `at` as characters: a chunk's or a box's type. */
function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fits(bytes: Uint8Array, at: number, length: number): boolean {
  return at >= 0 && at + length <= bytes.length;
}

/** The big-endian 16-bit number at `at`, or nothing when the bytes end first. */
function u16be(bytes: Uint8Array, at: number): number | undefined {
  return fits(bytes, at, 2) ? view(bytes).getUint16(at) : undefined;
}

/** The big-endian 32-bit number at `at`, or nothing when the bytes end first. */
function u32be(bytes: Uint8Array, at: number): number | undefined {
  return fits(bytes, at, 4) ? view(bytes).getUint32(at) : undefined;
}

/** The little-endian 32-bit number at `at`, or nothing when the bytes end first. */
function u32le(bytes: Uint8Array, at: number): number | undefined {
  return fits(bytes, at, 4) ? view(bytes).getUint32(at, true) : undefined;
}

function be16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  view(out).setUint16(0, value);
  return out;
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  view(out).setUint32(0, value);
  return out;
}

function le32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  view(out).setUint32(0, value, true);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Whether `bytes` hold `prefix` at `at`. */
function startsWith(bytes: Uint8Array, prefix: Uint8Array, at = 0): boolean {
  return (
    fits(bytes, at, prefix.length) && prefix.every((byte, index) => bytes[at + index] === byte)
  );
}

/** Whether `needle` is anywhere in `bytes`. */
function contains(bytes: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  if (first === undefined) return true;
  // Jumping from one first byte to the next keeps this quick over the megabytes after a photo.
  for (let at = bytes.indexOf(first); at !== -1; at = bytes.indexOf(first, at + 1)) {
    if (startsWith(bytes, needle, at)) return true;
  }
  return false;
}

/** Whether `word`, in lowercase ASCII, is anywhere in `bytes`, whatever their ASCII case. */
function containsIgnoringCase(bytes: Uint8Array, word: string): boolean {
  const needle = latin1(word);
  for (let at = 0; at + needle.length <= bytes.length; at++) {
    if (needle.every((byte, index) => lowercase(bytes[at + index] ?? 0) === byte)) return true;
  }
  return false;
}

function lowercase(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

// EXIF.

/** What a file's EXIF says that Lo cares about. */
export interface Exif {
  /** Whether it points at GPS data. */
  gps: boolean;
  /** 1 is upright. */
  orientation: number | undefined;
}

/** Reads `tiff`, EXIF's TIFF structure: IFD0's orientation, and whether it points at GPS data. */
export function readExif(tiff: Uint8Array): Exif {
  const exif: Exif = { gps: false, orientation: undefined };
  const order = fourcc(tiff, 0).slice(0, 2);
  if (order !== 'MM' && order !== 'II') return exif;
  const little = order === 'II';
  const u16 = (at: number) => (fits(tiff, at, 2) ? view(tiff).getUint16(at, little) : undefined);
  const ifd = fits(tiff, 4, 4) ? view(tiff).getUint32(4, little) : undefined;
  if (ifd === undefined) return exif;
  const count = u16(ifd) ?? 0;
  for (let entry = 0; entry < count; entry++) {
    const at = ifd + 2 + entry * 12;
    const tag = u16(at);
    if (tag === 0x0112) exif.orientation = u16(at + 8);
    else if (tag === 0x8825) exif.gps = true;
  }
  return exif;
}

/** EXIF's TIFF structure holding only `orientation`. */
function orientationExif(orientation: number): Uint8Array {
  return concat([
    latin1('MM\0*'),
    be32(8),
    be16(1),
    be16(0x0112),
    // SHORT, one of it, the value in the first two bytes of the four.
    be16(3),
    be32(1),
    be16(orientation),
    new Uint8Array(2),
    // No next IFD.
    be32(0),
  ]);
}

/** The words that say where something was, in XMP or other text. */
const LOCATION_WORDS = [
  'GPSLatitude',
  'GPSLongitude',
  'exif:GPS',
  'Iptc4xmpExt:LocationCreated',
].map(latin1);

/** Whether XMP's or other text's `bytes` say where something was. */
function mentionsLocation(bytes: Uint8Array): boolean {
  return LOCATION_WORDS.some((word) => contains(bytes, word));
}

/** `orientation`, when it's set to something other than upright. */
function turned(orientation: number | undefined): number | undefined {
  return orientation !== undefined && orientation >= 2 && orientation <= 8
    ? orientation
    : undefined;
}

const EXIF_HEADER = latin1('Exif\0\0');

// JPEG.

const JFIF = latin1('JFIF\0');
const ICC_PROFILE = latin1('ICC_PROFILE\0');
const ADOBE = latin1('Adobe');

interface Stripped {
  bytes: Uint8Array;
  removed: RemovedMetadata;
}

function jpeg(bytes: Uint8Array): Stripped {
  const MALFORMED = 'its JPEG structure is broken';
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) unreadable(MALFORMED);
  const removed = nothingRemoved();
  let orientation: number | undefined;
  const kept: Uint8Array[] = [];
  let at = 2;
  // Whether a scan has started: entropy-coded data follows each SOS until the next marker.
  let inScan = false;
  for (;;) {
    if (inScan) {
      // A marker is 0xFF and then anything but 0x00 (a stuffed 0xFF), a restart marker or more
      // 0xFF fill.
      const start = at;
      for (;;) {
        const next = bytes.indexOf(0xff, at);
        if (next === -1) unreadable(MALFORMED);
        at = next;
        const following = bytes[at + 1];
        if (following === undefined) unreadable(MALFORMED);
        if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) at += 2;
        else if (following === 0xff) at += 1;
        else break;
      }
      kept.push(bytes.subarray(start, at));
      inScan = false;
    }
    if (bytes[at] !== 0xff) unreadable(MALFORMED);
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at];
    if (marker === undefined) unreadable(MALFORMED);
    at++;
    const segmentStart = at - 2;
    if (marker === 0xd9) {
      kept.push(bytes.subarray(segmentStart, at));
      break;
    }
    if (marker === 0xd8) unreadable(MALFORMED);
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(segmentStart, at));
      continue;
    }
    const length = u16be(bytes, at) ?? unreadable(MALFORMED);
    if (length < 2 || at + length > bytes.length) unreadable(MALFORMED);
    const payload = bytes.subarray(at + 2, at + length);
    const segment = bytes.subarray(segmentStart, at + length);
    at += length;
    let keep: boolean;
    if (marker === 0xe0) {
      // The first segment's JFIF stays; its JFXX extension (a thumbnail), and any other APP0, goes.
      keep = kept.length === 0 && startsWith(payload, JFIF);
    } else if (marker === 0xe1) {
      if (startsWith(payload, EXIF_HEADER)) {
        const exif = readExif(payload.subarray(EXIF_HEADER.length));
        removed.location ||= exif.gps;
        orientation ??= exif.orientation;
      } else {
        removed.location ||= mentionsLocation(payload);
      }
      keep = false;
    } else if (marker === 0xe2) {
      // The colour profile stays; the multi-picture index goes with the pictures it lists.
      keep = startsWith(payload, ICC_PROFILE);
    } else if (marker === 0xed) {
      removed.location ||= mentionsLocation(payload);
      keep = false;
    } else if (marker === 0xee) {
      // Adobe's colour transform, which decoding needs.
      keep = startsWith(payload, ADOBE);
    } else if (
      (marker >= 0xe3 && marker <= 0xec) ||
      marker === 0xef ||
      marker === 0xfe ||
      (marker >= 0xf0 && marker <= 0xfd)
    ) {
      // Other application segments, comments and the reserved `JPGn`.
      keep = false;
    } else if (isImageSegment(marker)) {
      keep = true;
    } else {
      // Anything else isn't image data Lo knows to keep, nor metadata it knows to drop.
      unreadable("it holds a JPEG segment Lo doesn't know");
    }
    if (keep) kept.push(segment);
    else removed.other = true;
    if (marker === 0xda) inScan = true;
  }
  // What follows the picture: a multi-picture file's other images, each a JPEG of its own.
  const trailing = bytes.subarray(at);
  if (contains(trailing, SOI_AND_MARKER)) removed.embedded = true;
  else if (trailing.some((byte) => byte !== 0)) removed.other = true;

  const out: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  // JFIF comes first, and the orientation right after it.
  const first = kept[0];
  if (first !== undefined && first[0] === 0xff && first[1] === 0xe0)
    out.push(kept.shift() ?? first);
  const turnedTo = turned(orientation);
  if (turnedTo !== undefined) {
    const exif = concat([EXIF_HEADER, orientationExif(turnedTo)]);
    out.push(new Uint8Array([0xff, 0xe1]), be16(exif.length + 2), exif);
  }
  out.push(...kept);
  return { bytes: concat(out), removed };
}

/** A JPEG's start, and the 0xFF of the marker after it: how each JPEG stored inside one starts. */
const SOI_AND_MARKER = new Uint8Array([0xff, 0xd8, 0xff]);

/**
 * Whether `marker` starts a segment of the image itself: frames (SOFn), tables (DHT, DAC, DQT),
 * restarts (DRI), scans (SOS), line counts (DNL) and hierarchical steps (DHP, EXP).
 */
function isImageSegment(marker: number): boolean {
  const frame =
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf);
  return frame || [0xc4, 0xcc, 0xdb, 0xdd, 0xda, 0xdc, 0xde, 0xdf].includes(marker);
}

// PNG.

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The critical chunks PNG defines. */
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/** The ancillary chunks that change how a PNG looks, or animate it, which stay. */
const PNG_KEPT = new Set([
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCV',
  'mDCv',
  'cLLI',
  'cLLi',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  'acTL',
  'fcTL',
  'fdAT',
]);

function png(bytes: Uint8Array): Stripped {
  const MALFORMED = 'its PNG structure is broken';
  if (!startsWith(bytes, PNG_SIGNATURE)) unreadable(MALFORMED);
  const removed = nothingRemoved();
  let orientation: number | undefined;
  const chunks: Uint8Array[] = [];
  let at = PNG_SIGNATURE.length;
  for (;;) {
    const length = fits(bytes, at, 8) ? view(bytes).getUint32(at) : unreadable(MALFORMED);
    const type = fourcc(bytes, at + 4);
    const end = at + 12 + length;
    if (end > bytes.length) unreadable(MALFORMED);
    const data = bytes.subarray(at + 8, at + 8 + length);
    const first = bytes[at + 4] ?? 0;
    const critical = first >= 0x41 && first <= 0x5a;
    if (critical && !PNG_CRITICAL.has(type)) {
      unreadable("it holds a critical PNG chunk Lo doesn't know");
    }
    if (critical || PNG_KEPT.has(type)) {
      chunks.push(bytes.subarray(at, end));
    } else {
      removed.other = true;
      if (type === 'eXIf') {
        const exif = readExif(data);
        removed.location ||= exif.gps;
        orientation ??= exif.orientation;
      } else if (type === 'tEXt' || type === 'iTXt') {
        removed.location ||= mentionsLocation(data);
      }
    }
    at = end;
    if (type === 'IEND') break;
  }
  const out: Uint8Array[] = [PNG_SIGNATURE];
  const turnedTo = turned(orientation);
  for (const [index, chunk] of chunks.entries()) {
    out.push(chunk);
    // IHDR comes first, and the orientation right after it, before any image data.
    if (index === 0 && turnedTo !== undefined) {
      const data = orientationExif(turnedTo);
      const typed = concat([latin1('eXIf'), data]);
      out.push(be32(data.length), typed, be32(crc32(typed)));
    }
  }
  if (at < bytes.length) removed.other = true;
  return { bytes: concat(out), removed };
}

/** The CRC-32 PNG's chunks end with (ISO 3309, as zlib's). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// WebP.

/** The WebP chunks that make up the image, which stay. */
const WEBP_KEPT = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

/** `VP8X`'s flags for EXIF and XMP. */
const WEBP_EXIF = 0x08;
const WEBP_XMP = 0x04;

function webp(bytes: Uint8Array): Stripped {
  const MALFORMED = 'its WebP structure is broken';
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') {
    unreadable(MALFORMED);
  }
  const riffEnd = 8 + (u32le(bytes, 4) ?? 0);
  // Chunks past a RIFF size shorter than the file would go unread.
  if (riffEnd !== bytes.length) unreadable("its RIFF size isn't the file's");
  const removed = nothingRemoved();
  let orientation: number | undefined;
  const chunks: Uint8Array[] = [];
  let at = 12;
  while (at < riffEnd) {
    if (!fits(bytes, at, 8)) unreadable(MALFORMED);
    const type = fourcc(bytes, at);
    const length = u32le(bytes, at + 4) ?? 0;
    const end = at + 8 + length + (length % 2);
    if (end > bytes.length) unreadable(MALFORMED);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'ANMF') animationFrame(data);
    if (WEBP_KEPT.has(type)) {
      chunks.push(bytes.subarray(at, end));
    } else {
      removed.other = true;
      if (type === 'EXIF') {
        // Some writers put EXIF's own header first.
        const tiff = startsWith(data, EXIF_HEADER) ? data.subarray(EXIF_HEADER.length) : data;
        const exif = readExif(tiff);
        removed.location ||= exif.gps;
        orientation ??= exif.orientation;
      } else if (type === 'XMP ') {
        removed.location ||= mentionsLocation(data);
      }
    }
    at = end;
  }
  const turnedTo = turned(orientation);
  const first = chunks[0];
  if (first !== undefined && fourcc(first, 0) === 'VP8X') {
    // A copy, so `bytes` stay as they were.
    const vp8x = first.slice();
    chunks[0] = vp8x;
    const flags = vp8x[8] ?? unreadable(MALFORMED);
    vp8x[8] = (flags & ~(WEBP_EXIF | WEBP_XMP)) | (turnedTo === undefined ? 0 : WEBP_EXIF);
    if (turnedTo !== undefined) {
      const data = orientationExif(turnedTo);
      const padding = new Uint8Array(data.length % 2);
      chunks.push(concat([latin1('EXIF'), le32(data.length), data, padding]));
    }
  }
  const body = concat(chunks);
  return { bytes: concat([latin1('RIFF'), le32(4 + body.length), latin1('WEBP'), body]), removed };
}

/**
 * Checks an animation frame's `data`: after its 16 bytes of placement and timing, only the frame's
 * image data, which keeps no metadata.
 */
function animationFrame(data: Uint8Array): void {
  const MALFORMED = 'its WebP structure is broken';
  let at = 16;
  if (data.length < at) unreadable(MALFORMED);
  while (at < data.length) {
    if (!fits(data, at, 8)) unreadable(MALFORMED);
    const type = fourcc(data, at);
    if (type !== 'ALPH' && type !== 'VP8 ' && type !== 'VP8L') {
      unreadable('an animation frame holds more than image data');
    }
    const length = u32le(data, at + 4) ?? 0;
    at += 8 + length + (length % 2);
    if (at > data.length) unreadable(MALFORMED);
  }
}

// MP4 and MOV.

/** QuickTime's location in a user data box: `©xyz`. */
const XYZ = '©xyz';

/** Apple's keys for where a video was filmed. */
const LOCATION_KEY = latin1('com.apple.quicktime.location');

/** The `uuid` box XMP is kept in at a file's top level: `BE7ACFCB-97A9-42E8-9C71-999491E3AFAC`. */
const XMP_UUID = new Uint8Array([
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
]);

/** How deep boxes are read: the location is a few levels down. A file nesting deeper isn't sent. */
export const MAX_BOX_DEPTH = 8;

const TOO_DEEP = 'its boxes nest deeper than Lo reads';

/** The tracks a video keeps: pictures, sound, text and timecodes, which hold no location. */
const PLAIN_TRACKS = new Set([
  'vide',
  'soun',
  'text',
  'sbtl',
  'subt',
  'subp',
  'clcp',
  'tmcd',
  'hint',
]);

/** Why a video whose boxes don't fit together isn't sent. */
const MALFORMED_MP4 = 'its MP4 structure is broken';

/**
 * Takes where an MP4 or MOV was filmed out of `bytes`, in place: the boxes that hold it become
 * `free` boxes of the same size.
 */
function video(bytes: Uint8Array): RemovedMetadata {
  const removed = nothingRemoved();
  walkBoxes(bytes, 0, bytes.length, 0, removed);
  return removed;
}

/** A box: its type, and where its content starts and it ends. */
interface Box {
  type: string;
  content: number;
  end: number;
}

/** The box at `at`, in boxes that end at `end`. */
function readBox(bytes: Uint8Array, at: number, end: number): Box {
  if (!fits(bytes, at, 8)) unreadable(MALFORMED_MP4);
  const size = view(bytes).getUint32(at);
  const type = fourcc(bytes, at + 4);
  let content = at + 8;
  let length = size;
  if (size === 0) {
    length = end - at;
  } else if (size === 1) {
    const high = u32be(bytes, at + 8);
    const low = u32be(bytes, at + 12);
    if (high === undefined || low === undefined) unreadable(MALFORMED_MP4);
    content = at + 16;
    length = high * 0x1_0000_0000 + low;
  }
  const boxEnd = at + length;
  if (boxEnd > end || boxEnd < content) unreadable(MALFORMED_MP4);
  return { type, content, end: boxEnd };
}

/**
 * Frees the box at `at`, whose content runs from `content` to `end`: it stays, of the same size, as
 * a `free` box readers skip, so the offsets into the file that sample tables keep (`stco`, `co64`)
 * still hold; and its content is zeroed, so what it held isn't in the file any more.
 */
function free(bytes: Uint8Array, at: number, content: number, end: number): void {
  bytes.set(latin1('free'), at + 4);
  bytes.fill(0, content, end);
}

function walkBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  removed: RemovedMetadata,
): void {
  if (depth > MAX_BOX_DEPTH) unreadable(TOO_DEEP);
  let at = start;
  while (at + 8 <= end) {
    const { type, content, end: boxEnd } = readBox(bytes, at, end);
    if (type === 'trak') {
      track(bytes, content, boxEnd);
      walkBoxes(bytes, content, boxEnd, depth + 1, removed);
    } else if (type === 'moov' || type === 'udta' || type === 'ilst') {
      walkBoxes(bytes, content, boxEnd, depth + 1, removed);
    } else if (type === 'skip' && depth === 0) {
      // Readers skip it, but a lenient one might not: what parses as boxes in it is read as any
      // other, and what doesn't is padding.
      try {
        walkBoxes(bytes, content, boxEnd, depth + 1, removed);
      } catch (error) {
        if (!(error instanceof UnreadableMetadata) || error.message !== MALFORMED_MP4) throw error;
      }
    } else if (type === 'meta') {
      meta(bytes, content, boxEnd, depth + 1, removed);
    } else if (type === XYZ || type === 'loci') {
      free(bytes, at, content, boxEnd);
      removed.location = true;
    } else if (type === 'XMP_' || (type === 'uuid' && startsWith(bytes, XMP_UUID, content))) {
      removed.location ||= mentionsLocation(bytes.subarray(content, boxEnd));
      free(bytes, at, content, boxEnd);
      removed.other = true;
    }
    at = boxEnd;
  }
}

/**
 * The sample entries of timed metadata that hold where a camera was: GoPro's GPMF, Google's camera
 * motion metadata, and Sony's and DJI's real-time metadata. Refused under any track.
 */
const GPS_ENTRIES = new Set(['gpmd', 'camm', 'rtmd', 'djmd', 'dbgi']);

/**
 * Words naming a place in a timed-metadata key: Apple's `location` keys, and ISO 6709 coordinates
 * or GPS by any other name.
 */
const PLACE_WORDS = ['location', 'iso6709', 'gps', 'coordinate', 'latitude'];

const GPS_TRACK = "it has a track of timed metadata, such as a GoPro's or a drone's GPS";

/** Every child of `type` among the boxes from `start` to `end`. */
function children(bytes: Uint8Array, start: number, end: number, type: string): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    const child = readBox(bytes, at, end);
    if (child.type === type) found.push(child);
    at = child.end;
  }
  return found;
}

/**
 * Checks a track, a `trak` box's content: each of its media is pictures, sound, text or timecodes,
 * or timed metadata Lo can tell holds no place, and no sample entry is one of GPS. Timed metadata
 * keeps a place among the video's samples, where Lo can't take it out.
 */
function track(bytes: Uint8Array, content: number, end: number): void {
  const media = children(bytes, content, end, 'mdia');
  if (media.length === 0) unreadable(MALFORMED_MP4);
  for (const mdia of media) {
    const handlers = children(bytes, mdia.content, mdia.end, 'hdlr');
    if (handlers.length === 0) unreadable(MALFORMED_MP4);
    let timed = false;
    for (const hdlr of handlers) {
      // Version and flags, a pre-defined field, then the handler's type.
      if (hdlr.content + 12 > hdlr.end) unreadable(MALFORMED_MP4);
      const handler = fourcc(bytes, hdlr.content + 8);
      if (handler === 'meta') timed = true;
      else if (!PLAIN_TRACKS.has(handler)) {
        unreadable("it has a track Lo doesn't know, which may hold where it was filmed");
      }
    }
    // Every sample description, and every entry in each.
    for (const minf of children(bytes, mdia.content, mdia.end, 'minf')) {
      for (const stbl of children(bytes, minf.content, minf.end, 'stbl')) {
        for (const stsd of children(bytes, stbl.content, stbl.end, 'stsd')) {
          // Version and flags and a count, then the entries.
          let at = stsd.content + 8;
          while (at + 8 <= stsd.end) {
            const entry = readBox(bytes, at, stsd.end);
            sampleEntry(entry.type, bytes.subarray(entry.content, entry.end), timed);
            at = entry.end;
          }
        }
      }
    }
  }
}

/** Checks one sample entry, of `format`, holding `entry`, in a track of timed metadata when `timed`. */
function sampleEntry(format: string, entry: Uint8Array, timed: boolean): void {
  if (GPS_ENTRIES.has(format)) unreadable(GPS_TRACK);
  if (format === 'mebx') {
    if (PLACE_WORDS.some((word) => containsIgnoringCase(entry, word))) {
      unreadable('it has a track of timed metadata naming where it was filmed');
    }
  } else if (timed) {
    unreadable(GPS_TRACK);
  }
}

/**
 * A `meta` box: QuickTime's, whose children start at once, or ISO's, which has a version and flags
 * first. Its `keys` name the values in its `ilst`; those for a location become `free`.
 */
function meta(
  bytes: Uint8Array,
  content: number,
  end: number,
  depth: number,
  removed: RemovedMetadata,
): void {
  if (depth > MAX_BOX_DEPTH) unreadable(TOO_DEEP);
  const start = fourcc(bytes, content + 4) === 'hdlr' ? content : content + 4;
  const located: number[] = [];
  let at = start;
  while (at + 8 <= end) {
    const box = readBox(bytes, at, end);
    if (box.type === 'keys') {
      // Version and flags, a count, then each key's size, namespace and name.
      const BROKEN = 'its metadata keys are broken';
      let keyAt = box.content + 8;
      let index = 1;
      while (keyAt < box.end) {
        const size = u32be(bytes, keyAt) ?? unreadable(BROKEN);
        if (size < 8 || keyAt + size > box.end) unreadable(BROKEN);
        if (startsWith(bytes.subarray(keyAt + 8, keyAt + size), LOCATION_KEY)) located.push(index);
        keyAt += size;
        index++;
      }
    }
    at = box.end;
  }
  at = start;
  while (at + 8 <= end) {
    const box = readBox(bytes, at, end);
    if (box.type === 'ilst') {
      let item = box.content;
      while (item + 8 <= box.end) {
        const value = readBox(bytes, item, box.end);
        // An item's type is the index of its key.
        const key = u32be(bytes, item + 4) ?? 0;
        if (located.includes(key) || value.type === XYZ) {
          free(bytes, item, value.content, value.end);
          removed.location = true;
        }
        item = value.end;
      }
    } else if (box.type === 'udta' || box.type === 'meta') {
      walkBoxes(bytes, at, box.end, depth + 1, removed);
    } else if (box.type === 'xml ') {
      // ISO's XML in a `meta` box, which holds XMP.
      removed.location ||= mentionsLocation(bytes.subarray(box.content, box.end));
      free(bytes, at, box.content, box.end);
      removed.other = true;
    }
    at = box.end;
  }
}
