// The live check, by hand only, never in CI:
//
//   pnpm nx run lsp:live [-- <id>…]
//
// It installs what servers.json pins for this system, or just the IDs given, into
// ~/.cache/lo-live/, through the same checks Lo makes, so each version downloads once. Then it
// runs each one's check below, one at a time: Node says its version, and a server answers a hover
// and a definition on its language's sample project in testing/fixtures/code/, printing what came
// back. Check the machine has memory to spare before running it.

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { type Installed, Installer, MANIFEST, type Pinned } from '../src/index.ts';

/** What a check knows: what's pinned, and where everything it has installed is. */
interface Context {
  readonly pinned: Pinned;
  /** Installs another entry, such as the Node a JavaScript server runs on. */
  readonly install: (id: string) => Promise<Installed>;
}

/**
 * Runs what's installed, prints what it found, and throws if it's wrong. A server's check starts
 * it with `askServer` (ask.ts).
 */
type Check = (installed: Installed, context: Context) => Promise<void>;

/** Each ID's check. */
const CHECKS: Record<string, Check> = {
  node: async (installed, { pinned }) => {
    const { stdout } = await promisify(execFile)(installed.entry, ['--version'], {
      env: { PATH: '/usr/bin:/bin' },
    });
    if (stdout.trim() !== `v${pinned.version}`) {
      throw new Error(`Node says it's ${stdout.trim()}, not v${pinned.version}`);
    }
    console.log(`Node ${stdout.trim()} runs.`);
  },
};

const installer = new Installer({
  folder: join(homedir(), '.cache', 'lo-live'),
  fetch: globalThis.fetch,
});

async function install(id: string): Promise<Installed> {
  const pinned = MANIFEST[id];
  if (pinned === undefined) throw new Error(`servers.json has no ${id}`);
  return installer.install(id, pinned, {
    progress: (received, total) => {
      if (received === total) console.log(`${id} ${pinned.version}: ${total} bytes, checked.`);
    },
  });
}

const asked = process.argv.slice(2);
const ids = asked.length > 0 ? asked : Object.keys(MANIFEST);
let failed = false;
for (const id of ids) {
  const pinned = MANIFEST[id];
  const check = CHECKS[id];
  if (pinned === undefined || check === undefined) {
    console.error(
      `${id}: ${pinned === undefined ? 'servers.json has no such entry' : 'no check yet'}.`,
    );
    failed = true;
    continue;
  }
  try {
    await check(await install(id), { pinned, install });
  } catch (error) {
    console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}
await installer.prune(MANIFEST);
process.exitCode = failed ? 1 : 0;
