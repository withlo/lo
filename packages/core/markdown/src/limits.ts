/**
 * The limits that keep text from anyone cheap to show: Lo parses it under a deadline and a memory
 * cap, and the window lays it out on its main thread.
 */
export interface Limits {
  /** The most characters (code points) read; the rest is cut. GitHub's own limit for a body. */
  length: number;
  /** How deep the tree may nest; deeper content shows as plain text. */
  depth: number;
  /** The most nodes in the tree; past them, the rest shows as plain text. */
  nodes: number;
  /** The most images shown; the rest are links. */
  images: number;
  /**
   * The most characters in all its addresses together. A reference can name one long address any
   * number of times, which would make the tree far larger than its text.
   */
  addresses: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  length: 65_536,
  depth: 16,
  nodes: 32_768,
  images: 30,
  addresses: 131_072,
});

/** The most any limit may be raised to, so a mistaken value can't lift the guard. */
const CEILINGS: Readonly<Limits> = Object.freeze({
  length: 16 * 1024 * 1024,
  depth: 64,
  nodes: 1_048_576,
  images: 1_000,
  addresses: 64 * 1024 * 1024,
});

const KEYS: readonly (keyof Limits)[] = ['length', 'depth', 'nodes', 'images', 'addresses'];

/** The most diagnostics a tree keeps. */
export const MAX_DIAGNOSTICS = 100;

/** The longest address kept; a longer one is refused. */
export const MAX_ADDRESS = 8_192;

/**
 * `limits` with every missing or invalid value at its default: a limit is a whole number from 1
 * to its ceiling, and anything else falls back rather than lifting the guard.
 */
export function resolveLimits(limits: Partial<Limits> | undefined): Limits {
  const resolved = { ...DEFAULT_LIMITS };
  if (!limits) return resolved;
  for (const key of KEYS) {
    const value = limits[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
      resolved[key] = Math.min(value, CEILINGS[key]);
    }
  }
  return resolved;
}

/**
 * `text`'s first `length` code points, and whether that's not all of it. It reads no further than
 * it keeps, so a huge text costs no more than a short one, and never splits a surrogate pair.
 */
export function cut(text: string, length: number): { text: string; cut: boolean } {
  if (text.length <= length) return { text, cut: false };
  let points = 0;
  let index = 0;
  while (index < text.length && points < length) {
    const unit = text.charCodeAt(index);
    const pair =
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff;
    index += pair ? 2 : 1;
    points += 1;
  }
  return { text: text.slice(0, index), cut: index < text.length };
}
