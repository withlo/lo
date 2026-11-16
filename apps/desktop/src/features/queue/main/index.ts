// The merge queue feature in main: it opens a repository's merge queues in a tab of their own, as
// the account a pull request's tab acts as, and reads the queue of the branch each such tab shows
// while that tab is on screen, telling the window what it read.

import { queueView, queueWaiting, RepoRef, type Poller } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature } from '../../../main/features.ts';
import { github, type GithubAccess } from '../../accounts/service.ts';
import { forest, type ForestService } from '../../stacks/service.ts';
import type { QueueTab } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { Queues, type TabSource } from './queues.ts';

let queues: Queues | undefined;

/**
 * Where `tab` reads from: GitHub, as its account, in that account's poller's queue, and the stacks
 * the stacks feature found in its repository.
 */
function sourceFor(access: GithubAccess, stacks: ForestService, tab: QueueTab): TabSource {
  const repo = new RepoRef(tab.owner, tab.repo);
  let known: Poller | undefined;
  const poller = async () => {
    known = await access.poller(tab.login);
    return known;
  };
  return {
    view: async (branch, signal) =>
      (await poller()).readOnce((client) => queueView(client, repo, branch), signal),
    waiting: async (branch, signal) =>
      (await poller()).readOnce((client) => queueWaiting(client, repo, branch), signal),
    repository: () => ({
      list: known?.openPullRequests(repo)?.value,
      rules: known?.trunkRules(repo)?.value,
      stacks: stacks.forest(repo, tab.login)?.stacks,
    }),
    forget: () => {
      known = undefined;
    },
  };
}

/** The merge queues, once the feature has started. */
function started(): Queues {
  if (!queues) throw new IpcError('unavailable', 'Lo is still starting.');
  return queues;
}

export default defineFeature(contract, {
  uses: [github, tabs, forest],
  handlers: {
    show: ({ id, branch }) => started().show(id, branch),
    state: ({ id }) => queues?.state(id),
    open: ({ id, number }) => started().open(id, number),
  },
  start(context) {
    const access = context.use(github);
    const stacks = context.use(forest);
    queues = new Queues({
      tabs: context.use(tabs),
      github: access,
      sourceFor: (tab) => sourceFor(access, stacks, tab),
      publish: (state) => context.publish('queue', state),
    });
    queues.start();
  },
  stop() {
    queues?.stop();
    queues = undefined;
  },
});
