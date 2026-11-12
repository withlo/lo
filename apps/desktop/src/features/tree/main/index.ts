// The tree feature in main: for each pull request's tab, the repository's files at the head on
// screen and the files the pull request changes, sent to the window each time they change, with a
// folder's files and a search by name on request.

import type { GithubClient } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { comparisons } from '../../revisions/service.ts';
import type { Acting } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { TreeTab } from './tree.ts';

const trees = new Map<string, TreeTab>();
const unfollow: (() => void)[] = [];

const log = (line: string) => console.error(`tree: ${line}`);

function treeOf(id: string): TreeTab {
  const tree = trees.get(id);
  if (!tree) throw new IpcError('missing', "There's no pull request's tab with that id.");
  return tree;
}

/** Follows pull request `id`'s tab: its tree made the first time, closed as the tab closes. */
function follow(context: FeatureContext<typeof contract>, id: string): void {
  const service = context.use(tabs);
  const info = service.pull(id);
  if (!info) {
    trees.get(id)?.close();
    trees.delete(id);
    return;
  }
  let tree = trees.get(id);
  if (!tree) {
    const access = context.use(github);
    tree = new TreeTab({
      id,
      reads: {
        clone: () => service.clone(id),
        async github<T>(acting: Acting, request: (client: GithubClient) => Promise<T>) {
          if (acting.kind === 'anonymous') return request(access.anonymous);
          const client = await access.client(acting.login);
          const poller = await access.poller(acting.login);
          return poller.queue.read(() => request(client));
        },
      },
      publish: (state) => context.publish('state', state),
      log: (line) =>
        log(`${info.repository.owner}/${info.repository.name}#${info.number}: ${line}`),
    });
    trees.set(id, tree);
  }
  tree.update(info, context.use(comparisons).onScreen(id));
}

export default defineFeature(contract, {
  uses: [tabs, github, comparisons],
  handlers: {
    current: ({ id }) => trees.get(id)?.state(),
    folder: ({ id, at, paths }) => treeOf(id).folders(at, paths),
    async find({ id, query }) {
      return { query, ...(await treeOf(id).find(query)) };
    },
  },
  start(context) {
    const service = context.use(tabs);
    unfollow.push(
      service.onPull((id) => follow(context, id)),
      context.use(comparisons).onChange((id) => follow(context, id)),
    );
    for (const tab of service.list().tabs) if (tab.kind === 'pull') follow(context, tab.id);
  },
  stop() {
    for (const stop of unfollow.splice(0)) stop();
    for (const tree of trees.values()) tree.close();
    trees.clear();
  },
});
