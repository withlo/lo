// Builds each grammar in grammars.json to WebAssembly, in dist/grammars/<name>.wasm, with the
// tree-sitter CLI this package pins. Each grammar's source is fetched with git at its pinned
// commit, which git checks against the commit's ID, and each build is checked against the SHA-256
// recorded beside it, so a different source or toolchain fails the build.
//
//   pnpm nx run syntax:build
//   pnpm nx run syntax:build -- --update   record the checksums of a new or changed grammar
//
// The CLI downloads the WebAssembly toolchain it needs the first time it runs.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const listFile = join(root, 'grammars.json');
const output = join(root, 'dist', 'grammars');
const sources = join(root, '.cache', 'sources');
const cli = join(root, 'node_modules', '.bin', 'tree-sitter');
const cliVersion = '0.27.2';

interface Grammar {
  name: string;
  /** `owner/name` on GitHub. */
  repo: string;
  commit: string;
  /** The grammar's folder in the repo. */
  path: string;
  /** The SHA-256 of the built `.wasm`, in hex. */
  sha256?: string;
}

const update = process.argv.includes('--update');
const list: { grammars: Grammar[] } = JSON.parse(readFileSync(listFile, 'utf8'));

/** Runs a command, with git's user and system settings and hooks out of the way. */
function run(command: string, args: readonly string[], cwd = root): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https',
  });
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const text = Buffer.concat(out).toString('utf8');
      if (code === 0) done(text);
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}):\n${text}`));
    });
  });
}

/** The repo's files at `commit`, fetched once into the source cache. */
async function checkout({ repo, commit }: Grammar): Promise<string> {
  const folder = join(sources, `${repo.replace('/', '__')}@${commit}`);
  if (existsSync(join(folder, '.done'))) return folder;
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const git = (...args: string[]): Promise<string> =>
    run('git', ['-c', `core.hooksPath=${devNull}`, '-C', folder, ...args]);
  await git('init', '--quiet', '--template=');
  await git('fetch', '--quiet', '--depth=1', `https://github.com/${repo}.git`, commit);
  await git('checkout', '--quiet', '--detach', commit);
  writeFileSync(join(folder, '.done'), '');
  return folder;
}

const version = await run(cli, ['--version']);
if (!version.includes(cliVersion)) {
  throw new Error(`Expected tree-sitter ${cliVersion}, got ${version.trim()}.`);
}
mkdirSync(output, { recursive: true });
const failures: string[] = [];
for (const grammar of list.grammars) {
  const started = performance.now();
  const folder = join(await checkout(grammar), grammar.path);
  const wasm = join(output, `${grammar.name}.wasm`);
  await run(cli, ['build', '--wasm', '--output', wasm, folder]);
  const sha256 = createHash('sha256').update(readFileSync(wasm)).digest('hex');
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (update) {
    grammar.sha256 = sha256;
  } else if (grammar.sha256 !== sha256) {
    failures.push(`${grammar.name}: built ${sha256}, expected ${grammar.sha256 ?? 'no checksum'}`);
    rmSync(wasm);
  }
  console.log(`${grammar.name}: ${seconds} s`);
}
if (update) writeFileSync(listFile, `${JSON.stringify(list, null, 2)}\n`);
if (failures.length > 0) {
  console.error(
    `These grammars didn't build to their recorded checksums:\n  ${failures.join('\n  ')}\n` +
      'If the change is expected, run the build with --update and commit grammars.json.',
  );
  process.exit(1);
}
