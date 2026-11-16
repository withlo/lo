// Settings' Trust section: the repositories and pull requests the reader trusts, from the settings
// file, which only main writes. "Remove" asks main to stop trusting one; trusting happens on a
// pull request's tab, through main's own dialog.

import { TrustList, type TrustEntry as TrustRow } from '@lo/ui';

import { notify } from '../../../window/commands/notices.tsx';
import { defineSection, useSetting } from '../../settings/window/shared.ts';
import { readTrusted, trusted, type TrustEntry } from '../settings.ts';
import { main } from './main.ts';

const DAY = 24 * 60 * 60 * 1000;

/** How long ago `at` was, in days, as a trust row says it: "today", "yesterday", "12 days ago". */
export function daysAgo(at: string | undefined, now: number): string {
  if (at === undefined) return 'in the settings file';
  const then = new Date(at);
  const today = new Date(now);
  const days = Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
      DAY,
  );
  if (!Number.isFinite(days) || days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days.toLocaleString('en-US')} days ago`;
}

/** The key a row is removed by: the repository's node ID, and the pull request's number. */
function keyOf(entry: TrustEntry): string {
  return entry.kind === 'repo' ? entry.id : `${entry.id}#${entry.pull}`;
}

/** The rows of `entries`, one for each thing trusted: a repository renamed and trusted again is one. */
export function rowsOf(entries: readonly TrustEntry[], now: number): TrustRow[] {
  const rows = new Map<string, TrustRow>();
  for (const entry of entries) {
    rows.set(keyOf(entry), {
      key: keyOf(entry),
      name: entry.kind === 'repo' ? entry.repo : `${entry.from}#${entry.pull}`,
      kind: entry.kind === 'repo' ? 'repo' : 'fork',
      trusted: daysAgo(entry.at, now),
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

/** Asks main to stop trusting the row `key`. */
function remove(key: string): void {
  main()
    .untrust(removal(key))
    .catch((error: unknown) => {
      console.error("Lo couldn't stop trusting a repo:", error);
      notify('Remove', "Lo couldn't change the settings file.");
    });
}

function Trusted() {
  const value = useSetting(trusted);
  const rows = rowsOf(readTrusted(value).entries, Date.now());
  return <TrustList entries={rows} onRemove={remove} />;
}

export default defineSection({
  id: 'code.trust',
  title: 'Trust',
  description:
    'Language servers aren’t sandboxed. A repo’s settings can steer them. A file that exploits a bug in one could run code as you. They only start on repos and PRs you trust.',
  order: 20,
  render: Trusted,
});
