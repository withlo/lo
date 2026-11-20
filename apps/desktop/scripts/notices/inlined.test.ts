import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INLINED, UNLICENSED, inlinedCode, type Inlined, type Unlicensed } from './inlined.ts';
import type { Kept } from './kept.ts';
import { packageReader, type Bundled } from './packages.ts';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lo-inlined-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `files` under `root`, making the folders. */
function put(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A package installed beside the others in pnpm's layout, with its manifest and license. */
function install(name: string, version: string, files: Record<string, string> = {}): string {
  const folder = `node_modules/.pnpm/${name.replace('/', '+')}@${version}/node_modules/${name}`;
  put({
    [`${folder}/package.json`]: JSON.stringify({ name, version, license: 'MIT' }),
    [`${folder}/LICENSE`]: `${name} license, Copyright (c) ${name} authors`,
    ...Object.fromEntries(Object.entries(files).map(([file, text]) => [`${folder}/${file}`, text])),
  });
  return join(root, folder);
}

/** A package installed beside the unscoped one at `dir`, as pnpm lays out a package's dependencies. */
function beside(dir: string, name: string, version: string): string {
  const folder = join(dirname(dir), name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
  writeFileSync(join(folder, 'LICENSE'), `${name} license, Copyright (c) ${name} authors`);
  return folder;
}

/** The package at `dir`, as a bundle that has `files` of it holds it. */
function bundle(dir: string, files: string[]): Bundled {
  const found = packageReader()(join(dir, 'package.json'));
  if (!found) throw new Error(`There's no package at ${dir}.`);
  return { ...found, files, nested: [] };
}

/** What reading `packages` finds, by the entries given, and by none unless they are. */
function code(
  packages: readonly Bundled[],
  entries: readonly Inlined[] = [],
  unlicensed: readonly Unlicensed[] = [],
) {
  return inlinedCode(packages, entries, unlicensed);
}

const kept: Kept = {
  repo: 'o/copied',
  provides: 'a function',
  license: 'MIT',
  copyright: ['Copyright (c) Someone'],
};

/** An `outer` package with a built file that has a source map of `sources`. */
function outerWith(sources: string[], inline = false): { dir: string; pack: Bundled } {
  const map = JSON.stringify({ version: 3, sources, mappings: '' });
  const comment = inline
    ? `data:application/json;base64,${Buffer.from(map).toString('base64')}`
    : 'index.min.js.map';
  const dir = install('outer', '1.0.0', {
    'dist/index.min.js': `var x=1;\n//# sourceMappingURL=${comment}\n`,
    ...(inline ? {} : { 'dist/index.min.js.map': map }),
  });
  return { dir, pack: bundle(dir, ['dist/index.min.js']) };
}

/** The problems of a package whose file `a.js` is `text`. */
function problemsOf(text: string, entries: readonly Inlined[] = []): string[] {
  const dir = install('pkg', '1.0.0', { 'a.js': text });
  return code([bundle(dir, ['a.js'])], entries).problems;
}

/** What reading `pkg` finds, at the version and with the file it's given. */
function foundIn(version: string, file: string, entries: readonly Inlined[]) {
  const dir = install('pkg', version, { 'a.js': file });
  return code([bundle(dir, ['a.js'])], entries);
}

/** What `a.js`, with `comment` in it, adds of its package under the license `license`. */
function saysOf(comment: string, entries: readonly Inlined[] = []): readonly string[] | undefined {
  const dir = install('pkg', '1.0.0', { 'a.js': `${comment}\nvar x;\n` });
  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) 2020 Alice Example\n');
  return code([bundle(dir, ['a.js'])], entries).packages[0]?.says;
}

/** The folder of `name@version` in the workspace's node_modules, installed as pnpm lays them out. */
function installedAt(id: string): string | undefined {
  const at = id.lastIndexOf('@');
  const name = id.slice(0, at);
  const store = join(import.meta.dirname, '..', '..', '..', '..', 'node_modules', '.pnpm');
  for (const folder of readdirSync(store)) {
    if (!folder.startsWith(`${name.replace('/', '+')}@${id.slice(at + 1)}`)) continue;
    const dir = join(store, folder, 'node_modules', name);
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return undefined;
}

describe('inlinedCode', () => {
  describe('the packages a built file says it has built into it', () => {
    it('lists each, from beside the package, with the package it is built into', () => {
      const { dir, pack } = outerWith([
        '../../node_modules/inner/src/a.ts',
        '../../node_modules/inner/src/b.ts',
        '../../node_modules/@scope/scoped/src/c.ts',
        '../../src/outer.ts',
      ]);
      beside(dir, 'inner', '2.1.0');
      beside(dir, '@scope/scoped', '3.0.0');
      const found = code([pack]);
      expect(found.problems).toEqual([]);
      expect(
        found.packages.map(({ name, version, in: into, license }) => [
          name,
          version,
          into,
          license,
        ]),
      ).toEqual([
        ['outer', '1.0.0', undefined, 'MIT'],
        ['@scope/scoped', '3.0.0', 'outer@1.0.0', 'MIT'],
        ['inner', '2.1.0', 'outer@1.0.0', 'MIT'],
      ]);
      expect(found.packages[2]?.text).toBe('inner license, Copyright (c) inner authors');
    });

    it('reads a map that is inline', () => {
      const { dir, pack } = outerWith(['../../node_modules/inner/src/a.ts'], true);
      beside(dir, 'inner', '2.1.0');
      expect(code([pack]).packages.map((each) => each.name)).toEqual(['outer', 'inner']);
    });

    it('lists none that is a package of its own in the bundle, however it is built into another', () => {
      const { dir, pack } = outerWith(['../../node_modules/inner/src/a.ts']);
      const inner = beside(dir, 'inner', '2.1.0');
      const found = code([pack, bundle(inner, ['index.js'])]);
      expect(found.packages.map((each) => each.in)).toEqual([undefined, undefined]);
    });

    it('is a problem when what it has built into it is not installed beside it, since its license is not found', () => {
      const found = code([outerWith(['../../node_modules/missing/src/a.ts']).pack]);
      expect(found.problems).toEqual([
        expect.stringMatching(/^outer@1\.0\.0's dist\/index\.min\.js has missing built into it/),
      ]);
      expect(found.packages.map((each) => each.name)).toEqual(['outer']);
    });

    it('has none, of a file with no source map or one that is not there', () => {
      const dir = install('plain', '1.0.0', {
        'a.js': 'x\n',
        'b.js': 'x\n//# sourceMappingURL=b.js.map\n',
      });
      expect(code([bundle(dir, ['a.js', 'b.js'])])).toMatchObject({ problems: [] });
    });
  });

  describe('a comment that says code is from another project', () => {
    it.each([
      '// Adapted from https://github.com/someone/thing/blob/v1/index.js',
      '  * Ported from github.com/someone/thing',
      '// This was adapted from https://github.com/andrewrk/node-fd-slicer by Andrew Kelley',
      '// Fork of the original `arrow` middleware from Floating UI',
      '// License: https://github.com/adobe/react-spectrum/blob/main/LICENSE',
      '// Distributed under an MIT license: https://codemirror.net/5/LICENSE',
      '/*! formdata-polyfill. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */',
      // With no link, for the name of what it's from.
      '/** Luhn checksum on a digit-only string. Adapted from valibot (MIT). */',
      '// Modified from qux',
      '// headerCharRegex have been lifted from',
      '// Taken from the foo module',
      '// Copied from foo',
      // "Based on" and "derived from" with a license, a link, what it is or a name.
      '// Based on the qux library (BSD)',
      '// Derived from Foo, which is under the ISC license',
      '// This is based on the qux package',
      ' * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>',
      '// based on https://example.com/some/thing',
      '// Based on Foo',
      // What isn't another project's code, but reads like it, is read into the list.
      '// Blink forked from WebKit in 2013',
    ])('fails the build until it is looked at: %s', (comment) => {
      expect(problemsOf(`const a = 1;\n${comment}\nconst b = 2;\n`)).toEqual([
        expect.stringMatching(
          /^pkg@1\.0\.0's a\.js, line 2, says ".*", which may be code of another project/,
        ),
      ]);
    });

    it.each([
      [
        '// Modified to add conditional `aria-hidden` support:',
        '// https://github.com/someone/thing/blob/9220c8/src/index.ts',
      ],
      [' * Adapted', ' * https://example.com/thing'],
      ['// This was derived', '// github.com/someone/thing'],
    ])('fails the build, when a link is on the next line: %s', (first, link) => {
      expect(problemsOf(`const a = 1;\n${first}\n${link}\nconst b = 2;\n`)).toEqual([
        expect.stringMatching(/^pkg@1\.0\.0's a\.js, line 2, says "/),
      ]);
    });

    it.each([
      '// derived from `syncedValues` so it cannot be forgotten',
      '// Based on the level, and call through to compute the spans for',
      '// Derived from nb-char - \t - #x85 - #xA0',
      '// This schema is based on standard YAML’s Core schema',
      ' * Detects the package manager to use based on the available commands.',
      ' *    may be used to endorse or promote products derived from this software without',
      ' * You may obtain a copy of the License at',
      '// a copy of this software and associated documentation files',
      '// because it is modified by the read(2) system call',
      '// See https://github.com/someone/thing/issues/12 for why',
      "const s = 'Adapted from https://github.com/a/b';",
      '/*! markdown-it 15.0.3 https://github.com/markdown-it/markdown-it @license MIT */',
    ])('is not one that only reads like it: %s', (line) => {
      expect(problemsOf(`${line}\n`)).toEqual([]);
    });

    it('is not one a link on the next line is about, when it is not about taking code', () => {
      expect(
        problemsOf(
          '// Not modified, re-use the cached value\n// https://github.com/a/b/issues/1\n',
        ),
      ).toEqual([]);
    });

    it('is looked at once an entry for the package, at its version, has the file, as the hash of what was read', () => {
      const text = '// Adapted from https://github.com/someone/thing\n';
      const entry: Inlined = { in: 'pkg@1.0.0', files: { 'a.js': sha(text) }, carries: kept };
      expect(problemsOf(text, [entry])).toEqual([]);
    });

    it('is not looked at by an entry for another file', () => {
      const text = '// Adapted from https://github.com/someone/thing\n';
      const entry: Inlined = { in: 'pkg@1.0.0', files: { 'b.js': sha('') }, carries: kept };
      expect(problemsOf(text, [entry])).toEqual([
        expect.stringMatching(/pkg@1\.0\.0 has no b\.js/),
        expect.stringMatching(/pkg@1\.0\.0's a\.js, line 1, says/),
      ]);
    });
  });

  describe('the entries of INLINED', () => {
    const text = 'code of someone else\n';
    const entry: Inlined = { in: 'pkg@1.0.0', files: { 'a.js': sha(text) }, carries: kept };

    it('gives what it carries for a package whose file is the one it was read from', () => {
      const result = foundIn('1.0.0', text, [entry]);
      expect(result.problems).toEqual([]);
      expect(result.kept).toEqual([kept]);
    });

    it('gives none of an entry for code that carries nothing', () => {
      const none: Inlined = { in: 'pkg@1.0.0', files: { 'a.js': sha(text) }, why: 'a line' };
      expect(foundIn('1.0.0', text, [none])).toMatchObject({ problems: [], kept: [] });
    });

    it("fails when a file isn't the one it was read from, though its package's version is, and prints the hash it has now", () => {
      const changed = `${text}more\n`;
      const result = foundIn('1.0.0', changed, [entry]);
      expect(result.problems).toEqual([
        expect.stringMatching(/^pkg@1\.0\.0's a\.js isn't the file .*inlined\.ts was written from/),
      ]);
      expect(result.problems[0]).toContain(`set the entry's hash to ${sha(changed)}.`);
      expect(result.kept).toEqual([]);
    });

    it('fails when a file it pins is not in the package', () => {
      const result = foundIn('1.0.0', text, [{ ...entry, files: { 'gone.js': sha(text) } }]);
      expect(result.problems).toEqual([expect.stringMatching(/^pkg@1\.0\.0 has no gone\.js/)]);
    });

    it('fails, though the file is the same, when the package is at another version, and says to update the entry', () => {
      const result = foundIn('1.1.0', text, [entry]);
      expect(result.problems).toEqual([
        "scripts/notices/inlined.ts has an entry for pkg@1.0.0, which isn't bundled any more: pkg is bundled at 1.1.0 now: read it again there and update the entry, or remove the entry if the package needs none.",
      ]);
      expect(result.kept).toEqual([]);
    });

    it('has an entry for each version of a package that is in the bundle twice, and fails neither for the other', () => {
      const one = install('pkg', '1.0.0', { 'a.js': text });
      const two = install('pkg', '2.0.0', { 'a.js': text });
      const result = code(
        [bundle(one, ['a.js']), bundle(two, ['a.js'])],
        [entry, { ...entry, in: 'pkg@2.0.0' }],
      );
      expect(result.problems).toEqual([]);
      // Both carry the same work, in the notices once.
      expect(result.kept).toEqual([kept]);
    });

    it('fails an entry for a version that left the bundle while another is in it, and says to remove it', () => {
      const two = install('pkg', '2.0.0', { 'a.js': text });
      const result = code([bundle(two, ['a.js'])], [entry, { ...entry, in: 'pkg@2.0.0' }]);
      expect(result.problems).toEqual([
        "scripts/notices/inlined.ts has an entry for pkg@1.0.0, which isn't bundled any more: remove it.",
      ]);
    });

    it('fails an entry for a package that left the bundle, and says to remove it', () => {
      const dir = install('other', '1.0.0');
      expect(code([bundle(dir, [])], [entry]).problems).toEqual([
        "scripts/notices/inlined.ts has an entry for pkg@1.0.0, which isn't bundled any more: remove it.",
      ]);
    });
  });

  describe('a copyright line in a comment', () => {
    it("is carried when its holder isn't in the license file", () => {
      expect(saysOf('// Copyright (c) 2011 Bob Other <bob@example.com>')).toEqual([
        'Copyright (c) 2011 Bob Other <bob@example.com>',
      ]);
      expect(saysOf('/*!\n * Copyright 2022 Bob Other. All rights reserved.\n */')).toEqual([
        'Copyright 2022 Bob Other. All rights reserved.',
      ]);
    });

    it("is not when its holder is, however the line spells the year, or doesn't", () => {
      expect(
        saysOf('// Copyright (c) 2018-2024 Alice Example. All rights reserved.'),
      ).toBeUndefined();
      expect(saysOf('// copyright (c) by Alice Example and others')).toBeUndefined();
      expect(saysOf('// (c) alice  example')).toBeUndefined();
    });

    it('is not when the file is one an entry has read', () => {
      const text = '// Copyright (c) 2011 Bob Other\nvar x;\n';
      const entry: Inlined = { in: 'pkg@1.0.0', files: { 'a.js': sha(text) }, carries: kept };
      expect(saysOf('// Copyright (c) 2011 Bob Other', [entry])).toBeUndefined();
    });

    it('is carried once, however many files have it', () => {
      const dir = install('pkg', '1.0.0', {
        'a.js': '// Copyright (c) Bob Other\n',
        'b.js': '/* Copyright (c) Bob Other */\n',
        'c.js': '// Copyright (c) Carol Another\n',
      });
      expect(code([bundle(dir, ['a.js', 'b.js', 'c.js'])]).packages[0]?.says).toEqual([
        'Copyright (c) Bob Other',
        'Copyright (c) Carol Another',
      ]);
    });

    it('is not looked for in a file that is not JavaScript', () => {
      const dir = install('pkg', '1.0.0', { 'a.css': '/* Copyright (c) Bob Other */\n' });
      expect(code([bundle(dir, ['a.css'])]).packages[0]?.says).toBeUndefined();
    });
  });
});

/** A package at `dir` that says it's under `license`, with no license file. */
function bareUnder(license: string): Bundled {
  const dir = install('bare', '1.0.0');
  rmSync(join(dir, 'LICENSE'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'bare', version: '1.0.0', license }),
  );
  return bundle(dir, []);
}

describe('a package with no license file', () => {
  const entry: Unlicensed = {
    in: 'bare@1.0.0',
    license: 'MIT',
    copyright: ['Copyright (c) Someone'],
  };

  it('has the MIT License written out with the copyright line its entry gives', () => {
    const [pack] = code([bareUnder('MIT')], [], [entry]).packages;
    expect(pack?.text).toMatch(
      /^MIT License\n\nCopyright \(c\) Someone\n\nPermission is hereby granted/,
    );
    expect(pack?.text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('has none when the license it says is not the one its entry writes, or it has no entry, so the check fails it', () => {
    expect(code([bareUnder('ISC')], [], [entry]).packages[0]?.text).toBeUndefined();
    expect(code([bareUnder('MIT')], [], []).packages[0]?.text).toBeUndefined();
  });

  it('has an entry that fails the build, naming the package and saying to update it, when the package is at another version', () => {
    const result = code([bareUnder('MIT')], [], [{ ...entry, in: 'bare@0.9.0' }]);
    expect(result.problems).toEqual([
      "scripts/notices/inlined.ts has an entry for bare@0.9.0, which isn't bundled any more: bare is bundled at 1.0.0 now: read it again there and update the entry, or remove the entry if the package needs none.",
    ]);
    expect(result.packages[0]?.text).toBeUndefined();
  });

  it('keeps the license file it has, when it has one', () => {
    const dir = install('bare', '1.0.0');
    expect(code([bundle(dir, [])], [], [entry]).packages[0]?.text).toBe(
      'bare license, Copyright (c) bare authors',
    );
  });
});

describe('UNLICENSED', () => {
  it('is of packages installed at those versions that say the license it writes, and have no license file, so it is not kept after they have one', () => {
    const problems = UNLICENSED.flatMap((entry) => {
      const dir = installedAt(entry.in);
      if (dir === undefined) return [`${entry.in} isn't installed at that version.`];
      const files = readdirSync(dir).filter((name) => /^(?:licen[cs]e|copying)/i.test(name));
      const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const license =
        typeof manifest === 'object' && manifest !== null && 'license' in manifest
          ? manifest.license
          : undefined;
      return [
        ...(files.length > 0 ? [`${entry.in} has ${files.join(', ')} now.`] : []),
        ...(license === entry.license ? [] : [`${entry.in} says it's under ${String(license)}.`]),
      ];
    });
    expect(problems).toEqual([]);
  });
});

describe('INLINED', () => {
  it('is of packages that are installed at the versions it was read at, and files that are the ones it was read from', () => {
    const problems = INLINED.flatMap((entry) => {
      const dir = installedAt(entry.in);
      if (dir === undefined) return [`${entry.in} isn't installed at that version: read it again.`];
      return Object.entries(entry.files)
        .filter(([file, hash]) => sha(readFileSync(join(dir, file), 'utf8')) !== hash)
        .map(([file]) => `${entry.in}'s ${file} is not the file this was read from.`);
    });
    expect(problems).toEqual([]);
  });

  it('finds nothing wrong with what it has of the packages it is of, which it carries a notice for', () => {
    const packages = INLINED.flatMap((entry) => {
      const dir = installedAt(entry.in);
      return dir === undefined ? [] : [bundle(dir, Object.keys(entry.files))];
    });
    expect(packages.length).toBeGreaterThan(5);
    const found = code(packages, INLINED, []);
    expect(found.problems).toEqual([]);
    const carried = new Set(
      INLINED.flatMap((entry) => (entry.carries ? [entry.carries.repo] : [])),
    );
    expect(new Set(found.kept.map((each) => each.repo))).toEqual(carried);
  });

  it('names a repository, license and copyright for each notice it carries, and a reason for each it does not', () => {
    expect(
      INLINED.filter((entry) => (entry.carries === undefined) === (entry.why === undefined)),
    ).toEqual([]);
    expect(
      INLINED.filter(
        (entry) =>
          entry.carries !== undefined &&
          (!/^[^/]+\/[^/]+$/.test(entry.carries.repo) || entry.carries.copyright.length === 0),
      ),
    ).toEqual([]);
    expect(INLINED.filter((entry) => entry.why !== undefined && entry.why.length < 10)).toEqual([]);
  });

  it('carries the work of other projects that undici and yauzl hold, whose licenses their own do not', () => {
    const carried = INLINED.flatMap((entry) => (entry.carries ? [entry.carries.repo] : []));
    expect(carried).toEqual(
      expect.arrayContaining([
        'nodejs/llhttp',
        'jimmywarting/FormData',
        'websockets/ws',
        'andrewrk/node-fd-slicer',
        'brianloveswords/buffer-crc32',
      ]),
    );
  });
});
