// Which of two versions of Lo is newer, by SemVer's precedence, so Lo offers only a newer one and
// never an older: whatever electron-updater decides, Lo checks again. Nothing here calls Electron,
// so it runs under unit tests.

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
