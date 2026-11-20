// Which versions of Lo this one takes: only a newer one, by SemVer's precedence, and a prerelease
// only when this Lo is one too. Whatever electron-updater decides, Lo checks again. Nothing here
// calls Electron, so it runs under unit tests.

import { isVersion } from '../contract.ts';

/** A version's parts: its three numbers, and its prerelease identifiers, if any. */
function parts(version: string): { core: readonly bigint[]; pre: readonly string[] } {
  const [core = '', ...pre] = version.split('-');
  return {
    core: core.split('.').map((number) => BigInt(number)),
    pre: pre.length === 0 ? [] : pre.join('-').split('.'),
  };
}

/** Whether a prerelease identifier is a number. */
function numeric(identifier: string): boolean {
  return /^\d+$/.test(identifier);
}

/** How two prerelease identifiers order: numbers by value, below words, which order as text. */
function compareIdentifiers(a: string, b: string): number {
  if (numeric(a) && numeric(b)) {
    const [x, y] = [BigInt(a), BigInt(b)];
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (numeric(a)) return -1;
  if (numeric(b)) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** How `a` and `b` order by SemVer's precedence: below 0 when `a` is older, above when newer. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let at = 0; at < 3; at += 1) {
    const [p = 0n, q = 0n] = [x.core[at], y.core[at]];
    if (p !== q) return p < q ? -1 : 1;
  }
  // A version without a prerelease part is newer than any with one.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let at = 0; at < Math.max(x.pre.length, y.pre.length); at += 1) {
    const [p, q] = [x.pre[at], y.pre[at]];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const order = compareIdentifiers(p, q);
    if (order !== 0) return order;
  }
  return 0;
}

/** Whether `offered` is a version Lo is released as, and newer than `current`. */
export function isNewer(offered: string, current: string): boolean {
  return isVersion(offered) && isVersion(current) && compareVersions(offered, current) > 0;
}

/** Whether `version` is a prerelease, such as `0.2.0-rc.1`. */
export function isPrerelease(version: string): boolean {
  return parts(version).pre.length > 0;
}

/**
 * Whether this Lo, at `current`, takes `offered`: a newer version, as {@link isNewer} says, and a
 * prerelease only when `current` is one too. A release is never offered a prerelease, whatever
 * GitHub calls its latest release; a prerelease is offered the release of its own version or a
 * later one, and later prereleases.
 */
export function takes(current: string, offered: string): boolean {
  return isNewer(offered, current) && (isPrerelease(current) || !isPrerelease(offered));
}
