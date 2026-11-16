// The code features' fixture scripts, `code.sh` and `code-hostile.sh`, built where no network is
// read (`--local`), and what they make, read back out of git: every sample project is in the pull
// request, its definitions are in files it doesn't change, the moved code is in both of its files,
// and what the hostile pull request plants is only ever a marker, or a host that can't resolve.
//
// Nothing here runs what the scripts plant. It's never opened as a repository, or as files: each
// file's text is read from the bare repository, with git run in that, never inside a folder of it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';

import { isObject, parseJson, type Json } from '../src/cassette.ts';
import { git, gitBytes, testGitEnvironment } from '../src/git/git.ts';

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url));
const samples = join(fixtures, 'code');

/** Runs `script` of `testing/fixtures` with `--local`, and returns the bare repository it makes. */
function build(script: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'lo-code-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  execFileSync('bash', [join(fixtures, script), '--local', folder], {
    env: testGitEnvironment(),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return join(folder, 'rozed-dev', 'e2e.git');
}

/** Every file under `dir`, as a path from `root`. */
function filesUnder(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path, root) : [relative(root, path)];
  });
}

/** Each file of `ref` that git lists, by path, with its mode and blob. */
function tree(bare: string, ref: string): Map<string, { mode: string; blob: string }> {
  const entries = new Map<string, { mode: string; blob: string }>();
  for (const line of git(bare, 'ls-tree', '-r', ref).split('\n')) {
    const [info = '', path = ''] = line.split('\t');
    const [mode = '', , blob = ''] = info.split(' ');
    entries.set(path, { mode, blob });
  }
  return entries;
}

/** The text of each of `paths` at `ref`, by path, from one run of git. */
function texts(bare: string, ref: string, paths: readonly string[]): Map<string, string> {
  const out = gitBytes(
    bare,
    ['cat-file', '--batch'],
    paths.map((path) => `${ref}:${path}\n`).join(''),
  );
  const found = new Map<string, string>();
  let at = 0;
  for (const path of paths) {
    const end = out.indexOf('\n', at);
    const size = Number(out.subarray(at, end).toString('utf8').split(' ')[2]);
    found.set(path, out.subarray(end + 1, end + 1 + size).toString('utf8'));
    at = end + 1 + size + 1;
  }
  return found;
}

/** The pull request number a script says GitHub gave `name`. */
function pullNumber(script: string, name: string): string {
  const found = new RegExp(`^${name}=(\\d+)$`, 'm').exec(
    readFileSync(join(fixtures, script), 'utf8'),
  );
  if (!found) throw new Error(`${script} has no ${name}`);
  return found[1] ?? '';
}

/** The text of `file` in the sample projects. */
function sample(file: string): string {
  return readFileSync(join(samples, file), 'utf8');
}

interface Place {
  file: string;
  line: number;
  character: number;
}

/** A place of `cases.json`. */
function place(member: Json | undefined): Place {
  if (!isObject(member)) throw new Error('a place is an object');
  const { file, line, character } = member;
  if (typeof file !== 'string' || typeof line !== 'number' || typeof character !== 'number') {
    throw new Error('a place has a file, a line and a character');
  }
  return { file, line, character };
}

/** The member `name` of a member of `cases.json`. */
function child(member: Json | undefined, name: string): Json | undefined {
  return isObject(member) ? member[name] : undefined;
}

/** The string `name` of a member of `cases.json`. */
function field(member: Json | undefined, name: string): string {
  const value = child(member, name);
  if (typeof value !== 'string') throw new Error(`${name} is a string`);
  return value;
}

/** `cases.json`'s list `name`, each member read with `read`. */
function listed<T>(name: string, read: (member: Json) => T): T[] {
  const list = child(parseJson(readFileSync(join(samples, 'cases.json'), 'utf8')), name);
  if (!Array.isArray(list)) throw new Error(`${name} is a list`);
  return list.map((member) => read(member));
}

const cases = listed('cases', (member) => ({
  language: field(member, 'language'),
  symbol: field(member, 'symbol'),
  at: place(child(member, 'at')),
  definition: place(child(member, 'definition')),
}));
const moves = listed('moves', (member) => ({
  symbol: field(member, 'symbol'),
  from: field(member, 'from'),
  to: field(member, 'to'),
}));

test('cases.json says where each sample project is asked, and where it answers', () => {
  const projects = readdirSync(samples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(cases.map(({ language }) => language).toSorted()).toEqual(projects.toSorted());
  const wrong: string[] = [];
  for (const { language, symbol, at, definition } of cases) {
    for (const where of [at, definition]) {
      const line = sample(where.file).split('\n')[where.line] ?? '';
      if (
        !where.file.startsWith(`${language}/`) ||
        !line.slice(where.character).startsWith(symbol)
      ) {
        wrong.push(`${where.file}:${where.line}:${where.character} isn't ${symbol}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

test(
  'code.sh makes a pull request of every sample project, with definitions in files it leaves alone',
  { timeout: 60_000 },
  () => {
    const bare = build('code.sh');
    const base = tree(bare, 'code/base');
    const head = tree(bare, 'code/feature');
    const feature = git(bare, 'rev-parse', 'code/feature');

    // The head is the sample projects, one commit on the base, and the fork's is the same commit.
    const projectFiles = filesUnder(samples).filter((file) => file.includes('/'));
    expect([...head.keys()].toSorted()).toEqual(['README.md', ...projectFiles].toSorted());
    expect(git(bare, 'rev-parse', 'code/feature^')).toBe(git(bare, 'rev-parse', 'code/base'));
    expect(git(bare, 'rev-parse', 'code/fork')).toBe(feature);
    for (const name of ['CODE_PULL', 'CODE_FORK_PULL']) {
      expect(git(bare, 'rev-parse', `refs/pull/${pullNumber('code.sh', name)}/head`)).toBe(feature);
    }

    // A call in a file the pull request changes or adds has its definition in one it doesn't.
    const wrong: string[] = [];
    for (const { language, at, definition } of cases) {
      const before = base.get(definition.file)?.blob;
      if (before === undefined || before !== head.get(definition.file)?.blob) {
        wrong.push(`${language}'s definition changes`);
      }
      if (base.get(at.file)?.blob === head.get(at.file)?.blob) {
        wrong.push(`${language}'s call doesn't change`);
      }
    }
    expect(wrong).toEqual([]);

    // Moved code is in the old file at the base, and in a new file at the head, with its lines.
    for (const { symbol, from, to } of moves) {
      expect(base.has(to)).toBe(false);
      const was = git(bare, 'show', `code/base:${from}`).split('\n');
      const now = git(bare, 'show', `code/feature:${to}`).split('\n');
      const kept = now.filter(
        (line) => /[A-Za-z0-9]/.test(line) && was.some((old) => old.trim() === line.trim()),
      );
      expect(kept.length).toBeGreaterThanOrEqual(8);
      const left = git(bare, 'show', `code/feature:${from}`);
      expect(left.includes(`function ${symbol}`) || left.includes(`def ${symbol}`)).toBe(false);
    }
  },
);

/**
 * What every program a plant is says: it writes the empty marker beside itself, and fails. A script
 * a shell sources doesn't fail, and finds itself by `BASH_SOURCE`, since its `$0` is the shell's.
 */
const SHELL_PLANT =
  /^#!\/bin\/sh\n# Fixture: [^\n]+\. Writes the empty file (lo-hostile-[a-z-]+) beside itself, and nothing else\.\n: >"\$\(dirname "\$0"\)\/\1"\nexit 1\n$/;
const BASH_PLANT =
  /^#!\/usr\/bin\/env bash\n# Fixture: [^\n]+\. Writes the empty file (lo-hostile-[a-z-]+) beside itself, and nothing else\.\n: >"\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\1"\n$/;
const NODE_PLANT =
  /^\/\/ Fixture: [^\n]+\. Writes the empty file (lo-hostile-[a-z-]+) beside itself, and nothing else\.\nrequire\('node:fs'\)\.writeFileSync\(require\('node:path'\)\.join\(__dirname, '\1'\), ''\);\nthrow new Error\('\1'\);\n$/;
const PLUGIN =
  /^\/\/ Fixture: a tsserver plugin\. Writes the empty file (lo-hostile-[a-z-]+) beside itself, and nothing else\.\nmodule\.exports = function init\(\) \{\n {2}require\('node:fs'\)\.writeFileSync\(require\('node:path'\)\.join\(__dirname, '\1'\), ''\);\n {2}return \{ create: \(info\) => info\.languageService \};\n\};\n$/;

/** What no other planted file says: nothing that deletes, sends, reads or leaves its folder. */
const FORBIDDEN =
  /\b(curl|wget|nc|ssh|scp|rm|mv|cp|kill|sudo|eval|exec|dd|tar|base64|osascript|launchctl|crontab)\b|>>|\$HOME|~\/|\/etc\b|\/tmp\b|\/Users\b|\/var\b|\.\.\/|\bhttp:\/\/(?!maven\.apache\.org)/;

/** What `terraform` hashes a provider's folder to, in a lock file, which isn't text to check. */
const DIRHASH = /\bh1:[A-Za-z0-9+/=]+/g;

/** The hosts a planted file's text names. */
function hostsIn(contents: string): string[] {
  return [...contents.matchAll(/https?\\?:\/\/([^/\s"'<]+)/g)].map(([, host = '']) => host);
}

test(
  'code-hostile.sh plants only markers, and hosts that can never resolve',
  { timeout: 60_000 },
  () => {
    const script = readFileSync(join(fixtures, 'code-hostile.sh'), 'utf8');
    const bare = build('code-hostile.sh');
    const pull = pullNumber('code-hostile.sh', 'CODE_HOSTILE_PULL');
    expect(git(bare, 'merge-base', '--is-ancestor', 'code/feature', 'code/hostile')).toBe('');
    expect(git(bare, 'rev-parse', `refs/pull/${pull}/head`)).toBe(
      git(bare, 'rev-parse', 'code/hostile'),
    );

    // The files its commit adds or changes. A submodule isn't a file: it's a commit nothing has.
    const before = tree(bare, 'code/feature');
    const changed = [...tree(bare, 'code/hostile')].filter(
      ([path, { blob }]) => before.get(path)?.blob !== blob,
    );
    expect(changed.filter(([, { mode }]) => mode === '160000').map(([path]) => path)).toEqual([
      'hostile/submodule',
    ]);
    const planted = changed.filter(([, { mode }]) => mode !== '160000');
    expect(planted.length).toBeGreaterThan(60);
    const contents = texts(
      bare,
      'code/hostile',
      planted.map(([path]) => path),
    );

    const markers = new Set<string>();
    const wrong: string[] = [];
    for (const [path, { mode }] of planted) {
      const text = contents.get(path) ?? '';
      const shell = SHELL_PLANT.exec(text) ?? BASH_PLANT.exec(text);
      const program = shell ?? NODE_PLANT.exec(text) ?? PLUGIN.exec(text);
      if (program) markers.add(program[1] ?? '');
      // No marker is committed, nor a folder named like one.
      if (path.split('/').some((part) => part.startsWith('lo-hostile-'))) {
        wrong.push(`${path} is named like a marker`);
      }
      // A script is executable, and only a script is.
      if ((mode === '100755') !== (shell !== null)) wrong.push(`${path} is executable, or isn't`);
      // A file that's a program is one of the four forms, and the rest holds nothing of the kind.
      if (!program && /\.(sh|js)$/.test(path)) wrong.push(`${path} is a program of another kind`);
      if (!program && FORBIDDEN.test(text.replace(DIRHASH, ''))) {
        wrong.push(`${path} says something forbidden`);
      }
      // A host is one that can't resolve.
      for (const host of hostsIn(text)) {
        if (host !== 'maven.apache.org' && !host.endsWith('.lo-hostile.invalid')) {
          wrong.push(`${path} names ${host}`);
        }
      }
    }
    expect(wrong).toEqual([]);

    // The script says each marker, so whoever checks knows what to look for.
    const said = new Set(script.match(/lo-hostile-[a-z]+(?:-[a-z]+)*/g));
    expect([...markers].toSorted()).toEqual([...said].toSorted());
    expect(markers.size).toBe(20);
  },
);

test("Lo's own repository holds nothing a tool would pick up from what the hostile pull request plants", () => {
  // The sample projects are the pull request's head, so they have none of what a language server
  // or a version manager would pick: no wrappers, node_modules, version files, tool settings or
  // package scripts.
  const named = new Set([
    '.cargo',
    '.gitmodules',
    '.mvn',
    '.npmrc',
    '.nvmrc',
    '.phpactor.json',
    '.python-version',
    '.ruby-version',
    '.terraform',
    '.tool-versions',
    '.vscode',
    'gradle',
    'gradlew',
    'global.json',
    'mise.toml',
    'mvnw',
    'node_modules',
    'package.json',
    'rust-analyzer.toml',
    'rust-toolchain.toml',
  ]);
  const files = filesUnder(samples);
  expect(files.filter((file) => file.split('/').some((part) => named.has(part)))).toEqual([]);
  expect(files.filter((file) => /lo-hostile|\.invalid\b|^toolchain /m.test(sample(file)))).toEqual(
    [],
  );
});
