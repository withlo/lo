// Paths as the window keys them. A path that's UTF-8 is its own key; one that isn't is keyed by its
// bytes, since its text can read the same as another's. A key is what other features name a file
// by, as targets and the diff do.

import { fileKey, PATH_LIMIT, pathBytes, type TreePath } from '../contract.ts';

/**
 * The key of `path`, as `fileKey` makes it: its text when it's UTF-8, else a NUL, which no path
 * holds, and its bytes; for a path too long to key a map by, its digest. Main gives every such path
 * its digest, so one without is known by its length and its ends, which stay short.
 */
export function keyOf(path: TreePath): string {
  if (
    path.digest === undefined &&
    path.text.length > PATH_LIMIT / 4 &&
    pathBytes(path) > PATH_LIMIT
  ) {
    return `\0~${pathBytes(path)}:${path.text.slice(0, 32)}:${path.text.slice(-32)}`;
  }
  return fileKey(path);
}

const strict = new TextDecoder('utf-8', { fatal: true });
const lossy = new TextDecoder('utf-8');

/** The value of a hex digit's character code. */
function nibble(code: number): number {
  return code <= 0x39 ? code - 0x30 : code - 0x57;
}

/** The bytes `hex` spells, from byte `start` up to byte `end`. */
function hexBytes(hex: string, start = 0, end = hex.length / 2): Uint8Array {
  const bytes = new Uint8Array(Math.max(0, end - start));
  for (let at = 0; at < bytes.length; at++) {
    const index = (start + at) * 2;
    bytes[at] = (nibble(hex.charCodeAt(index)) << 4) | nibble(hex.charCodeAt(index + 1));
  }
  return bytes;
}

function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The path `bytes` make, with its bytes kept when they aren't UTF-8. */
function pathOfBytes(bytes: Uint8Array): TreePath {
  try {
    return { text: strict.decode(bytes) };
  } catch {
    return { text: lossy.decode(bytes), hex: bytesHex(bytes) };
  }
}

/** The folder `path` is in, or nothing for a path in the root. */
export function parentOf(path: TreePath): TreePath | undefined {
  if (path.hex === undefined) {
    const slash = path.text.lastIndexOf('/');
    return slash < 0 ? undefined : { text: path.text.slice(0, slash) };
  }
  const bytes = hexBytes(path.hex);
  const slash = bytes.lastIndexOf(0x2f);
  return slash < 0 ? undefined : pathOfBytes(bytes.subarray(0, slash));
}

/** The last name in `path`, as it shows. */
export function nameOf(path: TreePath): string {
  return path.text.slice(path.text.lastIndexOf('/') + 1);
}

/** The folder `path` is in, as it shows: `''` for the root. */
export function folderText(path: TreePath): string {
  const slash = path.text.lastIndexOf('/');
  return slash < 0 ? '' : path.text.slice(0, slash);
}

/** `path` for an address, each byte that isn't safe in one escaped, its slashes kept. */
export function addressPath(path: TreePath): string {
  const bytes = path.hex === undefined ? new TextEncoder().encode(path.text) : hexBytes(path.hex);
  let address = '';
  for (const byte of bytes) {
    const character = String.fromCharCode(byte);
    address += /[A-Za-z0-9\-._~/]/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return address;
}

/** The path a key names, as {@link keyOf} made it. */
export function pathOfKey(key: string): TreePath {
  if (!key.startsWith('\0')) return { text: key };
  const hex = key.slice(1);
  return { text: lossy.decode(hexBytes(hex)), hex };
}

/** The longest a name in the tree shows before its middle gives way to an ellipsis. */
export const NAME_SHOWN = 80;

/** `text`, with its middle cut out for an ellipsis when it's longer than `length` characters. */
export function middleOut(text: string, length: number = NAME_SHOWN): string {
  if (text.length <= length) return text;
  const start = Math.ceil((length - 1) / 3);
  return `${text.slice(0, start)}…${text.slice(text.length - (length - 1 - start))}`;
}

/**
 * Where the tree puts a file whose path is too long to key a map by: in the deepest of its folders
 * whose path is short enough, `undefined` for the root, named by the rest of its path, shortened in
 * the middle to `shown` characters. It reads only the start of the path and the ends of the rest.
 */
export function placeOf(
  path: TreePath,
  shown: number = NAME_SHOWN,
): { folder: TreePath | undefined; name: string } {
  if (path.hex === undefined) {
    let bytes = 0;
    let slash = -1;
    for (let at = 0; at < path.text.length && bytes <= PATH_LIMIT; at++) {
      const unit = path.text.charCodeAt(at);
      if (unit === 0x2f) slash = at;
      bytes += unit < 0x80 ? 1 : unit < 0x800 || (unit >= 0xd800 && unit <= 0xdfff) ? 2 : 3;
    }
    return {
      folder: slash > 0 ? { text: path.text.slice(0, slash) } : undefined,
      name: middleOut(path.text.slice(slash + 1), shown),
    };
  }
  const size = path.hex.length / 2;
  const slash = hexBytes(path.hex, 0, Math.min(size, PATH_LIMIT + 1)).lastIndexOf(0x2f);
  // The rest's two ends, each at most four bytes a character, are all a shortened name shows.
  const rest = size - slash - 1;
  const ends = shown * 4;
  const name =
    rest <= ends * 2
      ? lossy.decode(hexBytes(path.hex, slash + 1, size))
      : `${lossy.decode(hexBytes(path.hex, slash + 1, slash + 1 + ends))}…${lossy.decode(hexBytes(path.hex, size - ends, size))}`;
  return {
    folder: slash > 0 ? pathOfBytes(hexBytes(path.hex, 0, slash)) : undefined,
    name: middleOut(name, shown),
  };
}
