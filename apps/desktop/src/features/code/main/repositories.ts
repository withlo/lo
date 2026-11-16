// Reading from GitHub which repositories a view's pull request joins, as the view acts: in its
// account's queue, ahead of polls when someone waits on it, or without signing in for a public
// repository. Nothing here calls Electron, so it runs under unit tests.

import {
  PullRef,
  readPullRequestRepositories,
  type Poller,
  type PullRequestRepositories,
  type ReadPriority,
} from '@lo/github';

import type { GithubAccess } from '../../accounts/service.ts';
import type { PullTabInfo } from '../../tab/service.ts';

/** What the read needs: the views, and GitHub as Lo is signed in to it. */
export interface RepositoryReading {
  /** What main has of view `id`, or nothing once it's closed. */
  readonly pull: (id: string) => Pick<PullTabInfo, 'repository' | 'number' | 'acting'> | undefined;
  readonly anonymous: GithubAccess['anonymous'];
  readonly poller: (login: string) => Promise<Pick<Poller, 'readOnce'>>;
}

/**
 * The repositories view `id`'s pull request joins, read from GitHub as the view acts: in its
 * account's queue, ahead of waiting reads and polls when someone waits on it (`foreground`), and
 * never made once `signal` aborts while it waits there; or without signing in, for a public
 * repository.
 */
export async function readRepositories(
  reading: RepositoryReading,
  id: string,
  priority: ReadPriority,
  signal: AbortSignal | undefined,
): Promise<PullRequestRepositories> {
  const info = reading.pull(id);
  if (!info?.acting) throw new Error("The view is closed, or doesn't know who it acts as yet.");
  const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
  if (info.acting.kind === 'anonymous') return readPullRequestRepositories(reading.anonymous, pull);
  const poller = await reading.poller(info.acting.login);
  return poller.readOnce((client) => readPullRequestRepositories(client, pull), signal, priority);
}
