// Which open tab a link points at, so opening a pull request that's already open shows its tab,
// and a link to a layer of a stack a tab shows finds that tab too.

import type { PullLink } from '@lo/review';

/** A repository by its owner and name. */
export interface Repository {
  readonly owner: string;
  readonly repo: string;
}

/** The pull request a tab shows: the link it was opened from, and what GitHub has said since. */
export interface TabKey {
  readonly openedAs: PullLink;
  /**
   * The repository's owner and name as GitHub names it now, once GitHub has answered. It differs
   * from the link's after a rename or a transfer.
   */
  readonly canonical?: Repository | undefined;
  /**
   * The other names it was opened by, from tabs that turned out to show the same pull request and
   * were merged into this one.
   */
  readonly aliases: readonly Repository[];
  /**
   * The layers of the stack the tab shows the pull request in, by number, while it shows one. A
   * link to any of them, by any of the repository's names, finds the tab ({@link hasLayer}).
   */
  readonly layers: readonly number[];
}

/** The key of a tab opened from `openedAs`, before GitHub has said anything. */
export function tabKey(openedAs: PullLink): TabKey {
  return { openedAs, aliases: [], layers: [] };
}

/** Whether `link` points at the tab's pull request, by any name it's known by. */
export function shows(key: TabKey, link: PullLink): boolean {
  return key.openedAs.number === link.number && knowsName(key, link);
}

/** Whether `link` points at a layer of the stack the tab shows, by any name it's known by. */
export function hasLayer(key: TabKey, link: PullLink): boolean {
  return key.layers.includes(link.number) && knowsName(key, link);
}

/** Whether `a` and `b` show the same pull request, as GitHub named both. */
export function isSamePullRequest(a: TabKey, b: TabKey): boolean {
  if (!a.canonical || !b.canonical) return false;
  return a.openedAs.number === b.openedAs.number && sameName(a.canonical, b.canonical);
}

/** `key` with the names `other`, a tab for the same pull request, was known by. */
export function merge(key: TabKey, other: TabKey): TabKey {
  const aliases = [...key.aliases];
  for (const name of names(other)) {
    if (!names({ ...key, aliases }).some((known) => sameName(known, name))) aliases.push(name);
  }
  return { ...key, aliases };
}

/**
 * The names the pull request was opened by that aren't its repository's name now, once GitHub
 * has given that.
 */
export function otherNames(key: TabKey): Repository[] {
  const { canonical } = key;
  if (!canonical) return [];
  const others: Repository[] = [];
  for (const name of names(key)) {
    if (sameName(name, canonical) || others.some((known) => sameName(known, name))) continue;
    others.push({ owner: name.owner, repo: name.repo });
  }
  return others;
}

/** The index of the first of `keys` that shows `link`'s pull request. */
export function findTab(keys: readonly TabKey[], link: PullLink): number | undefined {
  const index = keys.findIndex((key) => shows(key, link));
  return index < 0 ? undefined : index;
}

/** The index of the first of `keys` whose stack holds `link`'s pull request as a layer. */
export function findLayer(keys: readonly TabKey[], link: PullLink): number | undefined {
  const index = keys.findIndex((key) => hasLayer(key, link));
  return index < 0 ? undefined : index;
}

/** Every name the pull request's repository is known by: the link's, GitHub's, and the aliases. */
function names(key: TabKey): Repository[] {
  return [key.openedAs, ...(key.canonical ? [key.canonical] : []), ...key.aliases];
}

/** Whether the tab's repository is known by `name`. */
function knowsName(key: TabKey, name: Repository): boolean {
  return names(key).some((known) => sameName(known, name));
}

/** GitHub's owner and repository names ignore case. They're ASCII, as links are read. */
function sameName(a: Repository, b: Repository): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}
