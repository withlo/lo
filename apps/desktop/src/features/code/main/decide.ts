// Whether language servers may run on a view of a pull request's tab: the decision, as plain
// functions tested alone. Each view decides for itself, a stack's layers each by their own pull
// request, and a run of layers by its top one, which is the pull request its view is of.
//
// Names come first: only once an entry names the view's repository, or its pull request, does
// main read the repositories' node IDs from GitHub, so a repository nobody trusted reads nothing
// it didn't read before. Then the IDs decide, since a name can change hands: an entry for a
// repository trusts its pull requests whose head is in it, and an entry for a pull request trusts
// it alone, while its head stays in the fork it named.

import type { PullRequestRepositories } from '@lo/github';

import type { Head, Trust } from '../contract.ts';
import { sameName, type TrustEntry } from '../settings.ts';

/** What the decision needs of a view. */
export interface DecidedView {
  /** Its repository, `owner/name`, by the name GitHub gives it now, as the tab has it. */
  readonly repo: string;
  readonly number: number;
  /** Whether Lo has no git it can run, once it has looked: nothing before. */
  readonly noGit: boolean | undefined;
  /** Whether its local copy is ready, which a checkout and its servers need. */
  readonly local: boolean;
  /**
   * Whether GitHub has said where its head is, and which fork it's in when it's one: `null` for
   * its own repository, or a fork GitHub no longer has.
   */
  readonly fork: string | null | undefined;
}

/** What Lo read of the repositories a view's pull request joins. */
export type Read =
  | { readonly kind: 'read'; readonly repositories: PullRequestRepositories }
  | { readonly kind: 'failed'; readonly message: string };

/** The decision, and the entry that trusts the view, when one does. */
export interface Decision {
  readonly trust: Trust;
  readonly by?: TrustEntry | undefined;
  /** Where the head is, as far as Lo knows. */
  readonly head: Head | null;
}

/** The entries that name `view`: its repository's, and its pull request's. */
export function naming(view: DecidedView, entries: readonly TrustEntry[]): TrustEntry[] {
  return entries.filter(
    (entry) =>
      sameName(entry.repo, view.repo) && (entry.kind === 'repo' || entry.pull === view.number),
  );
}

/** Whether `view` needs the repositories' IDs read, as {@link decide} would use them now. */
export function needsRead(view: DecidedView, entries: readonly TrustEntry[] | undefined): boolean {
  return (
    view.noGit === false &&
    view.fork !== undefined &&
    view.local &&
    entries !== undefined &&
    naming(view, entries).length > 0
  );
}

/** Where the head is, from the tab, or from what Lo read when it has. */
function headOf(view: DecidedView, read: Read | undefined): Head | null {
  if (read?.kind === 'read') {
    const { repositories } = read;
    if (!repositories.isCrossRepository) return { kind: 'base' };
    return repositories.head ? { kind: 'fork', repo: repositories.head.name } : { kind: 'gone' };
  }
  if (view.fork === undefined) return null;
  return view.fork === null ? { kind: 'base' } : { kind: 'fork', repo: view.fork };
}

/**
 * Whether language servers may run on `view`, given the entries Lo reads (`entries`, nothing
 * before the settings file has been read), and what Lo read of its pull request's repositories
 * (`read`), if it has: see the contract's `trust`.
 */
export function decide(
  view: DecidedView,
  entries: readonly TrustEntry[] | undefined,
  read: Read | undefined,
): Decision {
  const head = headOf(view, read);
  if (view.noGit) return { trust: { kind: 'noGit' }, head };
  // Not before Lo has looked for git, so a banner never comes and goes for want of it.
  if (view.noGit === undefined || view.fork === undefined || entries === undefined) {
    return { trust: { kind: 'checking' }, head };
  }
  const named = naming(view, entries);
  if (named.length === 0) return { trust: { kind: 'untrusted', why: 'unnamed' }, head };
  if (!view.local) return { trust: { kind: 'waiting' }, head };
  if (read === undefined) return { trust: { kind: 'checking' }, head };
  if (read.kind === 'failed') {
    return { trust: { kind: 'untrusted', why: 'unread', message: read.message }, head };
  }
  const { base, head: from, isCrossRepository } = read.repositories;
  const byRepo = named.find(
    (entry) => entry.kind === 'repo' && entry.id === base.id && !isCrossRepository,
  );
  if (byRepo) return { trust: { kind: 'trusted', by: 'repo' }, by: byRepo, head };
  const byPull = named.find(
    (entry) =>
      entry.kind === 'pull' &&
      entry.id === base.id &&
      entry.pull === view.number &&
      from !== undefined &&
      entry.fromId === from.id,
  );
  if (byPull) return { trust: { kind: 'trusted', by: 'pull' }, by: byPull, head };
  return { trust: { kind: 'untrusted', why: 'other' }, head };
}
