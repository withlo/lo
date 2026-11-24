// What Settings' Toolchains row shows of what main lists, and why one wasn't deleted.

import { bytes, type ToolchainEntry } from '@lo/ui';

import { IpcError } from '../../../ipc/contract.ts';
import type { Toolchain } from '../contract.ts';

/**
 * A row for each of the toolchains main listed, with those `removing` names waiting: Lo's, and the
 * system's, which say where they're from.
 */
export function rowsOf(
  toolchains: readonly Toolchain[],
  removing: ReadonlySet<string> = new Set(),
): ToolchainEntry[] {
  return toolchains.map((toolchain) =>
    'from' in toolchain
      ? {
          kind: 'system',
          id: toolchain.id,
          name: toolchain.name,
          from: toolchain.from ?? undefined,
          needs: toolchain.needs,
          uses: toolchain.uses,
        }
      : {
          id: toolchain.id,
          name: toolchain.name,
          version: toolchain.version,
          installed: toolchain.installed === null ? undefined : bytes(toolchain.installed),
          download: bytes(toolchain.download),
          uses: toolchain.uses,
          removing: removing.has(toolchain.id),
        },
  );
}

/**
 * Why a toolchain wasn't deleted, from `error`, which main's answer gave: what main said, or nothing
 * when it's not known.
 */
export function notRemoved(error: unknown): string {
  return error instanceof IpcError ? error.message : '';
}
