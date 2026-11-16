// The toolchains language servers use, in main: what Settings lists of each (whether it's
// downloaded, how large it is and what uses it), removing one, and what a server says when its
// toolchain can't download or was removed. Lo's copies are in the cache's `toolchains/`, with an
// installer of their own. Nothing here calls Electron.

import {
  checkoutProblem,
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

/**
 * `adapter`'s way to install a toolchain, by `install`: only one among those it names as its
 * downloads, which Settings lists it as using and "Remove" stops it for.
 */
export function listedToolchain<T>(
  adapter: Adapter,
  install: (id: string) => Promise<T>,
): (id: string) => Promise<T> {
  return (id) =>
    usesToolchain(adapter, id)
      ? install(id)
      : Promise.reject(
          new Error(`${adapter.name} doesn’t name the toolchain ${id} among its downloads.`),
        );
}

/**
 * Why `adapter`'s server mustn't run on the checkout at `folder`, by what each toolchain it uses
 * reads there, such as a `global.json` that could choose a .NET SDK other than Lo's, then by what
 * the server itself reads there, such as the `.settings` Java's server would take as its own.
 */
export async function checkoutRefusal(
  adapter: Adapter,
  folder: string,
): Promise<string | undefined> {
  for (const id of adapter.downloads?.toolchains ?? []) {
    const problem = await checkoutProblem(id, folder);
    if (problem !== undefined) return problem;
  }
  return adapter.checkout?.(folder);
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

/** Why removing a toolchain's files failed with `error`, as a sentence: what the notice says. */
export function removalFailure(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  const path = error instanceof Error && 'path' in error ? error.path : undefined;
  const where = typeof path === 'string' ? path : 'its folder';
  if (code === 'EACCES' || code === 'EPERM') return `Lo isn’t allowed to delete ${where}.`;
  if (code === 'EBUSY') return `A program is using ${where}.`;
  const message = error instanceof Error ? error.message : String(error);
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

/**
 * Removes toolchain `id`, as Settings' "Remove" asks. Installs of it are refused from the start,
 * so a server starting meanwhile, or "Restart" pressed, can't get the folder that's going. Then
 * the servers that use it stop, each saying so until "Restart" downloads it again, and once they
 * have, its folder is renamed aside and deleted.
 */
export async function removeToolchain(host: ToolchainHost, id: string): Promise<void> {
  if (!Object.hasOwn(host.manifest, id)) throw new Error(`Lo has no toolchain ${id}`);
  const message = removedMessage(id);
  const halt = () => host.halt((adapter) => usesToolchain(adapter, id), message);
  const installer = host.installer();
  if (installer === undefined) await halt();
  else await installer.remove(id, new Error(message), halt);
}
