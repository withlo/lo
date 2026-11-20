// The license check: what Lo bundles must have a license a GPL-3.0 program can carry. A package
// with none, or under one not on this list, fails the build. A license joins the list in a reviewed
// change, and nothing is skipped.

import type { Bundled } from './packages.ts';

/** The licenses, as SPDX names them, that the packages Lo bundles may be under. */
export const ALLOWED: readonly string[] = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'MPL-2.0',
  'OFL-1.1',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Unlicense',
];

/** A word of an SPDX expression: a parenthesis, `AND`, `OR`, `WITH`, or a license's or exception's id. */
const WORD = /\(|\)|[^\s()]+/g;

/**
 * Whether the SPDX license expression `expression` is satisfied by the {@link ALLOWED} licenses:
 * `MIT`, `(MIT OR Apache-2.0)` and `MIT AND BSD-3-Clause` are, `MIT OR GPL-3.0-only` is (the
 * package may be taken under MIT), `MIT AND GPL-3.0-only` isn't, and neither is a license with an
 * exception (`Apache-2.0 WITH LLVM-exception`) or an expression that doesn't read. Ids are compared
 * without regard to case, as SPDX does.
 */
export function allowed(expression: string): boolean {
  const words = expression.match(WORD) ?? [];
  const ids = new Set(ALLOWED.map((id) => id.toLowerCase()));
  let at = 0;

  /** The operator at the next word, if that's one. */
  const next = (): 'AND' | 'OR' | 'WITH' | undefined => {
    const word = words[at]?.toUpperCase();
    return word === 'AND' || word === 'OR' || word === 'WITH' ? word : undefined;
  };

  // A reading that fails throws: the whole expression reads as not allowed.
  function either(): boolean {
    let ok = both();
    while (next() === 'OR') {
      at++;
      // Both sides are read, so a malformed right side fails the whole expression.
      const other = both();
      ok = ok || other;
    }
    return ok;
  }

  function both(): boolean {
    let ok = one();
    while (next() === 'AND') {
      at++;
      const other = one();
      ok = ok && other;
    }
    return ok;
  }

  function one(): boolean {
    const word = words[at++];
    if (word === undefined || word === ')' || /^(?:AND|OR|WITH)$/i.test(word)) {
      throw new Error('An SPDX expression has a license where this has none.');
    }
    if (word === '(') {
      const inside = either();
      if (words[at++] !== ')') throw new Error('An SPDX expression has a parenthesis unclosed.');
      return inside;
    }
    // An exception widens what the license permits: the license as it stands isn't the one allowed.
    if (next() === 'WITH') {
      at++;
      if (words[at++] === undefined) throw new Error('An SPDX expression has no exception.');
      return false;
    }
    return ids.has(word.toLowerCase());
  }

  try {
    const ok = either();
    return ok && at === words.length;
  } catch {
    return false;
  }
}

/** What's wrong with `packages`' licenses, one sentence for each package that has a problem. */
export function licenseProblems(packages: readonly Bundled[]): string[] {
  return packages.flatMap(({ name, version, license, text }) => {
    const id = `${name}@${version}`;
    if (license === undefined || license === '') {
      return [`${id} declares no license Lo can read, so Lo can't tell whether it may bundle it.`];
    }
    if (!allowed(license)) {
      return [
        `${id} is under ${license}, which isn't a license Lo carries (see scripts/notices/check.ts).`,
      ];
    }
    if (text === undefined || text === '') {
      return [`${id} has no license file, so Lo has no notice of it to ship.`];
    }
    return [];
  });
}
