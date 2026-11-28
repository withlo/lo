// The merge queue feature in main: it opens a repository's merge queues in a tab of their own, as
// the account a pull request's tab acts as, and reads the queue of the branch each such tab shows
// while that tab is on screen, and why each entry it saw leave left, telling the window what it
// read. And it changes the queue as the reader confirms (`./acts.ts`), each change in its pull
// requests' turns among merge writes, which the merge feature hands out.

import { PullRef, queueRemoval, queueView, queueWaiting, RepoRef, type Poller } from '@lo/github';
import { app } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { pollEvery } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { github, type GithubAccess } from '../../accounts/service.ts';
import { writes } from '../../merge/service.ts';
import { forest, type ForestService } from '../../stacks/service.ts';
import type { QueueTab } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { QueueActs } from './acts.ts';
import { Queues, type TabSource } from './queues.ts';

let queues: Queues | undefined;
let acts: QueueActs | undefined;
/** Stops the merge queues' tabs reading again as the reader asks. */
let stopRefresh: (() => void) | undefined;

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
    removal: async (number, signal) =>
      (await poller()).readOnce(
        (client) => queueRemoval(client, new PullRef(tab.owner, tab.repo, number)),
        signal,
      ),
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

/** Changing the queues, once the feature has started. */
function acting(): QueueActs {
  if (!acts) throw new IpcError('stopped', 'Lo is quitting.');
  return acts;
}

export default defineFeature(contract, {
  uses: [github, tabs, forest, writes],
  handlers: {
    show: ({ id, branch }) => started().show(id, branch),
    state: ({ id }) => queues?.state(id),
    open: ({ id, number }) => started().open(id, number),
    plan: ({ id, number, kind }) => acting().plan(id, number, kind),
    confirm: ({ key }) => acting().confirm(key),
    cancel({ key }) {
      acts?.cancel(key);
    },
    autoMergeOff: ({ id, number }) => acting().autoMergeOff(id, number),
    look: ({ id }) => started().look(id),
  },
  start(context) {
    const access = context.use(github);
    const stacks = context.use(forest);
    const shown = new Queues({
      tabs: context.use(tabs),
      github: access,
      sourceFor: (tab) => sourceFor(access, stacks, tab),
      publish: (state) => context.publish('queue', state),
      heard(id, read) {
        if (read.kind === 'queue') acts?.heard(id, read.view);
      },
      moved: (id) => acts?.drop(id),
      every: pollEvery({ packaged: app.isPackaged, env: process.env }),
    });
    queues = shown;
    // The reader's refresh of a merge queue's tab reads it as "Check again" does, which says why a
    // read failed on the tab itself.
    stopRefresh = context
      .use(tabs)
      .onRefresh((id) => (shown.found(id) ? shown.look(id) : undefined));
    acts = new QueueActs({
      tab: (id) => shown.found(id),
      poller: (login) => access.poller(login),
      writes: context.use(writes),
      converting: (repo) => stacks.converting(repo),
      readBranch: async (on, branch, kind) => {
        const repo = new RepoRef(on.owner, on.repo);
        const poller = await access.poller(on.login);
        await (kind === 'queue'
          ? poller.readOnce((client) => queueView(client, repo, branch))
          : poller.readOnce((client) => queueWaiting(client, repo, branch)));
      },
      log: (line) => console.error(`queue: ${line}`),
      sent: (key) => context.publish('sent', { key }),
    });
    shown.start();
  },
  stop() {
    stopRefresh?.();
    stopRefresh = undefined;
    acts?.stop();
    acts = undefined;
    queues?.stop();
    queues = undefined;
  },
});
