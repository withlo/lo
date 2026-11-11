#!/usr/bin/env node
// Fails if the types the package hands out name CodeMirror. The boundary check keeps CodeMirror's
// imports inside src/code/, but its types can still leak out in ways no import shows: an
// `EditorView` a function returns, a binding imported from CodeMirror and exported again, or a type
// added to the global scope. So this emits the package's declarations with tsc into a temporary
// folder, beside the declaration files the package wrote itself, has tsc list every file it reads
// from there on, and fails if one of them is in one of CodeMirror's packages.
//
// tsc starts from the declarations of each module the package's `exports` hand out, and of each file
// that adds to the global scope or to another module, since those reach whoever loads the file,
// whether they import from it or not. It reads whole files, so a file it reaches exports nothing
// typed with CodeMirror, even what no export hands on.
//
//   node scripts/check-surface.ts [folder]
//
// `folder` is ui's own by default. Run it through pnpm, which puts the workspace's tsc on the PATH.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSync } from 'oxc-parser';

/** The tsconfig that builds the package's own files, with the code views among them. */
const tsconfig = 'tsconfig.lib.json';

const declarations = /\.d\.[cm]?ts$/;

/**
 * Whether a package is part of CodeMirror, as the boundary check counts it: one of its own, the
 * `codemirror` bundle of them, Lezer's parsers, or the Vim mode.
 */
function isCodeMirror(name: string): boolean {
  return /^(?:@codemirror\/|@lezer\/|codemirror$|@replit\/codemirror-vim(?:$|-))/.test(name);
}

/** The package a module specifier names, without the path after it. */
function packageName(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

/** The package a file is in, when it's in a `node_modules` folder. */
function packageOf(file: string): string | undefined {
  const parts = file.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  return at === -1 ? undefined : packageName(parts.slice(at + 1).join('/'));
}

/** A reason the check can't be made, which fails it. */
class Failure extends Error {}

/** Runs the workspace's tsc in `folder`, and gives back what it printed, or throws if it failed. */
function tsc(folder: string, args: readonly string[], what: string): string {
  const run = spawnSync('tsc', args, { cwd: folder, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.error) {
    throw new Failure(`Couldn't run tsc (${run.error.message}). Run this through pnpm.`);
  }
  if (run.status !== 0) throw new Failure(`tsc couldn't ${what}:\n${run.stdout}${run.stderr}`);
  return run.stdout;
}

/** The declaration files in `folder`, leaving out dependencies and hidden folders. */
function* declarationFiles(folder: string): Generator<string> {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      yield* declarationFiles(path);
    } else if (entry.isFile() && declarations.test(entry.name)) {
      yield path;
    }
  }
}

/** Every string in an `exports` field, through its conditions. */
function targetsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(targetsOf);
}

/**
 * The declarations, under `out`, of each module the package's `exports` hand out. A stylesheet has
 * none. An export the check can't follow to its declarations fails it.
 */
function exported(folder: string, out: string): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const exports =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'exports')
      : undefined;
  const files: string[] = [];
  for (const target of targetsOf(exports)) {
    if (target.endsWith('.css')) continue;
    if (target.includes('*')) {
      throw new Failure(
        `package.json exports a pattern, ${target}, which this check can't follow. List each module.`,
      );
    }
    const typed = /\.([cm]?)tsx?$/.exec(target);
    const declared = declarations.test(target)
      ? target
      : typed && `${target.slice(0, typed.index)}.d.${typed[1] ?? ''}ts`;
    const file = declared ? resolve(out, declared) : undefined;
    if (file === undefined || !existsSync(file)) {
      throw new Failure(
        `package.json exports ${target}, whose declarations this check can't find.`,
      );
    }
    files.push(file);
  }
  if (files.length === 0) throw new Failure(`package.json exports no module to check.`);
  return files;
}

/**
 * Whether a declaration file adds to types outside it: it's a script, whose declarations are all
 * global, or it has a `declare global`, or a `declare module` for another module. Adding to
 * CodeMirror's own modules doesn't count, since only the code views can name them.
 */
function changesOthers(file: string): boolean {
  const { program, module } = parseSync(file, readFileSync(file, 'utf8'));
  if (!module.hasModuleSyntax) return program.body.length > 0;
  return program.body.some(
    (statement) =>
      statement.type === 'TSModuleDeclaration' &&
      (statement.kind === 'global' ||
        (statement.id.type === 'Literal' && !isCodeMirror(packageName(statement.id.value)))),
  );
}

/**
 * Each way from `roots` to a file in one of CodeMirror's packages, as a list of files from a root
 * on. Only the first CodeMirror file on a way counts, not what it reads in turn.
 */
function leaks(folder: string, temp: string, roots: readonly string[]): string[][] {
  const config = join(temp, 'tsconfig.json');
  // The same settings the declarations were built with, reading only the roots and what they reach,
  // with every type package left out unless something names it.
  writeFileSync(
    config,
    JSON.stringify({
      extends: resolve(folder, tsconfig),
      compilerOptions: {
        noEmit: true,
        noCheck: true,
        composite: false,
        incremental: false,
        declaration: false,
        emitDeclarationOnly: false,
        types: [],
      },
      files: roots,
      include: [],
    }),
  );
  // Each file tsc read, unindented, then why: indented lines that end with the file that named it.
  const explained = tsc(folder, ['-p', config, '--explainFiles'], 'read the declarations');
  const files = new Set<string>();
  const named = new Map<string, string[]>();
  let last: string | undefined;
  for (const line of explained.split('\n')) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      last = resolve(folder, line.trim());
      files.add(last);
      continue;
    }
    const by = / from file '(.+?)'(?: with packageId '.*')?\s*$/.exec(line)?.[1];
    if (by === undefined || last === undefined) continue;
    const from = resolve(folder, by);
    named.set(from, [...(named.get(from) ?? []), last]);
  }
  // tsc lists every file it reads, so a root missing means its output can't be read.
  const missing = roots.find((root) => !files.has(root));
  if (missing !== undefined) {
    throw new Failure(
      `tsc's list of the files it read leaves out ${missing}, so it can't be checked:\n${explained}`,
    );
  }

  // Breadth first from the roots, so each way found is a shortest one.
  const previous = new Map<string, string | undefined>(roots.map((root) => [root, undefined]));
  const queue = [...previous.keys()];
  const found: string[][] = [];
  for (const file of queue) {
    if (isCodeMirror(packageOf(file) ?? '')) {
      const way = [file];
      for (let at = previous.get(file); at !== undefined; at = previous.get(at)) way.unshift(at);
      found.push(way);
      continue;
    }
    for (const next of named.get(file) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, file);
      queue.push(next);
    }
  }
  if (found.length > 0) return found;
  // Every file tsc read came from the roots, so one of CodeMirror's fails the check even when tsc's
  // explanations can't be followed back to it.
  return [...files].filter((file) => isCodeMirror(packageOf(file) ?? '')).map((file) => [file]);
}

/** How a file on a way is shown: its package, or its source file, or its path from `folder`. */
function shown(file: string, folder: string, out: string): string {
  const name = packageOf(file);
  if (name !== undefined) return name;
  const emitted = relative(out, file);
  if (emitted.startsWith('..')) return relative(folder, file);
  const sources = ['.ts', '.tsx'].map((extension) => emitted.replace(/\.d\.ts$/, extension));
  return [...sources, emitted].find((source) => existsSync(join(folder, source))) ?? emitted;
}

// Its real path, as tsc gives the paths of the files it reads.
const folder = realpathSync(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
// In the package's folder, so that packages resolve from the declarations as from its files.
mkdirSync(join(folder, '.tsbuild'), { recursive: true });
const temp = mkdtempSync(join(folder, '.tsbuild', 'surface-'));
try {
  const out = join(temp, 'out');
  // Into the temporary folder: its own build info, or tsc would skip files it thinks are built.
  const emit = ['-p', tsconfig, '--declaration', '--emitDeclarationOnly', '--rootDir', folder];
  const into = ['--outDir', out, '--declarationDir', out, '--tsBuildInfoFile', join(temp, 'info')];
  tsc(folder, [...emit, ...into], 'emit the declarations');
  // tsc emits no copy of the declaration files the package wrote itself, so they go beside its own.
  for (const file of declarationFiles(folder)) {
    const copy = join(out, relative(folder, file));
    if (existsSync(copy)) continue;
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(file, copy);
  }
  const entries = exported(folder, out);
  const global = [...declarationFiles(out)].filter(
    (file) => !entries.includes(file) && changesOthers(file),
  );
  const found = leaks(folder, temp, [...entries, ...global]);
  if (found.length > 0) {
    console.error(`The package's types name CodeMirror, which only src/code/ uses:`);
    for (const way of found) {
      const files = way.map((file, at) => {
        const name = shown(file, folder, out);
        return at === 0 && global.includes(file) ? `${name} (adds to types outside it)` : name;
      });
      console.error(`  ${files.join(' → ')}`);
    }
    console.error(
      `\nGive and take Lo's own types (src/code/api.ts) instead, and keep CodeMirror's inside src/code/.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
