// Paths as the window keys them. A path that's UTF-8 is its own key; one that isn't is keyed by its
// bytes, since its text can read the same as another's. A key is what other features name a file
// by, as targets and the diff do.

import type { TreePath } from '../contract.ts';

/** The key of `path`: its text when it's UTF-8, else a NUL, which no path holds, and its bytes. */
export function keyOf(path: TreePath): string {
  return path.hex === undefined ? path.text : `\0${path.hex}`;
}

const strict = new TextDecoder('utf-8', { fatal: true });
const lossy = new TextDecoder('utf-8');

function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let at = 0; at < bytes.length; at++) {
    bytes[at] = Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16);
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
