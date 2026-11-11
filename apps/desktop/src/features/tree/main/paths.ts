// Paths as the tree sends them: the bytes git stores, as text Lo can show, with the bytes beside
// it when they aren't UTF-8, and back. Nothing here calls Electron.

import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';

import { PATH_LIMIT, type TreePath } from '../contract.ts';

/** The SHA-256 of `bytes` in hex, by which a path too long to key a map by is known. */
function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `bytes`, a path as git stores it, as the tree sends it. */
export function treePathOf(bytes: Uint8Array): TreePath {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = buffer.toString('utf8');
  const path: TreePath = isUtf8(buffer) ? { text } : { text, hex: buffer.toString('hex') };
  return buffer.length > PATH_LIMIT ? { ...path, digest: digestOf(buffer) } : path;
}

/** `text`, a path as GitHub gives it, as the tree sends it. */
export function textPathOf(text: string): TreePath {
  return treePathOf(Buffer.from(text, 'utf8'));
}

/** The bytes of a path the tree sent. */
export function bytesOf(path: TreePath): Buffer {
  return path.hex === undefined ? Buffer.from(path.text, 'utf8') : Buffer.from(path.hex, 'hex');
}

/** A path's bytes, one character a byte, to key maps by: two paths share a key only if equal. */
export function keyOfBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

/** The key of a path the tree sent, as {@link keyOfBytes} makes it. */
export function keyOf(path: TreePath): string {
  return keyOfBytes(bytesOf(path));
}

/**
 * The key main knows a changed file by: its path's bytes, one character a byte, or for a path too
 * long to key a map by, its digest after a NUL, which no path holds.
 */
export function changeKey(path: TreePath): string {
  return path.digest === undefined ? keyOf(path) : `\0#${path.digest}`;
}

/** The folder a key's path is in, as a key: `''` for the root. */
export function parentKey(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash < 0 ? '' : key.slice(0, slash);
}

/** The path a key names. */
export function pathOfKey(key: string): TreePath {
  return treePathOf(Buffer.from(key, 'latin1'));
}
