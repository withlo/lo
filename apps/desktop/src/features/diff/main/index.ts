// The diff feature in main: for each pull request's tab, each changed file's versions at the head
// on screen, sent to the window each time they change, their texts on request, and any file whole
// for the whole-file view. The window says once it has drawn the diff, and the tab keeps that head
// on screen.

import type { GithubClient } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { settings } from '../../settings/service.ts';
import type { Acting } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { layout, whitespace } from '../settings.ts';
import { DiffTab } from './diff.ts';

const diffs = new Map<string, DiffTab>();
let unfollow: (() => void) | undefined;

const log = (line: string) => console.error(`diff: ${line}`);

function diffOf(id: string): DiffTab {
  const diff = diffs.get(id);
  if (!diff) throw new IpcError('missing', "There's no pull request's tab with that id.");
  return diff;
}

/** Follows pull request `id`'s tab: its diff made the first time, closed as the tab closes. */
function follow(context: FeatureContext<typeof contract>, id: string): void {
  const service = context.use(tabs);
  const info = service.pull(id);
  if (!info) {
    diffs.get(id)?.close();
    diffs.delete(id);
    return;
  }
  let diff = diffs.get(id);
  if (!diff) {
    const access = context.use(github);
    diff = new DiffTab({
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
      drawn: (head) => service.drawn(id, head),
      log: (line) =>
        log(`${info.repository.owner}/${info.repository.name}#${info.number}: ${line}`),
    });
    diffs.set(id, diff);
  }
  diff.update(info);
}

export default defineFeature(contract, {
  uses: [tabs, github, settings],
  handlers: {
    versions: ({ id }) => diffs.get(id)?.state(),
    texts: ({ id, at, from, files }) => diffOf(id).texts(at, from, files),
    whole: ({ id, at, version, path, large }) => diffOf(id).whole(at, version, path, large),
    drawn({ id, at }) {
      diffOf(id).drawn(at);
    },
  },
  start(context) {
    const store = context.use(settings);
    store.declare(layout);
    store.declare(whitespace);
    const service = context.use(tabs);
    unfollow = service.onPull((id) => follow(context, id));
    for (const tab of service.list().tabs) if (tab.kind === 'pull') follow(context, tab.id);
  },
  stop() {
    unfollow?.();
    for (const diff of diffs.values()) diff.close();
    diffs.clear();
  },
});
