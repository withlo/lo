// What Settings' Toolchains section shows of what main lists, and says when one isn't removed.

import { formatBytes, type ToolchainEntry } from '@lo/ui';

import { IpcError } from '../../../ipc/contract.ts';
import type { Toolchain } from '../contract.ts';

/** A row for each of the toolchains main listed, with those `removing` names waiting. */
export function rowsOf(
  toolchains: readonly Toolchain[],
  removing: ReadonlySet<string> = new Set(),
): ToolchainEntry[] {
  return toolchains.map((toolchain) => ({
    id: toolchain.id,
    name: toolchain.name,
    version: toolchain.version,
    installed: toolchain.installed === null ? undefined : formatBytes(toolchain.installed),
    download: formatBytes(toolchain.download),
    uses: toolchain.uses,
    removing: removing.has(toolchain.id),
  }));
}

/** What the notice says once `name` wasn't removed, from `error`, which main's answer gave. */
export function notRemoved(name: string, error: unknown): string {
  const why = error instanceof IpcError ? error.message : 'Lo couldn’t ask for it.';
  return `${name} wasn’t removed. ${why}`;
}
