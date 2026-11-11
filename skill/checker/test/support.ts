/** Running the built checker in tests, on folders and repositories the tests make. */

import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'vitest';

import { git, testGitEnvironment } from '@lo/testing/git';

/** The built checker, as `npx` runs it. */
export const CHECKER = fileURLToPath(new URL('../dist/checker.js', import.meta.url));

/** What a run of the checker did. */
export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the built checker with `args` in `cwd`, with Node alone, and git without the user's or the
 * system's config.
 */
export function runChecker(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = testGitEnvironment(),
): Ran {
  const ran = spawnSync(process.execPath, [CHECKER, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ran.error) throw ran.error;
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** What `--json` prints. */
export interface Printed {
  outcome: string;
  findings: { code: string; severity: string; file: string; line?: number; message: string }[];
  incomplete: string[];
  commit?: string;
  parent?: string | null;
  ref?: string;
  unshown?: string[];
}

/** Runs the checker with `--json`, and what it printed. */
export function runJson(
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Ran & Printed {
  const ran = runChecker([...args, '--json'], cwd, env);
  let printed: Printed;
  try {
    printed = JSON.parse(ran.stdout);
  } catch {
    throw new Error(`The checker printed no JSON: ${ran.stdout}${ran.stderr}`);
  }
  return { ...ran, ...printed };
}

/** A new empty folder, named for what it holds, and a way to remove it. */
export function scratch(name: string): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `lo-checker-${name}-`));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A repository in `dir` holding `files`, each a path and its text, committed: the commit's id.
 */
export function repositoryOf(dir: string, files: Readonly<Record<string, string>>): string {
  git(dir, 'init', '-q', '--object-format=sha1', '.');
  for (const [path, text] of Object.entries(files)) {
    const at = join(dir, path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Code');
  return git(dir, 'rev-parse', 'HEAD');
}

/** The header of an overview of pull request 4797 at `commit`. */
export function header(commit: string, pr = 4797): string {
  return `---\nformat: 1\npr: ${pr}\ncommit: ${commit}\n---\n`;
}

/** An overview at `commit`, with a tl;dr and then `body`. */
export function overview(commit: string, body = '', pr = 4797): string {
  return `${header(commit, pr)}\n## tl;dr\n\nIt changes things.\n\n${body}`;
}

/** The skill's source, `skill/` in the repository. */
export const SKILL = fileURLToPath(new URL('../../', import.meta.url));

/** The files the skill is made of, by their paths in its folder. */
export function skillFiles(): string[] {
  const references = readdirSync(join(SKILL, 'references')).map((name) => `references/${name}`);
  return ['LICENSE', 'SKILL.md', ...references].toSorted();
}

/** Every file, folder and link in `dir`, by its path there, each folder's ending in `/`. */
export function listing(dir: string, inner = ''): string[] {
  return readdirSync(join(dir, inner))
    .flatMap((name) => {
      const path = inner === '' ? name : `${inner}/${name}`;
      const stats = lstatSync(join(dir, path));
      if (stats.isSymbolicLink()) return [`${path} -> ${readlinkSync(join(dir, path))}`];
      return stats.isDirectory() ? [`${path}/`, ...listing(dir, path)] : [path];
    })
    .toSorted();
}

/** The skill's own files in the folder `dir`, each by its path there, with its text. */
function skillIn(dir: string): Record<string, string> {
  return Object.fromEntries(
    skillFiles().map((path) => [path, readFileSync(join(dir, path), 'utf8')]),
  );
}

/** Checks the skill's folder `folder` holds the skill's own files exactly as the repository has them. */
export function expectSkill(folder: string): void {
  expect(skillIn(folder)).toEqual(skillIn(SKILL));
}
