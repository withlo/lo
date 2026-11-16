// Settings' Toolchains section: the toolchains Lo downloads for language servers, as main lists
// them, each with how much room it takes or that it isn't downloaded, and what uses it. "Remove"
// asks main to remove one: the servers that use it stop, and its files go.

import { ToolchainList, type ToolchainEntry } from '@lo/ui';
import { useEffect, useState } from 'react';

import { notify } from '../../../window/commands/notices.tsx';
import { defineSection } from '../../settings/window/shared.ts';
import type { Toolchain } from '../contract.ts';
import { main } from './main.ts';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** A size in bytes in the binary units the rest of Settings counts in: `229.1 MB`. */
export function sizeText(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit < 2) return `${Math.round(value)} ${UNITS[unit]}`;
  return `${value.toFixed(1).replace(/\.0$/, '')} ${UNITS[unit]}`;
}

/** A row for each of the toolchains main listed. */
export function rowsOf(toolchains: readonly Toolchain[]): ToolchainEntry[] {
  return toolchains.map((toolchain) => ({
    id: toolchain.id,
    name: toolchain.name,
    version: toolchain.version,
    installed: toolchain.installed === null ? undefined : sizeText(toolchain.installed),
    download: sizeText(toolchain.download),
    uses: toolchain.uses,
  }));
}

/** Asks main to remove toolchain `id`, named `name`. */
function remove(id: string, name: string): void {
  main()
    .removeToolchain({ id })
    .catch((error: unknown) => {
      console.error(`Lo couldn't remove ${name}:`, error);
      notify('Remove', `Lo couldn't remove ${name}.`);
    });
}

function Toolchains() {
  const [listed, setListed] = useState<readonly Toolchain[]>();
  useEffect(() => {
    let heard = false;
    const stop = main().subscribe('downloaded', (value) => {
      heard = true;
      setListed(value);
    });
    main()
      .toolchains()
      .then(
        (value) => {
          if (!heard) setListed(value);
        },
        (error: unknown) => console.error("Lo couldn't list the toolchains:", error),
      );
    return stop;
  }, []);
  if (listed === undefined) return null;
  const rows = rowsOf(listed);
  return (
    <ToolchainList
      entries={rows}
      onRemove={(id) => remove(id, rows.find((row) => row.id === id)?.name ?? id)}
    />
  );
}

export default defineSection({
  id: 'code.toolchains',
  title: 'Toolchains',
  description:
    'Language servers build and read code with Lo’s own copies of these, never the ones on this computer. Each downloads the first time a server needs it.',
  order: 55,
  render: Toolchains,
});
