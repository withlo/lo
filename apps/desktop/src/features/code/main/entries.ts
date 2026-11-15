// Changes to the trusted entries, made on the list as the settings file holds it: an entry Lo
// can't read stays as the person wrote it, still reported, whatever Lo adds or takes away.

import { fileEntry, readEntry, sameName, type Listed, type TrustEntry } from '../settings.ts';

/** Whether `one` and `other` trust the same thing: the same repository, or the same pull request. */
function sameThing(one: TrustEntry, other: TrustEntry): boolean {
  if (one.kind === 'repo' && other.kind === 'repo') {
    // By ID, as when a repository was renamed and trusted again; or by name, as when the name is
    // someone else's repository now.
    return one.id === other.id || sameName(one.repo, other.repo);
  }
  if (one.kind === 'pull' && other.kind === 'pull') {
    return one.pull === other.pull && (one.id === other.id || sameName(one.repo, other.repo));
  }
  return false;
}

/** `list` with `entry` added at its end, in place of the entries for the same thing. */
export function withEntry(list: Listed, entry: TrustEntry): Listed {
  return [
    ...list.filter((each) => {
      const read = readEntry(each);
      return read === undefined || !sameThing(read, entry);
    }),
    fileEntry(entry),
  ];
}

/** What to take out of the list: a repository by its node ID, or that pull request in it. */
export interface Removal {
  readonly id: string;
  readonly pull: number | null;
}

/** Whether `entry` is what `removal` takes out. */
export function removes(removal: Removal, entry: TrustEntry): boolean {
  if (entry.id !== removal.id) return false;
  return removal.pull === null
    ? entry.kind === 'repo'
    : entry.kind === 'pull' && entry.pull === removal.pull;
}

/** `list` without the entries `take` picks, and those entries, as Lo read them. */
export function withoutEntries(
  list: Listed,
  take: (entry: TrustEntry) => boolean,
): { list: Listed; removed: TrustEntry[] } {
  const removed: TrustEntry[] = [];
  const kept = list.filter((each) => {
    const read = readEntry(each);
    if (read === undefined || !take(read)) return true;
    removed.push(read);
    return false;
  });
  return { list: kept, removed };
}
