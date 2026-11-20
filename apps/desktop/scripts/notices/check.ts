// The license check: what Lo bundles must have a license a GPL-3.0 program can carry. A package
// with none, or under one not on this list, fails the build. A license joins the list in a reviewed
// change, and nothing is skipped.

import type { Package } from './packages.ts';

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

/**
 * What each allowed license's text says, to tell its file from another's in a package that carries
 * more than one, when the file's name doesn't. Those whose text is the same but for the name, as
 * `0BSD`'s and `ISC`'s are, are told by name alone.
 */
export const SIGNATURE: Readonly<Record<string, RegExp>> = {
  MIT: /Permission is hereby granted, free of charge/i,
  ISC: /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted, provided/i,
  'BSD-2-Clause': /Redistribution and use in source and binary forms/i,
  'BSD-3-Clause': /Redistribution and use in source and binary forms/i,
  'Apache-2.0': /Apache License/i,
  'MPL-2.0': /Mozilla Public License/i,
  'OFL-1.1': /SIL Open Font License/i,
  'CC0-1.0': /CC0|Creative Commons Zero/i,
  'BlueOak-1.0.0': /Blue Oak Model License/i,
  Unlicense: /free and unencumbered software/i,
};

/** A word of an SPDX expression: a parenthesis, `AND`, `OR`, `WITH`, or a license's or exception's id. */
const WORD = /\(|\)|[^\s()]+/g;

/** What reading an SPDX expression found: whether {@link ALLOWED} licenses satisfy it, and which. */
export interface Accepted {
  readonly ok: boolean;
  /** The licenses the package is taken under, as {@link ALLOWED} spells them. */
  readonly ids: readonly string[];
}

/**
 * Reads the SPDX license expression `expression`, and which of the {@link ALLOWED} licenses a
 * package under it is taken under. `MIT`, `(MIT OR Apache-2.0)` and `MIT AND BSD-3-Clause` are
 * satisfied, by `MIT`, by `MIT` (the first of the two that is allowed) and by both. `MIT OR
 * GPL-3.0-only` is, by `MIT`. `MIT AND GPL-3.0-only` isn't. Neither is a license with an exception
 * (`Apache-2.0 WITH LLVM-exception`) or an expression that doesn't read. Ids are compared without
 * regard to case, as SPDX does.
 */
export function accepted(expression: string): Accepted {
  const words = expression.match(WORD) ?? [];
  const known = new Map(ALLOWED.map((id) => [id.toLowerCase(), id]));
  let at = 0;

  /** The operator at the next word, if that's one. */
  const next = (): 'AND' | 'OR' | 'WITH' | undefined => {
    const word = words[at]?.toUpperCase();
    return word === 'AND' || word === 'OR' || word === 'WITH' ? word : undefined;
  };

  // A reading that fails throws: the whole expression reads as not allowed.
  function either(): Accepted {
    let found = both();
    while (next() === 'OR') {
      at++;
      // Both sides are read, so a malformed right side fails the whole expression.
      const other = both();
      // The first side that's allowed is the one the package is taken under.
      if (!found.ok && other.ok) found = other;
    }
    return found;
  }

  function both(): Accepted {
    let found = one();
    while (next() === 'AND') {
      at++;
      const other = one();
      found = { ok: found.ok && other.ok, ids: [...found.ids, ...other.ids] };
    }
    return found;
  }

  function one(): Accepted {
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
      return { ok: false, ids: [] };
    }
    const id = known.get(word.toLowerCase());
    return id === undefined ? { ok: false, ids: [] } : { ok: true, ids: [id] };
  }

  try {
    const found = either();
    return at === words.length ? found : { ok: false, ids: [] };
  } catch {
    return { ok: false, ids: [] };
  }
}

/** Whether {@link ALLOWED} licenses satisfy the SPDX license expression `expression`. */
export function allowed(expression: string): boolean {
  return accepted(expression).ok;
}

/** What's wrong with `packages`' licenses, one sentence for each package that has a problem. */
export function licenseProblems(
  packages: readonly Pick<Package, 'name' | 'version' | 'license' | 'text'>[],
): string[] {
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
      return [
        `${id} has no license file, so Lo has no notice of it to ship. If the package's repository has none either, UNLICENSED in scripts/notices/inlined.ts can write one from what the package says of its author.`,
      ];
    }
    return [];
  });
}
