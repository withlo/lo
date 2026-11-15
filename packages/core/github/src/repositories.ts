/**
 * The repositories a pull request joins, by GitHub's node IDs (`PullRequestRepositories`): what a
 * repository or pull request someone trusts is checked against before its code runs. A name can
 * change hands, as when a deleted account's is registered again, and an ID can't.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { PullRequestRepositoriesDocument } from './generated/graphql.ts';
import { notFound } from './pager.ts';
import type { PullRef } from './refs.ts';

/** A repository, by GitHub's node ID, with its name. */
export interface RepositoryId {
  /** GitHub's node ID, such as `R_kgDOVleUfQ`, which stays with the repository through a rename. */
  id: string;
  /** Its `owner/name` now. */
  name: string;
}

/** The repositories a pull request joins. */
export interface PullRequestRepositories {
  /** The repository the pull request is in, which it merges into. */
  base: RepositoryId;
  /**
   * The repository its head comes from, or `undefined` when GitHub names none: the fork was
   * deleted, or the account can't see it.
   */
  head: RepositoryId | undefined;
  /**
   * Whether its head comes from another repository than its base: a fork, or one GitHub names
   * none for, which counts as a fork whatever GitHub says.
   */
  isCrossRepository: boolean;
}

/** The repositories `pull` joins. 1 point. */
export async function readPullRequestRepositories(
  client: GithubClient,
  pull: PullRef,
): Promise<PullRequestRepositories> {
  // An error about the head repository alone, such as a fork in an organization that restricts
  // OAuth apps, leaves it out and keeps the rest.
  const { data } = await client.graphqlWithErrors(
    PullRequestRepositoriesDocument,
    { owner: pull.repo.owner, name: pull.repo.name, number: pull.number },
    2,
  );
  const found = data.repository?.pullRequest;
  if (!found) throw notFound(`pull request ${pull.toString()}`);
  const { baseRepository: base, headRepository: head } = found;
  if (!base) {
    throw new GithubError({
      kind: 'decode',
      message: `GitHub named no base repository for ${pull.toString()}`,
    });
  }
  return {
    base: { id: base.id, name: base.nameWithOwner },
    head: head ? { id: head.id, name: head.nameWithOwner } : undefined,
    isCrossRepository: found.isCrossRepository || !head || head.id !== base.id,
  };
}
