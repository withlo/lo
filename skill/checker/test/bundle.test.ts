/**
 * The checker as it's published: one file that runs with Node alone, holding only code under
 * licenses its MIT license can carry, each given in `THIRD_PARTY_NOTICES`, and the skill it
 * installs; and the package `pnpm pack` makes of it, run from an empty folder.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ALLOWED, bundledPackages, NOTICES, notices, packageAt } from '../build/notices.ts';
import {
  CHECKER,
  expectSkill,
  listing,
  overview,
  repositoryOf,
  scratch,
  skillFiles,
} from './support.ts';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const bundle = readFileSync(CHECKER, 'utf8');
const written = readFileSync(join(dirname(CHECKER), NOTICES), 'utf8');

/** Each module the bundle holds from an installed package, as the bundle names it. */
const installed = [...bundle.matchAll(/^\/\/ (\S*\/node_modules\/\S+)$/gm)].map(
  (match) => match[1]!,
);

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('bundle');
});

afterAll(() => root.remove());

/** The modules `code` imports by name. */
function importsOf(code: string): string[] {
  return [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]!);
}

describe('the bundle', () => {
  test('imports nothing but Node’s own modules', () => {
    const imports = importsOf(bundle);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((name) => !name.startsWith('node:'))).toEqual([]);
    expect(bundle).not.toMatch(/\bcreateRequire\b|\bimport\(/);
  });

  test('inlines a package even where Node could load it from beside the checker', async () => {
    const built = await build({
      configFile: join(PACKAGE, 'vite.config.ts'),
      root: PACKAGE,
      logLevel: 'silent',
      build: {
        ssr: join(PACKAGE, 'test/inlined.ts'),
        outDir: join(root.dir, 'inlined'),
        emptyOutDir: false,
        write: false,
      },
    });
    const outputs = (Array.isArray(built) ? built : [built]).flatMap((each) =>
      'output' in each ? each.output : [],
    );
    const code = outputs.map((each) => (each.type === 'chunk' ? each.code : '')).join('\n');
    expect(importsOf(code)).toEqual([]);
    expect(code).toMatch(/^\/\/ \S*\/node_modules\/vite\/dist\/node\/module-runner\.js$/m);
  });

  test('gives every package it holds code from in THIRD_PARTY_NOTICES, under a license it may carry', () => {
    const packages = bundledPackages(installed.map((module) => join(PACKAGE, module)));
    expect(packages.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['markdown-it', 'parse5']),
    );
    expect(written).toBe(notices(packages));
    for (const { name, version, license, text } of packages) {
      expect(ALLOWED.has(license), `${name}'s license`).toBe(true);
      expect(written).toContain(`${name} ${version} (${license})\n`);
      expect(text.length, `${name}'s license text`).toBeGreaterThan(100);
    }
  });
});

/** A package installed in a folder of its own, with `manifest` and `files`. */
function installedPackage(name: string, manifest: object, files: Record<string, string>): string {
  const folder = join(root.dir, 'node_modules', name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify(manifest));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(folder, file), text);
  return folder;
}

describe('the notices', () => {
  test('refuse a package under a license the checker can’t carry, or without its text', () => {
    const gpl = installedPackage(
      'gpl',
      { name: 'gpl', version: '1.0.0', license: 'GPL-3.0' },
      { LICENSE: 'GPL' },
    );
    expect(() => packageAt(gpl)).toThrow('gpl is licensed "GPL-3.0"');
    const none = installedPackage('none', { name: 'none', version: '1.0.0' }, { LICENSE: 'Mine' });
    expect(() => packageAt(none)).toThrow('none is licensed undefined');
    const bare = installedPackage('bare', { name: 'bare', version: '1.0.0', license: 'MIT' }, {});
    expect(() => packageAt(bare)).toThrow('bare ships no license text');
  });

  test('find each package once, scoped or not, and leave out the workspace’s own code', () => {
    installedPackage(
      '@scope/kit',
      { name: '@scope/kit', version: '2.0.0', license: 'ISC' },
      { 'LICENSE.md': 'ISC text' },
    );
    installedPackage(
      'plain',
      { name: 'plain', version: '3.0.0', license: 'MIT' },
      { 'LICENSE-MIT.txt': 'MIT text' },
    );
    const modules = [
      join(root.dir, 'node_modules/plain/lib/a.js'),
      join(root.dir, 'node_modules/@scope/kit/index.js'),
      join(root.dir, 'node_modules/plain/lib/b.js'),
      join(root.dir, 'src/own.ts'),
      '\0rolldown/runtime.js',
    ];
    expect(bundledPackages(modules).map(({ name, text }) => `${name}: ${text}`)).toEqual([
      '@scope/kit: ISC text',
      'plain: MIT text',
    ]);
  });
});

test('the packed package runs with Node alone, from an empty folder', () => {
  const packed = join(root.dir, 'packed');
  const empty = join(root.dir, 'empty');
  mkdirSync(packed);
  mkdirSync(empty);
  execFileSync('pnpm', ['pack', '--pack-destination', packed], { cwd: PACKAGE, stdio: 'pipe' });
  const [tarball] = readdirSync(packed);
  execFileSync('tar', ['-xzf', join(packed, tarball!), '-C', empty]);
  const files = execFileSync('find', ['.', '-type', 'f'], { cwd: empty, encoding: 'utf8' });
  expect(files.trim().split('\n').toSorted()).toEqual([
    './package/LICENSE',
    './package/dist/THIRD_PARTY_NOTICES',
    './package/dist/checker.js',
    './package/package.json',
  ]);
  const manifest = JSON.parse(readFileSync(join(empty, 'package/package.json'), 'utf8'));
  expect(manifest.name).toBe('@withlo/overview');
  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.bin).toEqual({ 'lo-overview': './dist/checker.js' });

  const run = (args: string[], cwd: string) =>
    execFileSync(process.execPath, [join(empty, 'package/dist/checker.js'), ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: root.dir,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    });
  expect(run(['--help'], empty)).toContain('Usage:');
  const repo = join(root.dir, 'repo');
  mkdirSync(repo);
  const commit = repositoryOf(repo, { 'src/a.ts': 'one\n' });
  const dir = join(root.dir, 'overview');
  mkdirSync(dir);
  writeFileSync(join(dir, 'artifact.md'), overview(commit, ':::code src/a.ts#L1\n:::\n'));
  expect(run(['check', dir], repo)).toBe('No errors or warnings.\n');

  // It carries the skill, and installs it.
  const skills = join(root.dir, 'skills');
  expect(run(['install', '--dir', skills], empty)).toBe(
    `Installed the lo-overview skill in ${join(skills, 'lo-overview')}.\n`,
  );
  expect(listing(join(skills, 'lo-overview'))).toEqual([...skillFiles(), 'references/'].toSorted());
  expectSkill(join(skills, 'lo-overview'));
});
