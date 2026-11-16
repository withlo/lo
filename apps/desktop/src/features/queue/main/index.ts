// The merge queue feature in main: it opens a repository's merge queues in a tab of their own, as
// the account a pull request's tab acts as, and reads the queue of the branch each such tab shows
// while that tab is on screen, telling the window what it read.

import { queueView, queueWaiting, RepoRef, type Poller } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github, type GithubAccess } from '../../accounts/service.ts';
import { forest, type ForestService } from '../../stacks/service.ts';
import type { QueueTab, Tabs } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { QueueWatch, type QueueSource } from './watch.ts';

/** Each merge queue's tab, by its id, while it's open. */
const watches = new Map<string, QueueWatch>();
let stopFollowing: (() => void) | undefined;

/**
 * Where `tab` reads from: GitHub, as its account, in that account's poller's queue, and the stacks
 * the stacks feature found in its repository.
 */
function sourceFor(access: GithubAccess, stacks: ForestService, tab: QueueTab): QueueSource {
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
  };
}

/**
 * Keeps a watch for each merge queue's tab in `value`, at the branch it shows, reading only the one
 * on screen, and drops those of tabs that closed.
 */
function follow(context: FeatureContext<typeof contract>, value: Tabs): void {
  const open = new Set<string>();
  for (const tab of value.tabs) {
    if (tab.kind !== 'queue') continue;
    open.add(tab.id);
    const watch = watches.get(tab.id);
    if (watch) {
      watch.setBranch(tab.branch);
      continue;
    }
    watches.set(
      tab.id,
      new QueueWatch({
        id: tab.id,
        login: tab.login,
        branch: tab.branch,
        source: sourceFor(context.use(github), context.use(forest), tab),
        publish: (state) => context.publish('queue', state),
      }),
    );
  }
  for (const [id, watch] of watches) {
    if (!open.has(id)) {
      watch.stop();
      watches.delete(id);
    } else if (id === value.active) watch.show();
    else watch.hide();
  }
}

/** The merge queue's tab `id`, if it's open. */
function queueTab(context: FeatureContext<typeof contract>, id: string): QueueTab | undefined {
  const found = context
    .use(tabs)
    .list()
    .tabs.find((tab) => tab.id === id);
  return found?.kind === 'queue' ? found : undefined;
}

export default defineFeature(contract, {
  uses: [github, tabs, forest],
  handlers: {
    show({ id, branch }, context) {
      const service = context.use(tabs);
      const shown = queueTab(context, id);
      if (shown) {
        const { owner, repo, login } = shown;
        return service.open({ kind: 'queue', owner, repo, branch, login });
      }
      const pull = service.pull(id);
      if (!pull) throw new IpcError('missing', "There's no pull request's tab with that id.");
      const { acting, repository } = pull;
      if (acting === undefined) {
        throw new IpcError('unavailable', 'Lo is still working out which account this tab uses.');
      }
      if (acting.kind !== 'account') {
        throw new IpcError(
          'refused',
          'Lo reads a merge queue as a signed-in account. This tab reads without signing in.',
        );
      }
      return service.open({
        kind: 'queue',
        owner: repository.owner,
        repo: repository.name,
        branch,
        login: acting.login,
      });
    },
    state: ({ id }) => watches.get(id)?.state(),
    open({ id, number }, context) {
      const shown = queueTab(context, id);
      if (!shown) throw new IpcError('missing', "There's no merge queue's tab with that id.");
      const { owner, repo, login } = shown;
      return context.use(tabs).open({ kind: 'pull', owner, repo, number }, { login });
    },
  },
  start(context) {
    const service = context.use(tabs);
    stopFollowing = service.onTabs((value) => follow(context, value));
    follow(context, service.list());
  },
  stop() {
    stopFollowing?.();
    stopFollowing = undefined;
    for (const watch of watches.values()) watch.stop();
    watches.clear();
  },
});
