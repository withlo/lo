// The toolchains language servers use, in main: what Settings lists of each (whether it's
// downloaded, how large it is and what uses it), removing one, and what a server says when its
// toolchain can't download or was removed. Lo's copies are in the cache's `toolchains/`, with an
// installer of their own. Nothing here calls Electron.

import {
  downloadFor,
  type Installer,
  type Manifest,
  partsOf,
  type Platform,
  TOOLCHAIN_NAMES,
} from '@lo/lsp';

import type { Toolchain as Listed } from '../contract.ts';
import type { Adapter } from './adapters.ts';

/** What these need: the toolchains pinned, where they go, and the servers that use them. */
export interface ToolchainHost {
  readonly manifest: Manifest;
  /** The platform Lo runs on, or `undefined` for one it downloads nothing for. */
  readonly platform: Platform | undefined;
  /** The toolchains' installer, once the cache is open. */
  readonly installer: () => Pick<Installer, 'recorded' | 'remove'> | undefined;
  /** The adapters Lo runs servers with. */
  readonly adapters: () => readonly Adapter[];
  /** Stops the servers whose adapters `uses` picks, each saying `message`, once they have. */
  readonly halt: (uses: (adapter: Adapter) => boolean, message: string) => Promise<void>;
}

/** What Lo calls toolchain `id`, in a row and at the start of a sentence. */
function named(id: string): { name: string; subject: string } {
  const known = Object.hasOwn(TOOLCHAIN_NAMES, id) ? TOOLCHAIN_NAMES[id] : undefined;
  const phrase = known?.phrase ?? id;
  return {
    name: known?.name ?? id,
    subject: `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`,
  };
}

/** Whether `adapter`'s server uses toolchain `id`. */
export function usesToolchain(adapter: Adapter, id: string): boolean {
  return adapter.downloads?.toolchains?.includes(id) ?? false;
}

/** What a server says once toolchain `id` couldn't install, from why: "Go couldn’t download. …" */
export function toolchainFailure(id: string, error: unknown): Error {
  const why = error instanceof Error ? error.message : String(error);
  return new Error(`${named(id).subject} couldn’t download. ${why}`, { cause: error });
}

/** What a server that used toolchain `id` says once it's removed. */
export function removedMessage(id: string): string {
  return `${named(id).subject} was removed. Restart downloads it again.`;
}

/**
 * The toolchains pinned for this system, in the manifest's order, each with the bytes its files
 * take by its marker, or `null` while it isn't downloaded, and the servers that use it.
 */
export async function listToolchains(host: ToolchainHost): Promise<Listed[]> {
  const { platform } = host;
  if (platform === undefined) return [];
  const installer = host.installer();
  const adapters = host.adapters();
  const listed: Listed[] = [];
  for (const [id, pinned] of Object.entries(host.manifest)) {
    const download = downloadFor(pinned, platform);
    if (download === undefined) continue;
    const installed = (await installer?.recorded(id, pinned).catch(() => undefined)) ?? null;
    listed.push({
      id,
      name: named(id).name,
      version: pinned.version,
      installed,
      download: partsOf(download).reduce((sum, part) => sum + part.size, 0),
      uses: adapters.filter((adapter) => usesToolchain(adapter, id)).map((adapter) => adapter.name),
    });
  }
  return listed;
}

/**
 * Removes toolchain `id`, as Settings' "Remove" asks: the servers that use it stop first, each
 * saying so until "Restart" downloads it again, then an install of it under way stops, and its
 * folder is renamed aside and deleted.
 */
export async function removeToolchain(host: ToolchainHost, id: string): Promise<void> {
  if (!Object.hasOwn(host.manifest, id)) throw new Error(`Lo has no toolchain ${id}`);
  const message = removedMessage(id);
  await host.halt((adapter) => usesToolchain(adapter, id), message);
  await host.installer()?.remove(id, new Error(message));
}
