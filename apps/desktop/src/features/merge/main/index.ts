// The merge feature in main: each view's merge status, read for the view on screen through its
// account's poller and sent to the window as it changes (`./reads.ts`), mapped with the method
// remembered for the repository (`./methods.ts`); what the merge panel reads as it opens, the
// squash commit's text GitHub would start with; the pages its reasons link, opened in the
// system's browser; merging (`./merging.ts`), through the app's one `MergeJobs`, in each pull
// request's turn among merge writes (`./turns.ts`), which other features take through
// `merge.writes`; and, for a pull request in a merge queue, its place there and why it left
// (`./queued.ts`).

import { GithubError, MergeJobs, squashText } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { openPage } from '../../../main/browser.ts';
import { defineFeature } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { comparisons } from '../../revisions/service.ts';
import { forest } from '../../stacks/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { writes } from '../service.ts';
import { holdsIn } from './holds.ts';
import { Merging } from './merging.ts';
import { MethodStore } from './methods.ts';
import { QueueReads } from './queued.ts';
import { MergeReads } from './reads.ts';
import { MergeTurns } from './turns.ts';

const log = (line: string) => console.error(`merge: ${line}`);

let reads: MergeReads | undefined;
let queues: QueueReads | undefined;
let merging: Merging | undefined;
let jobs: MergeJobs | undefined;
/** The turns of merge writes to pull requests, which other features take too. */
const turns = new MergeTurns();
const stops: (() => void)[] = [];

/** What `start` made, for a handler: the window asks nothing before main has started. */
function started(): MergeReads {
  if (reads === undefined) throw new IpcError('stopped', 'Lo is quitting.');
  return reads;
}

/** The merge queues' reads, once `start` made them. */
function inQueues(): QueueReads {
  if (queues === undefined) throw new IpcError('stopped', 'Lo is quitting.');
  return queues;
}

/** Merging, once `start` made it. */
function merges(): Merging {
  if (merging === undefined) throw new IpcError('stopped', 'Lo is quitting.');
  return merging;
}

export default defineFeature(contract, {
  uses: [github, tabs, comparisons, forest],
  provide: () => [provides(writes, turns)],
  handlers: {
    state: ({ id }) => started().current(id),
    async panel({ id }) {
      const reader = started().reader(id);
      if (!reader) {
        throw new IpcError('unavailable', 'Lo hasn’t read whether this pull request can merge.');
      }
      try {
        const read = await reader.poller.readOnce((client) => squashText(client, reader.pull));
        return { title: read.title, message: read.message, head: reader.head };
      } catch (error) {
        const why = error instanceof GithubError ? error.message : String(error);
        throw new IpcError(
          'unavailable',
          `GitHub didn’t say how it would start the commit: ${why}`,
        );
      }
    },
    async open({ id, url }) {
      // Only an `https://` page this view's status links: a check's run, or the pull request.
      const linked = started().links(id, url) || inQueues().links(id, url);
      if (URL.parse(url)?.protocol !== 'https:' || !linked) {
        throw new IpcError('refused', 'Lo opens only the pages the merge status links.');
      }
      await openPage(url);
    },
    queue: ({ id }) => inQueues().current(id),
    ahead: ({ id }) => inQueues().ahead(id),
    forgetLeft({ id }) {
      queues?.forgetLeft(id);
    },
    plan: ({ id, method, title, message, asked }) =>
      merges().plan(id, { method, title, message, asked }),
    confirm: ({ key, typed }) => merges().confirm(key, typed),
    autoMergeOff: ({ id }) => merges().autoMergeOff(id),
    cancel({ key }) {
      merging?.cancel(key);
    },
    sent: () => merging?.list() ?? [],
    askAgain({ key }) {
      merges().askAgain(key);
    },
    dismiss({ key }) {
      merging?.dismiss(key);
    },
  },
  start({ use, publish, database }) {
    const service = use(tabs);
    const methods = new MethodStore(database);
    // The newer side of what a view compares, or the head it shows.
    const headOnScreen = (id: string) => {
      const on = use(comparisons).onScreen(id);
      return on.kind === 'revisions' ? on.comparing.new.head : service.pull(id)?.shown;
    };
    const inQueue = new QueueReads({
      poller: (login) => use(github).poller(login),
      view: (id) => service.pull(id),
      onScreen: () => service.list().active,
      publish: (queued) => publish('queued', queued),
      log,
    });
    queues = inQueue;
    const followed = new MergeReads({
      poller: (login) => use(github).poller(login),
      view: (id) => service.pull(id),
      onScreen: () => service.list().active,
      headOnScreen,
      method: (repo) => methods.get(repo),
      async holds(id, tip, head) {
        const clone = service.clone(id);
        return clone === undefined ? undefined : holdsIn(await clone, tip, head);
      },
      publish(status) {
        publish('status', status);
        inQueue.heard(status);
      },
      log,
    });
    reads = followed;
    const following = new MergeJobs();
    jobs = following;
    const stacks = use(forest);
    merging = new Merging({
      poller: (login) => use(github).poller(login),
      view: (id) => service.pull(id),
      headOnScreen,
      headContainsBase: (id) => followed.headContainsBase(id),
      method: (repo) => methods.get(repo),
      remember: (repo, method) => methods.set(repo, method, Date.now()),
      forest: (repo, login) => stacks.forest(repo, login),
      converting: (repo) => stacks.converting(repo),
      turns,
      jobs: following,
      publish: (job) => publish('jobs', job),
      log,
    });
    stops.push(
      // A conversion to a GitHub stack doesn't change the base branches of what Lo is merging.
      stacks.holdConversions((repo, prs) => turns.busy(repo, prs)),
      service.onPull((id) => {
        followed.follow(id);
        inQueue.follow(id);
      }),
      // The view shown reads its status, the first time it's on screen.
      service.onTabs(({ active }) => {
        if (active !== undefined) followed.shown(active);
        inQueue.shown(active);
      }),
      use(comparisons).onChange((id) => followed.follow(id)),
    );
    for (const tab of service.list().tabs) {
      if (tab.kind === 'pull') followed.follow(tab.id);
    }
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    merging?.stop();
    merging = undefined;
    jobs?.stop();
    jobs = undefined;
    reads?.stop();
    reads = undefined;
    queues?.stop();
    queues = undefined;
  },
});
