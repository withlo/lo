// Changes to the trusted entries, made on the list as the settings file holds it: an entry Lo
// can't read stays as the person wrote it, still reported, whatever Lo adds or takes away. And what
// a change takes away, however it was made, which Lo lets go of: an entry's checkouts are named by
// its repository's name, which is the name of every view it trusts.

import type { Decision, DecidedView } from './decide.ts';
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

/**
 * What "Stop trusting this repo" takes out for `view`: the entry that trusts it, as last decided;
 * or, while nothing has been decided to trust it, only the entries for its repository that name it,
 * never a pull request's.
 */
export function meant(
  view: DecidedView,
  decision: Decision | undefined,
): (entry: TrustEntry) => boolean {
  const by = decision?.trust.kind === 'trusted' ? decision.by : undefined;
  if (by) {
    const removal: Removal = { id: by.id, pull: by.kind === 'pull' ? by.pull : null };
    return (entry) => removes(removal, entry);
  }
  return (entry) => entry.kind === 'repo' && sameName(entry.repo, view.repo);
}

/** Whether `one` and `other` trust exactly the same, whenever each was trusted. */
function same(one: TrustEntry, other: TrustEntry): boolean {
  if (one.id !== other.id || !sameName(one.repo, other.repo)) return false;
  if (one.kind === 'repo' || other.kind === 'repo') return one.kind === other.kind;
  return one.pull === other.pull && one.fromId === other.fromId && sameName(one.from, other.from);
}

/** The entries of `before` that `after` no longer has, however they went. */
export function goneFrom(
  before: readonly TrustEntry[],
  after: readonly TrustEntry[],
): TrustEntry[] {
  return before.filter((entry) => !after.some((each) => same(entry, each)));
}

/**
 * Checkouts no longer trusted, to let go of: one pull request's, or every one of a repository's
 * but those of the pull requests in `except`, which other entries still trust.
 */
export type Drop =
  | { readonly repo: string; readonly pull: number }
  | { readonly repo: string; readonly except: readonly number[] };

/**
 * What to let go of once the entries `gone` are no longer trusted and `after` still are: for a
 * repository's entry, its checkouts but those of forks' pull requests still trusted by their own
 * entries; for a pull request's, its checkouts. Nothing that an entry left in `after` still trusts.
 */
export function dropsFor(gone: readonly TrustEntry[], after: readonly TrustEntry[]): Drop[] {
  const drops: Drop[] = [];
  const taken = new Set<string>();
  const trustedPulls = (repo: string) =>
    after.flatMap((each) => (each.kind === 'pull' && sameName(each.repo, repo) ? [each.pull] : []));
  for (const entry of gone) {
    const key = entry.repo.toLowerCase();
    const still = after.some(
      (each) => each.kind === 'repo' && each.id === entry.id && sameName(each.repo, entry.repo),
    );
    if (entry.kind !== 'repo' || still || taken.has(key)) continue;
    taken.add(key);
    drops.push({
      repo: entry.repo,
      except: [...new Set(trustedPulls(entry.repo))].toSorted((one, other) => one - other),
    });
  }
  for (const entry of gone) {
    const key = entry.repo.toLowerCase();
    if (entry.kind !== 'pull' || taken.has(key) || taken.has(`${key}#${entry.pull}`)) continue;
    if (trustedPulls(entry.repo).includes(entry.pull)) continue;
    taken.add(`${key}#${entry.pull}`);
    drops.push({ repo: entry.repo, pull: entry.pull });
  }
  return drops;
}
