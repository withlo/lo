// Finding files by name, as ⌘P does: the query's characters in order anywhere in the path, ignoring
// case, best first. Paths are matched in chunks, giving way to main's other work between them, so a
// repository of half a million files doesn't hold up the window. Nothing here calls Electron.

import { FIND_LIMIT, type Found, type TreePath } from '../contract.ts';

/** How many paths are matched before giving way. */
export const CHUNK = 4_000;

/** A path matched: how well, and where. */
export interface Match {
  readonly score: number;
  /** The places in the text the query's characters matched, by UTF-16 index. */
  readonly matched: number[];
}

/** Whether `code`, a UTF-16 code unit, separates words in a path. */
function isSeparator(code: number): boolean {
  // / . _ - and space.
  return code === 0x2f || code === 0x2e || code === 0x5f || code === 0x2d || code === 0x20;
}

/**
 * How well `query`, already in lower case, matches `text`: its characters in order, each where it
 * scores best, or nothing when they aren't all there. A match scores more for characters in a row,
 * at the start of a name or word, and in the file's own name rather than its folders; and a shorter
 * path scores a little more than a longer one.
 */
export function match(query: string, text: string): Match | undefined {
  if (query === '') return { score: 0, matched: [] };
  const lower = text.toLowerCase();
  // The same length, so indices line up; a few characters change length in lower case.
  const haystack = lower.length === text.length ? lower : text;
  const name = text.lastIndexOf('/') + 1;
  // A quick refusal: the characters in order at all.
  let at = -1;
  for (const character of query) {
    at = haystack.indexOf(character, at + 1);
    if (at < 0) return undefined;
  }
  // Each character where it scores best, found greedily from the end, then from the start.
  const best = (from: 'start' | 'end'): { score: number; matched: number[] } | undefined => {
    const matched: number[] = [];
    if (from === 'end') {
      let position = haystack.length;
      for (let index = query.length - 1; index >= 0; index--) {
        position = haystack.lastIndexOf(query[index] ?? '', position - 1);
        if (position < 0) return undefined;
        matched.unshift(position);
      }
    } else {
      let position = -1;
      for (const character of query) {
        position = haystack.indexOf(character, position + 1);
        if (position < 0) return undefined;
        matched.push(position);
      }
    }
    let score = 0;
    for (const [index, position] of matched.entries()) {
      const before = position === 0 ? undefined : text.charCodeAt(position - 1);
      if (before === undefined || isSeparator(before)) score += 8;
      // An uppercase letter after a lowercase one starts a word too: camelCase.
      else if (text[position] !== haystack[position] && before !== undefined) score += 4;
      if (index > 0 && matched[index - 1] === position - 1) score += 6;
      if (position >= name) score += 3;
    }
    if (haystack.startsWith(query, name)) score += 20;
    return { score: score - text.length / 64, matched };
  };
  const ends = best('end');
  const starts = best('start');
  if (!ends) return starts;
  if (!starts) return ends;
  return starts.score > ends.score ? starts : ends;
}

/** A path to search, and whether the pull request changes it. */
export interface Searched {
  readonly path: TreePath;
  readonly changed: boolean;
}

/** What a search found: the best {@link FIND_LIMIT}, and how many matched in all. */
export interface Results {
  readonly found: Found[];
  readonly total: number;
}

/** A file found, with its match's score. */
interface Ranked {
  readonly found: Found;
  readonly score: number;
}

/** Changed files first, then the best matches, then path order. */
function rank(a: Ranked, b: Ranked): number {
  const [x, y] = [a.found.path.text, b.found.path.text];
  return (
    Number(b.found.changed) - Number(a.found.changed) ||
    b.score - a.score ||
    (x < y ? -1 : x > y ? 1 : 0)
  );
}

/**
 * Finds `query` in `paths`: changed files before the rest, then the best matches first, then path
 * order. It gives way to other work every {@link CHUNK} paths, and stops, throwing `stopped()`'s
 * error, once `stopped` says to.
 */
export async function find(
  query: string,
  paths: Iterable<Searched>,
  stopped: () => Error | undefined,
  limit: number = FIND_LIMIT,
): Promise<Results> {
  const wanted = query.toLowerCase().replaceAll(/\s+/g, '');
  let kept: Ranked[] = [];
  let total = 0;
  let count = 0;
  for (const { path, changed } of paths) {
    if (++count % CHUNK === 0) {
      await new Promise((resolve) => setImmediate(resolve));
      const error = stopped();
      if (error) throw error;
    }
    const found = match(wanted, path.text);
    if (!found) continue;
    total++;
    kept.push({ found: { path, changed, matched: found.matched }, score: found.score });
    // Keep the best few, sorting now and then rather than on every match.
    if (kept.length >= limit * 4) kept = kept.toSorted(rank).slice(0, limit);
  }
  const error = stopped();
  if (error) throw error;
  return {
    found: kept
      .toSorted(rank)
      .slice(0, limit)
      .map(({ found }) => found),
    total,
  };
}
