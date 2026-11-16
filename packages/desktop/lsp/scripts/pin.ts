// Records a version of a server, or of Node, in servers.json, or of a toolchain in
// toolchains.json:
//
//   pnpm nx run lsp:pin -- <id> <version>
//
// It downloads the version for every platform, checks each file against its publisher's
// signature (see sources.ts and toolchains.ts), checks that it unpacks as Lo would, and writes
// each file's address, size and SHA-256, and for a toolchain what it unpacks to. Run it by hand
// when a version changes, and commit the manifest with the change that needs it. CI never runs it,
// and Lo trusts only the hashes it wrote. The toolchains are pinned again before each release.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { format, resolveConfig } from 'prettier';

import { parseManifest, parseToolchains } from '../src/index.ts';
import { githubRelease, node, npm, rustAnalyzer, type Source } from './sources.ts';
import { dotnet, go, rust, temurin } from './toolchains.ts';

/** The armored public keys in `keys/<publisher>/`. */
function keys(publisher: string): string[] {
  const folder = join(import.meta.dirname, 'keys', publisher);
  return readdirSync(folder)
    .filter((name) => name.endsWith('.asc'))
    .map((name) => readFileSync(join(folder, name), 'utf8'));
}

/** Where each ID's files come from. */
const SOURCES: Record<string, Source> = {
  node: node(keys('node')),
  // Its own entry point, not `bin/vtsls.js`, the launcher that loads it.
  vtsls: npm('@vtsls/language-server', 'node_modules/@vtsls/language-server/dist/main.js'),
  // Its own entry point, which says where its files are and loads the server.
  pyright: npm('pyright', 'node_modules/pyright/langserver.index.js'),
  'rust-analyzer': rustAnalyzer(),
  // Its release's archives, each holding the one program. Linux's are linked statically, with
  // musl, so they run whatever C library the system has.
  'php-lsp': githubRelease(
    'jorgsowa/php-lsp',
    {
      'darwin-arm64': 'php-lsp-aarch64-apple-darwin.tar.gz',
      'darwin-x64': 'php-lsp-x86_64-apple-darwin.tar.gz',
      'linux-x64': 'php-lsp-x86_64-unknown-linux-musl.tar.gz',
      'linux-arm64': 'php-lsp-aarch64-unknown-linux-musl.tar.gz',
    },
    'php-lsp',
  ),
};

/** Where each toolchain's files come from. */
const TOOLCHAIN_SOURCES: Record<string, Source> = {
  go: go(keys('go')),
  rust: rust(keys('rust')),
  temurin: temurin(keys('temurin')),
  dotnet: dotnet(),
};

const [id, version, ...rest] = process.argv.slice(2);
const toolchain = id !== undefined && Object.hasOwn(TOOLCHAIN_SOURCES, id);
const source = id === undefined ? undefined : toolchain ? TOOLCHAIN_SOURCES[id] : SOURCES[id];
if (id === undefined || version === undefined || rest.length > 0 || source === undefined) {
  const ids = [...Object.keys(SOURCES), ...Object.keys(TOOLCHAIN_SOURCES)].join(', ');
  console.error(`Usage: pin.ts <id> <version>, where <id> is one of ${ids}.`);
  process.exit(2);
}

const MANIFEST = join(import.meta.dirname, '..', toolchain ? 'toolchains.json' : 'servers.json');
const parse = toolchain ? parseToolchains : parseManifest;

const folder = await mkdtemp(join(tmpdir(), 'lo-pin-'));
try {
  const pinned = await source(version, {
    fetch: globalThis.fetch,
    folder,
    log: (line) => console.log(line),
  });
  const manifest = parse(JSON.parse(readFileSync(MANIFEST, 'utf8')));
  manifest[id] = pinned;
  const sorted = Object.fromEntries(
    Object.entries(manifest).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  parse(sorted);
  const options = await resolveConfig(MANIFEST);
  writeFileSync(
    MANIFEST,
    await format(JSON.stringify(sorted, null, 2), { ...options, filepath: MANIFEST }),
  );
  console.log(`Recorded ${id} ${version} in ${toolchain ? 'toolchains.json' : 'servers.json'}.`);
} finally {
  await rm(folder, { recursive: true, force: true });
}
