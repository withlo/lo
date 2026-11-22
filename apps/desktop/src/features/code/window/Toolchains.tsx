// Settings' Toolchains row: the toolchains Lo downloads for language servers, as main lists them,
// each with how much room it takes or that it isn't downloaded, and what uses it, and on a Mac
// Swift's, which comes with Xcode or Apple's Command Line Tools, with where it's from. "Delete" asks
// main to delete one of Lo's: the servers that use it stop, and its files go. Its button is busy
// meanwhile, and the item says why when it isn't deleted.

import { Problem, SettingsList, ToolchainList } from '@lo/ui';
import { useEffect, useState } from 'react';

import { defineRow } from '../../settings/window/shared.ts';
import type { Toolchain } from '../contract.ts';
import { main } from './main.ts';
import { notRemoved, rowsOf } from './rows.ts';

function Toolchains({ label, description }: { label: string; description: string }) {
  const [listed, setListed] = useState<readonly Toolchain[]>();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<{ id: string; why: string }>();
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

  /** Asks main to delete toolchain `id`; its button is busy until the list shows it gone. */
  const remove = (id: string) => {
    const name = rows.find((row) => row.id === id)?.name ?? id;
    setFailed(undefined);
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
          setFailed({ id, why: notRemoved(error) });
        },
      )
      .finally(() => setRemoving((all) => new Set([...all].filter((each) => each !== id))));
  };
  const shown = rows.map((row) =>
    row.kind !== 'system' && row.id === failed?.id
      ? {
          ...row,
          problem: (
            <Problem
              title={`Couldn’t delete ${row.name}`}
              reason={failed.why === '' ? undefined : failed.why}
              action={{ label: 'Try again', onClick: () => remove(row.id) }}
            />
          ),
        }
      : row,
  );
  return (
    <SettingsList label={label} description={description}>
      <ToolchainList entries={shown} onRemove={remove} />
    </SettingsList>
  );
}

export default defineRow({
  id: 'code.toolchains',
  group: 'code',
  order: 30,
  label: 'Toolchains',
  description: 'Each downloads the first time a language server needs it.',
  words: () => ['language servers', 'download', 'delete'],
  render: Toolchains,
});
