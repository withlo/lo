// The overview feature in main: for each pull request's tab, its overview, read from GitHub's REST
// API as the tab's account and sent to the window each time it changes, with its files on request.
// What's read is kept in the database, which clearing the cache empties.

import type { GithubClient, ReadPriority } from '@lo/github';
import { app } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { clearing, settings } from '../../settings/service.ts';
import type { Acting } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { open } from '../settings.ts';
import { Blobs } from './blobs.ts';
import { codeReply, readKey } from './code.ts';
import { SavedRefs } from './saved.ts';
import { installSkill, skillState } from './skill.ts';
import { OverviewTab } from './watch.ts';

const followed = new Map<string, OverviewTab>();
const stops: (() => void)[] = [];
/** Whether Lo's window is in front, which reads the ref on screen more often. */
let foreground = false;
let kept: { blobs: Blobs; saved: SavedRefs } | undefined;

const log = (line: string) => console.error(`overview: ${line}`);

function tabOf(id: string): OverviewTab {
  const tab = followed.get(id);
  if (!tab) throw new IpcError('missing', "There's no pull request's tab with that id.");
  return tab;
}

/** Lo came to the front, or went behind another window. */
function setForeground(front: boolean): void {
  foreground = front;
  for (const tab of followed.values()) tab.setForeground(front);
}

const focused = () => setForeground(true);
const blurred = () => setForeground(false);

/** What's kept, from the database the first time anything asks for it. */
function keptIn(context: FeatureContext<typeof contract>): { blobs: Blobs; saved: SavedRefs } {
  kept ??= {
    blobs: new Blobs(context.database, { log }),
    saved: new SavedRefs(context.database, { log }),
  };
  return kept;
}

/** Follows pull request `id`'s tab: its overview made the first time, closed as the tab closes. */
function follow(context: FeatureContext<typeof contract>, id: string): void {
  const service = context.use(tabs);
  const info = service.pull(id);
  if (!info) {
    followed.get(id)?.close();
    followed.delete(id);
    return;
  }
  let tab = followed.get(id);
  if (!tab) {
    const access = context.use(github);
    tab = new OverviewTab({
      id,
      reads: {
        ...keptIn(context),
        async github<T>(
          acting: Acting,
          request: (client: GithubClient) => Promise<T>,
          priority?: ReadPriority,
        ) {
          if (acting.kind === 'anonymous') return request(access.anonymous);
          const client = await access.client(acting.login);
          const poller = await access.poller(acting.login);
          return poller.queue.read(() => request(client), undefined, priority);
        },
      },
      publish: (state) => context.publish('state', state),
      log: (line) =>
        log(`${info.repository.owner}/${info.repository.name}#${info.number}: ${line}`),
    });
    followed.set(id, tab);
  }
  tab.update(info, service.list().active === id, foreground);
}

export default defineFeature(contract, {
  uses: [tabs, github, clearing, settings],
  handlers: {
    current: ({ id }) => followed.get(id)?.state(),
    files: ({ id, commit, paths }) => tabOf(id).files(commit, paths),
    code({ id, commit, files }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
      return tabOf(id).readCode(readKey(info.local, commit, files), (signal) =>
        codeReply(info.local, () => service.clone(id), commit, files, { signal, log }),
      );
    },
    texts({ id, commit, path, base }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
      return tabOf(id).blocks.read(info.local, () => service.clone(id), commit, path, base);
    },
    since({ id, commit, head }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
      return tabOf(id).since.count(info.local, () => service.clone(id), commit, head);
    },
    sinceFile({ id, commit, head, path }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
      return tabOf(id).since.file(info.local, () => service.clone(id), commit, head, path);
    },
    retry({ id }) {
      tabOf(id).retry();
    },
    load({ id }) {
      tabOf(id).load();
    },
    currentSkill: () => skillState(process.env),
    installSkill({ agents }, { publish }) {
      const results = installSkill(agents, process.env);
      publish('skill', skillState(process.env));
      return results;
    },
  },
  start(context) {
    // The window reads it as a pull request's tab opens, and changes it from Settings.
    context.use(settings).declare(open);
    const service = context.use(tabs);
    const { blobs, saved } = keptIn(context);
    app.on('browser-window-focus', focused);
    app.on('browser-window-blur', blurred);
    stops.push(
      () => app.off('browser-window-focus', focused),
      () => app.off('browser-window-blur', blurred),
      service.onPull((id) => follow(context, id)),
      service.onTabs(() => {
        for (const id of followed.keys()) follow(context, id);
      }),
      // What was read from GitHub goes with the rest of the cache.
      context.use(clearing).onClear(() => {
        blobs.clear();
        saved.clear();
      }),
    );
    for (const tab of service.list().tabs) if (tab.kind === 'pull') follow(context, tab.id);
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    for (const tab of followed.values()) tab.close();
    followed.clear();
  },
});
