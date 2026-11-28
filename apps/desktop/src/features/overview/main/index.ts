// The overview feature in main: for each pull request's tab, its overview and its repository's
// definitions, read from GitHub's REST API as the tab's account and sent to the window each time
// they change, with their files on request. What's read is kept in the database, which clearing
// the cache empties. While Settings turns overviews off, and until Lo has read the settings file,
// nothing is read.

import { isOnScreen, RepoRef, type GithubClient, type ReadPriorityNow } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { watchPresence } from '../../../main/screen.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { clearing, settings } from '../../settings/service.ts';
import type { Acting } from '../../tab/contract.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { overviews } from '../service.ts';
import { auto, collapsed, on as overviewsOn } from '../settings.ts';
import { Blobs } from './blobs.ts';
import { codeReply, readKey } from './code.ts';
import { LayerReads } from './layers.ts';
import { SavedRefs } from './saved.ts';
import { installSkill, skillState } from './skill.ts';
import { Overviews } from './switch.ts';
import { KeptStores, Stores, TabStore } from './terms.ts';
import { OverviewTab } from './watch.ts';

const followed = new Map<string, OverviewTab>();
/** The overview of the stack each tab follows, beside its own, while the window asks for one. */
const stacks = new Map<string, OverviewTab>();
/** Each followed tab's repository's definitions. */
const definitions = new Map<string, TabStore>();
const stops: (() => void)[] = [];
/** Whether overviews are on, as the settings file says: off until Lo has read it. */
const switched = new Overviews();
/**
 * Whether Lo's window is on screen, in front or behind another window, which reads the ref on
 * screen more often.
 */
let foreground = false;
let kept: Kept | undefined;

/** What's kept of overviews and definitions. */
interface Kept {
  blobs: Blobs;
  saved: SavedRefs;
  /** Stacks' overviews. */
  stacked: SavedRefs;
  stores: Stores;
  /** What stacks' layers' overviews and descriptions were read. */
  layers: LayerReads;
}

const log = (line: string) => console.error(`overview: ${line}`);

function tabOf(id: string): OverviewTab {
  const tab = followed.get(id);
  if (!tab) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
  return tab;
}

function definitionsOf(id: string): TabStore {
  const store = definitions.get(id);
  if (!store) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
  return store;
}

/** Runs `request` as `acting`, in its account's queue as `priority` says, or as nobody. */
async function readAs<T>(
  context: FeatureContext<typeof contract>,
  acting: Acting,
  request: (client: GithubClient) => Promise<T>,
  priority?: ReadPriorityNow,
): Promise<T> {
  const access = context.use(github);
  if (acting.kind === 'anonymous') return request(access.anonymous);
  const client = await access.client(acting.login);
  const poller = await access.poller(acting.login);
  return poller.queue.read(() => request(client), undefined, priority);
}

/** Lo came back on screen, or went off it. */
function setForeground(front: boolean): void {
  foreground = front;
  for (const tab of [...followed.values(), ...stacks.values()]) tab.setForeground(front);
}

/** Tab `id`'s overview, its stack's with `stack`. */
function subjectOf(id: string, stack: boolean | undefined): OverviewTab {
  if (!stack) return tabOf(id);
  const tab = stacks.get(id);
  if (!tab) throw new IpcError('missing', 'That tab follows no stack’s overview.');
  return tab;
}

/** What's kept, from the database the first time anything asks for it. */
function keptIn(context: FeatureContext<typeof contract>): Kept {
  const blobs = kept?.blobs ?? new Blobs(context.database, { log });
  kept ??= {
    blobs,
    saved: new SavedRefs(context.database, { log }),
    stacked: new SavedRefs(context.database, { log, of: 'stack' }),
    stores: new Stores({
      github: (acting, request, priority) => readAs(context, acting, request, priority),
      kept: new KeptStores(context.database, { log }),
      log,
    }),
    layers: new LayerReads({
      blobs,
      github: (acting, request, priority) => readAs(context, acting, request, priority),
      log,
      onScreen: () => foreground,
    }),
  };
  return kept;
}

/** Stops following tab `id`'s overview, its stack's and its definitions. */
function unfollow(id: string): void {
  followed.get(id)?.close();
  followed.delete(id);
  stopStack(id);
  definitions.get(id)?.close();
  definitions.delete(id);
}

function stopStack(id: string): void {
  stacks.get(id)?.close();
  stacks.delete(id);
}

/**
 * Follows the overview of stack `stack` beside tab `id`'s own, as the window asks, or stops with
 * none. Read as the tab's is, on its cadence, and kept by the stack's id.
 */
function followStack(
  context: FeatureContext<typeof contract>,
  id: string,
  stack: number | null,
): void {
  const service = context.use(tabs);
  const info = service.pull(id);
  const now = stacks.get(id);
  if (stack === null || !followed.has(id) || !info) {
    stopStack(id);
    return;
  }
  if (now?.subject.kind === 'stack' && now.subject.id === stack) return;
  stopStack(id);
  const { blobs, stacked } = keptIn(context);
  const tab = new OverviewTab({
    id,
    subject: { kind: 'stack', id: stack },
    reads: {
      blobs,
      saved: stacked,
      github: (acting, request, priority) => readAs(context, acting, request, priority),
    },
    publish: (state) => context.publish('stackState', state),
    log: (line) => log(`${info.repository.owner}/${info.repository.name} stack ${stack}: ${line}`),
  });
  stacks.set(id, tab);
  tab.update(info, service.list().active === id, foreground);
}

/**
 * Follows pull request `id`'s tab: its overview made the first time, closed as the tab closes. A
 * view of a run of a stack's layers has none, and no markers: each layer's overview describes that
 * layer alone.
 */
function follow(context: FeatureContext<typeof contract>, id: string): void {
  const service = context.use(tabs);
  const info = service.pull(id);
  if (!switched.on() || !info || info.run) {
    unfollow(id);
    return;
  }
  let store = definitions.get(id);
  if (!store) {
    store = new TabStore({
      id,
      stores: keptIn(context).stores,
      publish: (state) => context.publish('store', state),
    });
    definitions.set(id, store);
  }
  // A fork's pull request reads its base repository's.
  store.update(info.acting, new RepoRef(info.repository.owner, info.repository.name));
  let tab = followed.get(id);
  if (!tab) {
    const { blobs, saved } = keptIn(context);
    const reading = store;
    tab = new OverviewTab({
      id,
      reads: {
        blobs,
        saved,
        github: (acting, request, priority) => readAs(context, acting, request, priority),
      },
      publish: (state) => context.publish('state', state),
      onRead: (priority, shown) => reading.read(priority, shown),
      onFailed: (problem) => reading.failed(problem),
      log: (line) =>
        log(`${info.repository.owner}/${info.repository.name}#${info.number}: ${line}`),
    });
    followed.set(id, tab);
  }
  const onScreen = service.list().active === id;
  tab.update(info, onScreen, foreground);
  stacks.get(id)?.update(info, onScreen, foreground);
}

/** Turns overviews on or off, as the settings file says, through every tab. */
function turn(context: FeatureContext<typeof contract>, now: boolean): void {
  switched.turn(now, {
    followed: () => followed.keys(),
    open: () =>
      context
        .use(tabs)
        .list()
        .tabs.flatMap((tab) => (tab.kind === 'pull' ? [tab.id] : [])),
    follow: (id) => follow(context, id),
  });
}

export default defineFeature(contract, {
  uses: [tabs, github, clearing, settings],
  provide: () => [
    provides(overviews, {
      on: () => switched.on(),
      onChange: (listener) => switched.onChange(listener),
    }),
  ],
  handlers: {
    current: ({ id }) => followed.get(id)?.state(),
    files({ id, commit, paths }) {
      // The pull request's own unless its stack's holds it.
      const stack = stacks.get(id);
      return (stack?.holds(commit) ? stack : tabOf(id)).files(commit, paths);
    },
    code({ id, stack, commit, files }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
      return subjectOf(id, stack).readCode(readKey(info.local, commit, files), (signal) =>
        codeReply(info.local, () => service.clone(id), commit, files, { signal, log }),
      );
    },
    texts({ id, stack, from, commit, path, base }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
      return subjectOf(id, stack).blocks.read(
        info.local,
        () => service.clone(id),
        commit,
        path,
        base,
        stack ? from : undefined,
      );
    },
    since({ id, commit, head }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
      return tabOf(id).since.count(info.local, () => service.clone(id), commit, head);
    },
    sinceFile({ id, commit, head, path }, context) {
      const service = context.use(tabs);
      const info = service.pull(id);
      if (!info) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
      return tabOf(id).since.file(info.local, () => service.clone(id), commit, head, path);
    },
    retry({ id, stack }) {
      return subjectOf(id, stack).retry();
    },
    load({ id, stack }) {
      subjectOf(id, stack).load();
    },
    followStack({ id, stack }, context) {
      followStack(context, id, stack);
    },
    currentStack: ({ id }) => stacks.get(id)?.state(),
    layerOverviews({ id, layers }, context) {
      const info = context.use(tabs).pull(id);
      if (!info || !followed.has(id)) {
        throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
      }
      // Until the tab knows who it reads as, nothing is read.
      if (!info.acting) return layers.map(() => ({ kind: 'unread' as const }));
      const repo = new RepoRef(info.repository.owner, info.repository.name);
      return keptIn(context).layers.overviews(info.acting, repo, layers);
    },
    layerLines({ id, layers }, context) {
      const info = context.use(tabs).pull(id);
      if (!info || !followed.has(id)) {
        throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
      }
      if (!info.acting) return layers.map(() => null);
      const repo = new RepoRef(info.repository.owner, info.repository.name);
      return keptIn(context).layers.lines(info.acting, repo, layers);
    },
    currentStore: ({ id }) => definitions.get(id)?.state(),
    storeFile: ({ id, file }) => definitionsOf(id).file(file),
    retryStore({ id }) {
      return definitionsOf(id).retry();
    },
    currentSkill: () => skillState(process.env),
    installSkill({ agents }, { publish }) {
      const results = installSkill(agents, process.env);
      publish('skill', skillState(process.env));
      return results;
    },
  },
  start(context) {
    const service = context.use(tabs);
    const { blobs, saved, stacked, stores, layers } = keptIn(context);
    stops.push(
      watchPresence((presence) => setForeground(isOnScreen(presence))),
      service.onPull((id) => follow(context, id)),
      service.onTabs(() => {
        for (const id of followed.keys()) follow(context, id);
      }),
      // The reader's refresh of a pull request's tab reads its overview again too, as Try again
      // does, ahead of GitHub's `x-poll-interval`: the reader asked.
      service.onRefresh((id) => followed.get(id)?.retry(), ['overview']),
      // What was read from GitHub goes with the rest of the cache.
      context.use(clearing).onClear(() => {
        blobs.clear();
        saved.clear();
        stacked.clear();
        stores.clear();
        layers.clear();
      }),
      // Once the file's read: each tab's overview, if they're on.
      context.use(settings).watch(overviewsOn, (value) => turn(context, value)),
    );
    // The window shows and changes them: main reads neither. The overview skill's hook reads
    // `overview.auto` from the file itself.
    context.use(settings).declare(auto);
    context.use(settings).declare(collapsed);
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    for (const id of [...followed.keys(), ...definitions.keys()]) unfollow(id);
    switched.reset();
  },
});
