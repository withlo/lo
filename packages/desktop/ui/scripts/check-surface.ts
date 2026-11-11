#!/usr/bin/env node
// Fails if the code views' types, `@lo/ui/code`, name CodeMirror. The boundary check keeps
// CodeMirror's imports inside src/code/, but its types can still leak out through that folder's
// index in ways no import shows: an `EditorView` a function returns, or a binding imported from
// CodeMirror and exported again. So this emits the package's declarations with tsc into a
// temporary folder, has tsc list every file it reads from src/code/index.d.ts on, and fails if one
// of them is in one of CodeMirror's packages.
//
//   node scripts/check-surface.ts [folder]
//
// `folder` is ui's own by default. Run it through pnpm, which puts the workspace's tsc on the PATH.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The tsconfig that builds the package's own files, with the code views among them. */
const tsconfig = 'tsconfig.lib.json';

/** The code views' index, which `@lo/ui/code` exports, without its extension. */
const entry = 'src/code/index';

/**
 * Whether a package is part of CodeMirror, as the boundary check counts it: one of its own, the
 * `codemirror` bundle of them, Lezer's parsers, or the Vim mode.
 */
function isCodeMirror(name: string): boolean {
  return /^(?:@codemirror\/|@lezer\/|codemirror$|@replit\/codemirror-vim(?:$|-))/.test(name);
}

/** The package a file is in, when it's in a `node_modules` folder. */
function packageOf(file: string): string | undefined {
  const parts = file.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  if (at === -1) return undefined;
  const [scope = '', name = ''] = parts.slice(at + 1);
  return scope.startsWith('@') ? `${scope}/${name}` : scope;
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

/**
 * Each way from the code views' index to a file in one of CodeMirror's packages, as a list of
 * files from the index on. Only the first CodeMirror file on a way counts, not what it reads in
 * turn.
 */
function leaks(folder: string, temp: string): string[][] {
  const config = join(temp, 'tsconfig.json');
  const start = resolve(temp, 'out', `${entry}.d.ts`);
  // The same settings the declarations were built with, reading only the index and what it reaches,
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
      files: [start],
      include: [],
    }),
  );
  // Each file tsc read, unindented, then why: indented lines that end with the file that named it.
  const explained = tsc(folder, ['-p', config, '--explainFiles'], 'read the declarations');
  const files: string[] = [];
  const named = new Map<string, string[]>();
  for (const line of explained.split('\n')) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      files.push(resolve(folder, line.trim()));
      continue;
    }
    const by = / from file '(.+?)'(?: with packageId '.*')?\s*$/.exec(line)?.[1];
    const file = files.at(-1);
    if (by === undefined || file === undefined) continue;
    const from = resolve(folder, by);
    named.set(from, [...(named.get(from) ?? []), file]);
  }

  // Breadth first from the index, so each way found is a shortest one.
  const previous = new Map<string, string | undefined>([[start, undefined]]);
  const queue = [start];
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
  // Every file tsc read came from the index, so one of CodeMirror's fails the check even when
  // tsc's explanations can't be followed back to it.
  return files.filter((file) => isCodeMirror(packageOf(file) ?? '')).map((file) => [file]);
}

/** How a file on a way is shown: its package, or its source file, or its path from `folder`. */
function shown(file: string, folder: string, out: string): string {
  const name = packageOf(file);
  if (name !== undefined) return name;
  const emitted = relative(out, file);
  if (emitted.startsWith('..')) return relative(folder, file);
  const sources = ['.ts', '.tsx'].map((extension) => emitted.replace(/\.d\.ts$/, extension));
  return sources.find((source) => existsSync(join(folder, source))) ?? emitted;
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
  const found = leaks(folder, temp);
  if (found.length > 0) {
    console.error(`${entry}.ts's types name CodeMirror, which only src/code/ uses:`);
    for (const way of found) {
      console.error(`  ${way.map((file) => shown(file, folder, out)).join(' → ')}`);
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
