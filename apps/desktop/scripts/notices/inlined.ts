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

import type { Kept } from './kept.ts';
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
      'v4/core/regexes.js': '24fc98f6fc9175e50ff29d28b040e3b4ac5650de19914d45ee27b853d367ecc6',
    },
    why: 'one regular expression, adapted from a Stack Overflow answer, which is too short to hold a copyright',
  },
];

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

/** What a comment says when the code beside it is another project's, which a person has to read. */
const ATTRIBUTION = new RegExp(
  [
    String.raw`\b(?:adapted|ported|derived|forked|copied|taken|borrowed)\s+from\s+(?:https?://|github\.com)`,
    String.raw`\bfork of\b`,
    String.raw`\blicen[sc]e:\s*https?://`,
    String.raw`^\s*/\*!\s*[\w.-]+\.\s+(?:MIT|BSD|ISC|Apache)\b`,
  ].join('|'),
  'i',
);

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
): Found {
  const problems: string[] = [];
  const kept = new Set<Kept>();
  const readPackage = packageReader();
  const bundled = new Map(packages.map((pack) => [`${pack.name}@${pack.version}`, pack]));
  const extra = new Map<string, Bundled>();
  const all = packages.map((pack) => {
    const id = `${pack.name}@${pack.version}`;
    const scripts = pack.files.filter(isScript).flatMap((file) => {
      try {
        return [{ file, text: readFileSync(join(pack.dir, file), 'utf8') }];
      } catch {
        return [];
      }
    });

    // The entries for this package are of the version it's at, and of its files as they were read.
    for (const stale of new Set(
      entries
        .filter((entry) => nameOf(entry.in) === pack.name && !bundled.has(entry.in))
        .map((entry) => entry.in),
    )) {
      problems.push(
        `${id} is bundled, and scripts/notices/inlined.ts has what ${stale} holds of other projects: read ${pack.name} at ${pack.version} again and update it.`,
      );
    }
    const current = entries.filter((entry) => {
      if (entry.in !== id) return false;
      const changed = Object.entries(entry.files).filter(
        ([file, hash]) => hashOf(join(pack.dir, file)) !== hash,
      );
      for (const [file] of changed) {
        problems.push(
          `${id}'s ${file} isn't the file scripts/notices/inlined.ts was written from: read it again for code of other projects and update the entry.`,
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
      for (const [at, line] of lines.entries()) {
        if (!isComment(line)) continue;
        if (!covered.has(file) && ATTRIBUTION.test(line)) {
          problems.push(
            `${id}'s ${file}, line ${at + 1}, says "${line.trim().slice(0, 120)}", which may be code of another project, with a notice Lo is missing: read it, and add what it says to scripts/notices/inlined.ts.`,
          );
        }
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
