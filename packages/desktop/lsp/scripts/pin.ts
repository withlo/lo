// Records a version of a server, or of Node, in servers.json:
//
//   pnpm nx run lsp:pin -- <id> <version>
//
// It downloads the version for every platform, checks each file against its publisher's
// signature (see sources.ts), checks that it unpacks as Lo would, and writes each file's address,
// size and SHA-256. Run it by hand when a version changes, and commit servers.json with the
// change that needs it. CI never runs it, and Lo trusts only the hashes it wrote.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { format, resolveConfig } from 'prettier';

import { parseManifest } from '../src/index.ts';
import { node, npm, type Source } from './sources.ts';

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
};

const MANIFEST = join(import.meta.dirname, '..', 'servers.json');

const [id, version, ...rest] = process.argv.slice(2);
const source = id === undefined ? undefined : SOURCES[id];
if (id === undefined || version === undefined || rest.length > 0 || source === undefined) {
  console.error(
    `Usage: pin.ts <id> <version>, where <id> is one of ${Object.keys(SOURCES).join(', ')}.`,
  );
  process.exit(2);
}

const folder = await mkdtemp(join(tmpdir(), 'lo-pin-'));
try {
  const pinned = await source(version, {
    fetch: globalThis.fetch,
    folder,
    log: (line) => console.log(line),
  });
  const manifest = parseManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')));
  manifest[id] = pinned;
  const sorted = Object.fromEntries(
    Object.entries(manifest).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  parseManifest(sorted);
  const options = await resolveConfig(MANIFEST);
  writeFileSync(
    MANIFEST,
    await format(JSON.stringify(sorted, null, 2), { ...options, filepath: MANIFEST }),
  );
  console.log(`Recorded ${id} ${version} in servers.json.`);
} finally {
  await rm(folder, { recursive: true, force: true });
}
