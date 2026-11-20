// Code from other projects that a bundled package holds in its own files, which the package's license
// file doesn't cover and the notices need: a package may inline what it depends on in a build of its
// own, copy a file from another project, or carry that project's license in a folder of its own.
//
// What a build can find, it finds:
//
// - Code a package's own source map says came from other packages, which it inlined. Each of those
//   packages is listed with the license it carries.
// - A license or NOTICE file in a folder below a package's root, which the build bundled a file of.
// - A copyright line in a bundled file's comments that the package's license file doesn't hold.
//
// What it can't, a person reads, once, and records in {@link INLINED}: a comment that says a file is
// adapted or copied from another project, which fails the build until the code is in the list, and
// code that says nothing, as WebAssembly in a string doesn't. Each entry pins the files it's of by
// their hash, and the package by its version, so a new release of the package fails the build
// until someone reads it again.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { MIT_TERMS, type Kept } from './kept.ts';
import { packageReader, type Bundled } from './packages.ts';

/** What the notices need of what a package's files hold of another project's. */
export interface Inlined {
  /** The package that holds it, as `name@version`. */
  readonly in: string;
  /** The files that hold it, from the package's root, each with the SHA-256 of its text. */
  readonly files: Readonly<Record<string, string>>;
  /** What the code is and the license it carries. Absent when the code carries none: see `why`. */
  readonly carries?: Kept;
  /** Why the code needs no notice, when `carries` is absent. */
  readonly why?: string;
}

const MIT = 'MIT' as const;
const APACHE = 'Apache-2.0' as const;

/** What both versions of entities adapted: `he`'s decoding of a code point. */
const HE: Kept = {
  repo: 'mathiasbynens/he',
  provides: "the decoding of a code point in entities' dist/decode-codepoint.js, adapted from it",
  license: MIT,
  copyright: ['Copyright Mathias Bynens <https://mathiasbynens.be/>'],
};

/** The packages' prebuilt files that were read for code from elsewhere. */
export const INLINED: readonly Inlined[] = [
  {
    in: 'undici@8.12.4',
    files: {
      'lib/llhttp/llhttp-wasm.js':
        '5d8313d6fe8145d832e6af9959b2810523c9a6993d5b93cee09bd7e5f1f2c085',
      'lib/llhttp/llhttp_simd-wasm.js':
        'a3f30f3307ab3c191720cb636d570febb3610c420bc7077f2e225dacfcad3295',
    },
    carries: {
      repo: 'nodejs/llhttp',
      provides: "the HTTP parser inlined in undici's lib/llhttp, as WebAssembly",
      license: MIT,
      copyright: ['Copyright © 2018 Fedor Indutny'],
    },
  },
  {
    in: 'undici@8.12.4',
    files: {
      'lib/web/fetch/body.js': '2c2aff098cf44c90acfe5ccd1bf6ac24a879531ae64c52f76ce13d9960d8bdff',
    },
    carries: {
      repo: 'jimmywarting/FormData',
      provides: "the form data encoding in undici's lib/web/fetch/body.js",
      license: MIT,
      copyright: ['Copyright (c) 2016 Jimmy Karl Roland Wärting'],
    },
  },
  {
    in: 'undici@8.12.4',
    files: {
      'lib/web/websocket/frame.js':
        '883d40c52b86f43619074911d81830d80f29cb605a4e01a128b196e2ab666d63',
      'lib/web/websocket/receiver.js':
        'd58a5e8bb0da2dcbc51cc0b668213357a12cfd5cb03e700883c488460ce9f015',
    },
    carries: {
      repo: 'websockets/ws',
      provides: "the WebSocket frame code in undici's lib/web/websocket",
      license: MIT,
      copyright: [
        'Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>',
        'Copyright (c) 2013 Arnout Kazemier and contributors',
        'Copyright (c) 2016 Luigi Pinca and contributors',
      ],
    },
  },
  {
    in: 'yauzl@3.4.0',
    files: { 'fd-slicer.js': 'fa8868a9879ce50db8cbec36d487424af112bd5b0c433831968441ec50d7616a' },
    carries: {
      repo: 'andrewrk/node-fd-slicer',
      provides: "yauzl's fd-slicer.js, adapted from it",
      license: MIT,
      copyright: ['Copyright (c) 2014 Andrew Kelley'],
    },
  },
  {
    in: 'yauzl@3.4.0',
    files: { 'crc32.js': '7bf6476c8e4984418943aa4eb6743c859d723d5e9a7278d61d34457d2554cec4' },
    carries: {
      repo: 'brianloveswords/buffer-crc32',
      at: 'v0.2.13',
      provides: "yauzl's crc32.js, adapted from it",
      license: MIT,
      copyright: ['Copyright (c) 2013 Brian J. Brennan'],
    },
  },
  ...(
    [
      ['8.1.0', 'dddf76e72987697316e647f046b2755dafe16308fe83159969b3155e0ebf3beb'],
      ['9.0.0', 'c5c52b66256cc5a84b84a516ed78cc76256ec99c47344041f11d3e67010c4a64'],
    ] as const
  ).map(([version, hash]): Inlined => ({
    in: `entities@${version}`,
    files: { 'dist/decode-codepoint.js': hash },
    carries: HE,
  })),
  {
    in: '@base-ui/react@1.9.0',
    files: {
      'floating-ui-react/utils/event.mjs':
        '2ab49565b061e344f315a30524cdaad58b2048ce25f26084b6503c8c4f878d11',
    },
    // React Spectrum's NOTICE file lists the other projects it took code from, none of it this.
    carries: {
      repo: 'adobe/react-spectrum',
      provides: "the virtual event checks in Base UI's floating-ui-react/utils/event.mjs",
      license: APACHE,
      copyright: ['Copyright 2022 Adobe. All rights reserved.'],
    },
  },
  {
    in: '@base-ui/react@1.9.0',
    files: {
      'floating-ui-react/middleware/arrow.mjs':
        'acd5abfa371896b333a6b8923173741fbbb3d3c6a09aabc94a82b9e069c45f26',
    },
    // The whole of Base UI's floating-ui-react folder is its fork of @floating-ui/react.
    carries: {
      repo: 'floating-ui/floating-ui',
      provides: "Base UI's floating-ui-react folder, which is a fork of @floating-ui/react",
      license: MIT,
      copyright: ['Copyright (c) 2021 Floating UI contributors'],
    },
  },
  {
    in: '@floating-ui/react-dom@2.1.9',
    files: {
      'dist/floating-ui.react-dom.mjs':
        '2f39fd6f12c3989fa13d9ac5104e7739e5f15cc8dee01d63fc06e0f44bba8771',
    },
    carries: {
      repo: 'epoberezkin/fast-deep-equal',
      provides:
        "the comparison in @floating-ui/react-dom's dist/floating-ui.react-dom.mjs, a fork of it",
      license: MIT,
      copyright: ['Copyright (c) 2017 Evgeny Poberezkin'],
    },
  },
  {
    in: '@replit/codemirror-vim-core@0.1.0',
    files: { 'vim.js': 'a8c2887193e966a6d1c4acf01105a0b6e8ed11e8ff26dfe3bb8a898649efe650' },
    why: "CodeMirror 5's vim mode, whose MIT license and holder, Marijn Haverbeke, the package's license file has",
  },
  {
    in: 'fs-extra@10.1.0',
    files: {
      'lib/fs/index.js': '620b6e703880fd6718c354c5359a5c37a2379054c037269dbcf7afd2503e4a6f',
    },
    carries: {
      repo: 'normalize/mz',
      provides: "fs-extra's lib/fs/index.js, adapted from it",
      license: MIT,
      copyright: ['Copyright (c) 2014-2016 Jonathan Ong me@jongleberry.com and Contributors'],
    },
  },
  {
    in: 'fs-extra@10.1.0',
    files: {
      'lib/mkdirs/utils.js': '5372a36f4b2c5023788c23dbc6639155cb016a1b111e8fc1d6bf97cbaf11b1f8',
    },
    carries: {
      repo: 'sindresorhus/make-dir',
      provides: "fs-extra's lib/mkdirs/utils.js, adapted from it",
      license: MIT,
      copyright: [
        'Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)',
      ],
    },
  },
  {
    in: 'web-tree-sitter@0.27.2',
    files: {
      'web-tree-sitter.js': '44626cc32a7b6878a10be084b58b471d9c47c1e2082cd5a5e34c8a41431f0c2d',
    },
    carries: {
      repo: 'emscripten-core/emscripten',
      provides: 'the Emscripten runtime in web-tree-sitter.js, which loads and runs WebAssembly',
      license: MIT,
      copyright: ['Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.'],
    },
  },
  {
    in: 'zod@4.6.7',
    files: {
      'v4/core/schemas.js': '0ee56e8afbae28eeb1060a162ad7e56f0675ee6fb83f0ae56bea2e088f6cdbc0',
    },
    carries: {
      repo: 'fabian-hiller/valibot',
      provides: "the Luhn checksum in zod's v4/core/schemas.js, adapted from it",
      license: MIT,
      copyright: ['Copyright (c) Fabian Hiller'],
    },
  },
  {
    in: 'zod@4.6.7',
    files: {
      'v4/core/regexes.js': '24fc98f6fc9175e50ff29d28b040e3b4ac5650de19914d45ee27b853d367ecc6',
    },
    why: 'a few short regular expressions (an email, emoji, base64, hostname, phone number and date) from Stack Overflow answers and blog posts, each too short to hold a copyright',
  },
  {
    in: '@base-ui/react@1.9.0',
    files: {
      'floating-ui-react/utils/markOthers.mjs':
        'f2ec53bb31e105a8f3d43669aa6ec440be34fc55ea9bbc01b7387b0182d411f8',
    },
    carries: {
      repo: 'theKashey/aria-hidden',
      at: '9220c8f4a4fd35f63bee5510a9f41a37264382d4',
      provides:
        "the hiding of everything but a popup in Base UI's floating-ui-react/utils/markOthers.mjs, modified from it",
      license: MIT,
      copyright: ['Copyright (c) 2017 Anton Korzunov'],
    },
  },
  {
    in: '@base-ui/utils@0.5.0',
    files: {
      'platform/engine.mjs': '44d516640670a6b2f77074781d80d88403d3c8f413a3a3bb45b0e74d4b39f58d',
    },
    why: "a comment that Blink forked from WebKit, which is about browsers, not about this file's code",
  },
  {
    in: 'lodash.escaperegexp@4.1.2',
    files: { 'index.js': '584de6ec78e35344eaef8291338a671f223ec225c4df4220b6f91d8f0c004d8d' },
    why: "Underscore.js's code, whose license and holder, Jeremy Ashkenas, the package's license file has",
  },
  {
    in: 'lodash.isequal@4.5.0',
    files: { 'index.js': 'e552928a511748303101cfd03826a777cfa359eade6a4a60f92c923edbf9184c' },
    why: "Underscore.js's code, whose license and holder, Jeremy Ashkenas, the package's license file has",
  },
  {
    in: 'undici@8.12.4',
    files: {
      'lib/core/util.js': 'f66443ee69b3ae34ea7ebfab4df71a0b87ac990769aaf76b278739dee8aedb7c',
    },
    why: "one regular expression for a header's characters, lifted from Node.js, which is too short to hold a copyright",
  },
];

/** A package that ships no license file, with the license it says it is under written out for it. */
export interface Unlicensed {
  /** The package, as `name@version`. */
  readonly in: string;
  readonly license: 'MIT';
  /** Its copyright line, from what the package says of its author. */
  readonly copyright: readonly string[];
}

/**
 * The packages whose tarballs, and whose repositories too, have no license file. Each says it is
 * under the MIT License, and names its author, which is all the notice there is to ship.
 */
export const UNLICENSED: readonly Unlicensed[] = [
  { in: 'lazy-val@1.0.5', license: 'MIT', copyright: ['Copyright (c) Vladimir Krivosheev'] },
];

/** The text of `entry`'s license, written out, as its package would carry it. */
function textOfUnlicensed(entry: Unlicensed): string {
  return [`${entry.license} License`, '', ...entry.copyright, '', MIT_TERMS].join('\n');
}

/** The name of a `name@version` id, which may begin with the `@` of a scope. */
function nameOf(id: string): string {
  return id.slice(0, id.lastIndexOf('@'));
}

/** The SHA-256 of the text of `path`, in hex. Absent when it can't be read. */
function hashOf(path: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return undefined;
  }
}

/** Whether a package's file is JavaScript, which a comment in it can be searched for. */
function isScript(file: string): boolean {
  return /\.[cm]?js$/.test(file);
}

/** A line of a comment: the line begins with a comment's mark. */
function isComment(line: string): boolean {
  return /^\s*(?:\/\*|\/\/|\*|#)/.test(line);
}

/** What a comment says when it says code is taken from another project, and changed, or not. */
const TAKEN = 'adapted|ported|forked|copied|taken|borrowed|modified|lifted';

/**
 * What a comment says when the code beside it is another project's, which a person has to read:
 * that it's adapted, ported, forked, copied, taken, borrowed, modified or lifted `from` something,
 * with a link or without, or a fork of it; that its license is at a link; or a banner that names
 * the project and its license, as `/*! name. MIT License.` does. Some of what it finds is a
 * comment on the code itself, which a person reads into the list as nothing to carry.
 */
const ATTRIBUTION = new RegExp(
  [
    String.raw`\b(?:${TAKEN})\s+(?:from|off)\b`,
    String.raw`\bfork of\b`,
    String.raw`\blicen[sc]e:\s*https?://`,
    String.raw`^\s*/\*!\s*[\w.-]+\.\s+(?:MIT|BSD|ISC|Apache)\b`,
  ].join('|'),
  'i',
);

/**
 * What "based on" and "derived from" say: they're so often about the code itself ("based on the
 * level") that they find another project's only when the line also has a link, names a license or
 * says what it is, a library, package, module or project (but a package manager), or names it with a capital, `.js` or a
 * repository's `owner/name`.
 */
const DERIVED = /\b(?:based|derived)\s+(?:on|from|upon)\b/i;
const CLUE =
  /https?:\/\/|\bgithub\.com\/|\b(?:MIT|BSD|ISC|Apache|MPL|GPL|LGPL|CC0|Unlicense)\b|\blicen[sc]es?\b|\b(?:library|module|project|polyfill|implementation|repository)\b|\bpackage\b(?!\s+manager)/i;
const NAMED =
  /\b(?:[Bb]ased|[Dd]erived)\s+(?:on|from|upon)\s+(?:the\s+)?(?:[A-Z][\w.-]*|[\w-]+\.js\b|[\w@-]+\/[\w.-]+)/;

/**
 * A comment that begins by saying code is taken from elsewhere, such as "Modified to add support:",
 * and then, on the next line, gives a link to where.
 */
const BEGINS = new RegExp(
  String.raw`^\s*(?:/\*+!?|//|\*)\s*(?:this\s+(?:is|was)\s+)?(?:${TAKEN}|based|derived)\b`,
  'i',
);

/** A link, to a site or to a repository on GitHub. */
const LINK = /https?:\/\/|\bgithub\.com\//i;

/** The lines of `lines`, as `[index, line]`, that say the code beside them is of another project. */
function attributions(lines: readonly string[]): [number, string][] {
  const found: [number, string][] = [];
  for (const [at, line] of lines.entries()) {
    if (!isComment(line)) continue;
    const next = lines[at + 1];
    if (
      ATTRIBUTION.test(line) ||
      (DERIVED.test(line) && (CLUE.test(line) || NAMED.test(line))) ||
      (BEGINS.test(line) && next !== undefined && isComment(next) && LINK.test(next))
    ) {
      found.push([at, line]);
    }
  }
  return found;
}

/** A comment's copyright line, with who holds it after the year. */
const COPYRIGHT = /^\s*(?:\/\*+!?|\/\/|\*|#)\s*(?:@copyright\s+)?((?:copyright\b|\(c\)|©).*)$/i;

/** Text as the words of its letters and digits, lower-cased, to compare without its spacing. */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether `license`, the text of a package's license, holds the holder of the copyright `line`:
 * the first two words after its year.
 */
function holds(license: string, line: string): boolean {
  const who = line
    .replace(/^(?:copyright\b|\(c\)|©)\s*(?:\(c\)|©)?[\s:]*/i, '')
    .replace(/^(?:(?:19|20)\d\d(?:\s*[-–,]\s*(?:(?:19|20)\d\d|present))*[,.]?\s*)/i, '')
    .replace(/^by\s+/i, '');
  const first = words(who).split(' ').slice(0, 2).join(' ');
  return first === '' || words(license).includes(first);
}

/** What a package's source map says of the packages it holds. */
const sourceMap = z.object({ sources: z.array(z.string()) });

/** The names of the packages in a source map's `sources`, as folders of `node_modules`. */
function packagesIn(text: string): string[] {
  const names = new Set<string>();
  for (const source of sourceMap.parse(JSON.parse(text)).sources) {
    const all = [...source.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//g)];
    const last = all.at(-1)?.[1];
    if (last !== undefined) names.add(last);
  }
  return [...names].toSorted();
}

/** The source map a built file points to, as text: its file's, or inline. Absent when none. */
function mapOf(file: string, text: string): string | undefined {
  const url = /\/\/[#@] sourceMappingURL=(\S+)\s*$/.exec(text)?.[1];
  if (url === undefined) return undefined;
  const inline = /^data:application\/json[^,]*;base64,(.*)$/.exec(url)?.[1];
  if (inline !== undefined) return Buffer.from(inline, 'base64').toString('utf8');
  try {
    return readFileSync(join(dirname(file), decodeURIComponent(url)), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * What's wrong with the entries of a package that's no longer bundled, or is at another version:
 * each is of a version of a package, as it was read, so one that isn't bundled is for a person to
 * remove, or to read again at the version that is.
 */
function staleEntries(
  packages: readonly Bundled[],
  entries: readonly Inlined[],
  unlicensed: readonly Unlicensed[],
): string[] {
  const bundled = new Set(packages.map((pack) => `${pack.name}@${pack.version}`));
  const listed = new Set([...entries, ...unlicensed].map((entry) => entry.in));
  return [...listed]
    .filter((id) => !bundled.has(id))
    .toSorted()
    .map((id) => {
      const name = nameOf(id);
      const now = [...bundled].filter((each) => nameOf(each) === name);
      const lacking = now.filter((each) => !listed.has(each));
      const how =
        lacking.length === 0
          ? 'remove it.'
          : `${name} is bundled at ${lacking.map((each) => each.slice(name.length + 1)).join(' and ')} now: read it again there and update the entry, or remove the entry if the package needs none.`;
      return `scripts/notices/inlined.ts has an entry for ${id}, which isn't bundled any more: ${how}`;
    });
}

/** What reading the bundled packages' files for code of other projects found. */
export interface Found {
  /** The packages, with those inlined in them, and what their files say that their license doesn't. */
  readonly packages: Bundled[];
  /** The entries of {@link INLINED} for what the packages hold. */
  readonly kept: Kept[];
  /** What a person has to look at, one sentence each. */
  readonly problems: string[];
}

/**
 * Finds what each of `packages` holds of other projects, from the files the build bundled of it,
 * which are on disk at the package's folder.
 */
export function inlinedCode(
  packages: readonly Bundled[],
  entries: readonly Inlined[] = INLINED,
  unlicensed: readonly Unlicensed[] = UNLICENSED,
): Found {
  const problems: string[] = [];
  problems.push(...staleEntries(packages, entries, unlicensed));
  const kept = new Set<Kept>();
  const readPackage = packageReader();
  const bundled = new Map(packages.map((pack) => [`${pack.name}@${pack.version}`, pack]));
  const extra = new Map<string, Bundled>();
  const all = packages.map((first) => {
    const id = `${first.name}@${first.version}`;
    // A package with no license file has the text its entry writes, if its license is the entry's.
    const written = unlicensed.find((each) => each.in === id);
    const pack: Bundled =
      first.text === undefined && written !== undefined && first.license === written.license
        ? { ...first, text: textOfUnlicensed(written) }
        : first;
    const scripts = pack.files.filter(isScript).flatMap((file) => {
      try {
        return [{ file, text: readFileSync(join(pack.dir, file), 'utf8') }];
      } catch {
        return [];
      }
    });

    // The entries for this package are of its files as they were read.
    const current = entries.filter((entry) => {
      if (entry.in !== id) return false;
      const changed = Object.entries(entry.files).flatMap(([file, hash]) => {
        const now = hashOf(join(pack.dir, file));
        return now === hash ? [] : [{ file, now }];
      });
      for (const { file, now } of changed) {
        problems.push(
          now === undefined
            ? `${id} has no ${file}, which scripts/notices/inlined.ts was written from: read ${pack.name} again for code of other projects and update the entry.`
            : `${id}'s ${file} isn't the file scripts/notices/inlined.ts was written from: read it again for code of other projects and, if it holds nothing more, set the entry's hash to ${now}.`,
        );
      }
      return changed.length === 0;
    });
    for (const entry of current) if (entry.carries) kept.add(entry.carries);
    const covered = new Set(current.flatMap((entry) => Object.keys(entry.files)));

    const says = new Set<string>();
    const license = [pack.text, pack.notice, ...pack.nested.map((each) => each.text)].join('\n');
    for (const { file, text } of scripts) {
      // Packages built into this file, as its own source map says.
      const map = mapOf(join(pack.dir, file), text);
      for (const name of map === undefined ? [] : packagesIn(map)) {
        if (name === pack.name) continue;
        const folder = join(
          pack.name.startsWith('@') ? dirname(dirname(pack.dir)) : dirname(pack.dir),
          name,
        );
        const inner = readPackage(join(folder, 'package.json'));
        if (inner === undefined) {
          problems.push(
            `${id}'s ${file} has ${name} built into it, and ${name} isn't installed beside it, so Lo can't find its license.`,
          );
          continue;
        }
        const key = `${inner.name}@${inner.version}`;
        if (!bundled.has(key)) extra.set(key, { ...inner, files: [], nested: [], in: id });
      }

      const lines = text.split('\n');
      if (!covered.has(file)) {
        for (const [at, line] of attributions(lines)) {
          problems.push(
            `${id}'s ${file}, line ${at + 1}, says "${line.trim().slice(0, 120)}", which may be code of another project, with a notice Lo is missing: read it, and add what it says to scripts/notices/inlined.ts.`,
          );
        }
      }
      for (const line of lines) {
        if (!isComment(line)) continue;
        const holder = COPYRIGHT.exec(line)?.[1];
        if (holder !== undefined && !covered.has(file) && !holds(license, holder)) {
          says.add(holder.replace(/\s*\*\/\s*$/, '').trim());
        }
      }
    }
    return says.size === 0 ? pack : { ...pack, says: [...says].toSorted() };
  });
  return { packages: [...all, ...extra.values()], kept: [...kept], problems };
}
