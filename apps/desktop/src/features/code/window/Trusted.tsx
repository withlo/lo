// Settings' Trusted row: the repositories and pull requests the reader trusts, from the settings
// file, which only main writes. "Stop trusting" asks main to stop trusting one; trusting happens on
// a pull request's tab, through main's own dialog.

import { ago, Problem, TrustList, type TrustEntry as TrustRow } from '@lo/ui';
import { useState } from 'react';

import { IpcError } from '../../../ipc/contract.ts';
import { settingRow, type ControlProps } from '../../settings/window/shared.ts';
import { readTrusted, trusted, type TrustEntry } from '../settings.ts';
import { main } from './main.ts';

/** The key a row is removed by: the repository's node ID, and the pull request's number. */
function keyOf(entry: TrustEntry): string {
  return entry.kind === 'repo' ? entry.id : `${entry.id}#${entry.pull}`;
}

/**
 * The rows of `entries`, one for each thing trusted: a repository renamed and trusted again is one.
 * One the file holds with no time was added there by hand.
 */
export function rowsOf(entries: readonly TrustEntry[], now: number): TrustRow[] {
  const rows = new Map<string, TrustRow>();
  for (const entry of entries) {
    rows.set(keyOf(entry), {
      key: keyOf(entry),
      name: entry.kind === 'repo' ? entry.repo : `${entry.from}#${entry.pull}`,
      kind: entry.kind === 'repo' ? 'repo' : 'fork',
      trusted:
        entry.at === undefined ? (
          <>
            added in <span className="code-small">settings.json</span>
          </>
        ) : (
          `trusted ${ago(Date.parse(entry.at), now)}`
        ),
    });
  }
  return [...rows.values()];
}

/** What a row's key removes. */
function removal(key: string): { id: string; pull: number | null } {
  const at = key.lastIndexOf('#');
  return at < 0
    ? { id: key, pull: null }
    : { id: key.slice(0, at), pull: Number(key.slice(at + 1)) };
}

/** The list, under the row's words: each thing trusted, and what didn't stop being trusted. */
function Trusted({ value }: ControlProps<typeof trusted.fallback>) {
  const [failed, setFailed] = useState<{ key: string; unsaved: boolean }>();
  const remove = (key: string) => {
    setFailed(undefined);
    main()
      .untrust(removal(key))
      .catch((error: unknown) => {
        console.error("Lo couldn't stop trusting a repo:", error);
        setFailed({ key, unsaved: error instanceof IpcError && error.code === 'unwritable' });
      });
  };
  const rows = rowsOf(readTrusted(value).entries, Date.now()).map((row) =>
    row.key === failed?.key
      ? {
          ...row,
          problem: (
            <Problem
              title={`Couldn’t stop trusting ${row.name}`}
              reason={
                failed.unsaved ? (
                  <>
                    <span className="code-small">settings.json</span> couldn’t be saved.
                  </>
                ) : undefined
              }
              action={{ label: 'Try again', onClick: () => remove(row.key) }}
            />
          ),
        }
      : row,
  );
  return <TrustList entries={rows} onRemove={remove} />;
}

export default settingRow(trusted, { order: 20, control: Trusted, list: true });
