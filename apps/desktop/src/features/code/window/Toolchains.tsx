// Settings' Toolchains section: the toolchains Lo downloads for language servers, as main lists
// them, each with how much room it takes or that it isn't downloaded, and what uses it, and on a
// Mac Swift's, which comes with Xcode or Apple's Command Line Tools, with where it's from. "Remove"
// asks main to remove one of Lo's: the servers that use it stop, and its files go. Its button waits
// meanwhile, and a notice says why when it isn't removed.

import { ToolchainList } from '@lo/ui';
import { useEffect, useState } from 'react';

import { notify } from '../../../window/commands/notices.tsx';
import { defineSection } from '../../settings/window/shared.ts';
import type { Toolchain } from '../contract.ts';
import { main } from './main.ts';
import { notRemoved, rowsOf } from './rows.ts';

function Toolchains() {
  const [listed, setListed] = useState<readonly Toolchain[]>();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
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
  const rows = rowsOf(listed, removing);

  /** Asks main to remove toolchain `id`; its button waits until the list shows it gone. */
  const remove = (id: string) => {
    const name = rows.find((row) => row.id === id)?.name ?? id;
    setRemoving((all) => new Set([...all, id]));
    main()
      .removeToolchain({ id })
      .then(
        () =>
          main()
            .toolchains()
            .then(setListed, (error: unknown) => {
              console.error("Lo couldn't list the toolchains:", error);
            }),
        (error: unknown) => {
          console.error(`Lo couldn't remove ${name}:`, error);
          notify(`Remove ${name}`, notRemoved(name, error));
        },
      )
      .finally(() => setRemoving((all) => new Set([...all].filter((each) => each !== id))));
  };
  return <ToolchainList entries={rows} onRemove={remove} />;
}

export default defineSection({
  id: 'code.toolchains',
  title: 'Toolchains',
  description: navigator.platform.startsWith('Mac')
    ? 'Language servers build and read code with Lo’s own copies of these, never the ones on this computer, each downloaded the first time a server needs it. Swift’s is the exception: it comes with Xcode or Apple’s Command Line Tools.'
    : 'Language servers build and read code with Lo’s own copies of these, never the ones on this computer. Each downloads the first time a server needs it.',
  order: 55,
  render: Toolchains,
});
