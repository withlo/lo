// Builds each grammar in grammars.json to WebAssembly, in dist/grammars/<name>.wasm, with the
// tree-sitter CLI this package pins. Nothing it runs or builds from goes unchecked:
//
// - the CLI's binary, which its package's install script downloads, against its SHA-256;
// - the WebAssembly toolchain the CLI builds with, wasi-sdk and binaryen, which this script
//   downloads itself, against their SHA-256s, so the CLI never downloads them;
// - each grammar's source, fetched with git at its pinned commit, which git checks against the
//   commit's ID, with the patches in patches/ applied;
// - and each build, against the SHA-256 recorded beside the grammar, so a different source or
//   toolchain fails the build.
//
//   pnpm nx run syntax:build
//   pnpm nx run syntax:build -- --update   record the checksums of a new or changed grammar
//
// The toolchain goes to `lo/tree-sitter` in the user's cache folder, where every checkout finds it.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(import.meta.dirname, '..');
const listFile = join(root, 'grammars.json');
const output = join(root, 'dist', 'grammars');
const sources = join(root, '.cache', 'sources');
const patches = join(root, 'patches');
const cli = join(root, 'node_modules', 'tree-sitter-cli', 'tree-sitter');
const toolchains = join(
  process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
  'lo',
  'tree-sitter',
);

interface Grammar {
  name: string;
  /** `owner/name` on GitHub. */
  repo: string;
  commit: string;
  /** The grammar's folder in the repo. */
  path: string;
  /** Patches in patches/ to apply to the repo before building. */
  patches?: string[];
  /** The SHA-256 of the built `.wasm`, in hex. */
  sha256?: string;
}

/** A download, and the SHA-256 of what it gives. */
interface Pinned {
  url: string;
  sha256: string;
}

/**
 * What the CLI 0.27.2 runs and builds with, on the platforms Lo is built on. The binary's checksum
 * is of the file its install script writes, which it unzips from the release's
 * `tree-sitter-<platform>.gz`. The CLI would download the same wasi-sdk and binaryen itself.
 */
const pinned: Record<string, { cli: string; wasiSdk: Pinned; binaryen: Pinned }> = {
  'darwin-arm64': {
    cli: '755fe1c7067fe2b0794f849fcb9c2d3deee503245b1bed645d694edd189a1ede',
    wasiSdk: {
      url: 'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-arm64-macos.tar.gz',
      sha256: '9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9',
    },
    binaryen: {
      url: 'https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-arm64-macos.tar.gz',
      sha256: '98aad827847af7ef990ed7098d885725c8e5b5aae75073403635617ae4e259aa',
    },
  },
  'linux-x64': {
    cli: 'a658dfc7704d6595a3d2f50eba2590f5919ecd54beedf978ba9888ec914fec1f',
    wasiSdk: {
      url: 'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz',
      sha256: 'b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4',
    },
    binaryen: {
      url: 'https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-x86_64-linux.tar.gz',
      sha256: '195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572',
    },
  },
};

const update = process.argv.includes('--update');
const list: { grammars: Grammar[] } = JSON.parse(readFileSync(listFile, 'utf8'));

/** Runs a command, with git's user and system settings and hooks out of the way. */
function run(
  command: string,
  args: readonly string[],
  cwd = root,
  extra: Record<string, string> = {},
): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  Object.assign(
    env,
    {
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'https',
    },
    extra,
  );
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

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** The toolchain at `pin`, downloaded, checked and unpacked once into its own folder. */
async function toolchain(name: string, pin: Pinned): Promise<string> {
  const folder = join(toolchains, `${name}-${pin.sha256.slice(0, 16)}`);
  const done = `${folder}.done`;
  if (existsSync(done)) return folder;
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const archive = `${folder}.tar.gz`;
  const response = await fetch(pin.url);
  if (!response.ok || !response.body) throw new Error(`${pin.url}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const sha256 = await sha256Of(archive);
  if (sha256 !== pin.sha256) {
    rmSync(archive, { force: true });
    throw new Error(`${pin.url} has SHA-256 ${sha256}, not the pinned ${pin.sha256}.`);
  }
  await run('tar', ['-xzf', archive, '-C', folder, '--strip-components=1']);
  rmSync(archive, { force: true });
  writeFileSync(done, '');
  return folder;
}

/** The repo's files at `commit`, fetched once into the source cache. */
async function checkout({ repo, commit }: Grammar): Promise<string> {
  const folder = join(sources, `${repo.replace('/', '__')}@${commit}`);
  const done = `${folder}.done`;
  if (existsSync(done)) return folder;
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const git = (...args: string[]): Promise<string> =>
    run('git', ['-c', `core.hooksPath=${devNull}`, '-C', folder, ...args]);
  await git('init', '--quiet', '--template=');
  await git('fetch', '--quiet', '--depth=1', `https://github.com/${repo}.git`, commit);
  await git('checkout', '--quiet', '--detach', commit);
  writeFileSync(done, '');
  return folder;
}

/** Puts the repo at `folder` back as its commit has it, then applies `names` from patches/. */
async function patch(folder: string, names: readonly string[]): Promise<void> {
  const git = (...args: string[]): Promise<string> =>
    run('git', ['-c', `core.hooksPath=${devNull}`, '-C', folder, ...args]);
  await git('checkout', '--quiet', '--force', 'HEAD');
  await git('clean', '--quiet', '--force', '-d', '-x');
  for (const name of names) await git('apply', join(patches, name));
}

const platform = `${process.platform}-${process.arch}`;
const pins = pinned[platform];
if (!pins) throw new Error(`No pinned tree-sitter toolchain for ${platform}.`);
const cliSha256 = await sha256Of(cli);
if (cliSha256 !== pins.cli) {
  throw new Error(`${cli} has SHA-256 ${cliSha256}, not the pinned ${pins.cli}.`);
}
const [wasiSdk, binaryen] = await Promise.all([
  toolchain('wasi-sdk', pins.wasiSdk),
  toolchain('binaryen', pins.binaryen),
]);
const env = { TREE_SITTER_WASI_SDK_PATH: wasiSdk, TREE_SITTER_BINARYEN_PATH: binaryen };

mkdirSync(output, { recursive: true });
const failures: string[] = [];
for (const grammar of list.grammars) {
  const started = performance.now();
  const repo = await checkout(grammar);
  await patch(repo, grammar.patches ?? []);
  const wasm = join(output, `${grammar.name}.wasm`);
  await run(cli, ['build', '--wasm', '--output', wasm, join(repo, grammar.path)], root, env);
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
