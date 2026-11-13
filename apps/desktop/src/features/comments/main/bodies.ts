// Posts' HTML for a view of a pull request's tab, read through its account's poller as the window
// asks. Nothing is kept here: the window holds what it was given, in its memory only.

import { GithubError, PullRef, type Poller, type RenderedBodies } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { BodiesOptions } from '../service.ts';

/** What reading posts needs: the views of pull requests' tabs, and each account's poller. */
export interface BodiesSources {
  pull(id: string): PullTabInfo | undefined;
  poller(login: string): Promise<Pick<Poller, 'renderedBodies'>>;
}

/** Reads posts' HTML for view `id`, as {@link BodiesService.read} says. */
export async function readBodies(
  sources: BodiesSources,
  id: string,
  posts: readonly string[],
  { description }: BodiesOptions,
): Promise<RenderedBodies> {
  const info = sources.pull(id);
  if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
  if (info.run) throw new IpcError('refused', 'A run of layers has no posts of its own.');
  const { acting } = info;
  if (acting?.kind === 'anonymous') throw new IpcError('refused', 'Sign in to see comments.');
  if (acting === undefined) {
    throw new IpcError('refused', 'The tab hasn’t worked out its account yet.');
  }
  const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
  try {
    const poller = await sources.poller(acting.login);
    return await poller.renderedBodies(pull, posts, { description });
  } catch (error) {
    if (error instanceof GithubError) {
      throw new IpcError('failed', `Lo couldn’t read the comments: ${error.message}`);
    }
    throw error;
  }
}
