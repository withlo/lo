// The merge feature in main: each view's merge status, read for the view on screen through its
// account's poller and sent to the window as it changes (`./reads.ts`), mapped with the method
// remembered for the repository (`./methods.ts`); what the merge panel reads as it opens, the
// squash commit's text GitHub would start with; and the pages its reasons link, opened in the
// system's browser.

import { parseOid } from '@lo/git';
import { GithubError, squashText } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { openPage } from '../../../main/browser.ts';
import { defineFeature } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { comparisons } from '../../revisions/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { MethodStore } from './methods.ts';
import { MergeReads } from './reads.ts';

const log = (line: string) => console.error(`merge: ${line}`);

let reads: MergeReads | undefined;
const stops: (() => void)[] = [];

/** What `start` made, for a handler: the window asks nothing before main has started. */
function started(): MergeReads {
  if (reads === undefined) throw new IpcError('stopped', 'Lo is quitting.');
  return reads;
}

export default defineFeature(contract, {
  uses: [github, tabs, comparisons],
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
      if (URL.parse(url)?.protocol !== 'https:' || !started().links(id, url)) {
        throw new IpcError('refused', 'Lo opens only the pages the merge status links.');
      }
      await openPage(url);
    },
  },
  start({ use, publish, database }) {
    const service = use(tabs);
    const methods = new MethodStore(database);
    const followed = new MergeReads({
      poller: (login) => use(github).poller(login),
      view: (id) => service.pull(id),
      onScreen: () => service.list().active,
      headOnScreen(id) {
        const on = use(comparisons).onScreen(id);
        return on.kind === 'revisions' ? on.comparing.new.head : service.pull(id)?.shown;
      },
      method: (repo) => methods.get(repo),
      async holds(id, tip, head) {
        const clone = service.clone(id);
        if (!clone) return undefined;
        const repo = await clone;
        const [base, ours] = [parseOid(tip), parseOid(head)];
        if (!(await repo.hasCommit(ours))) return undefined;
        await repo.fetchCommit(base);
        return repo.isAncestor(base, ours);
      },
      publish: (status) => publish('status', status),
      log,
    });
    reads = followed;
    stops.push(
      service.onPull((id) => followed.follow(id)),
      // The view shown reads its status, the first time it's on screen.
      service.onTabs(({ active }) => {
        if (active !== undefined) followed.follow(active);
      }),
      use(comparisons).onChange((id) => followed.follow(id)),
    );
    for (const tab of service.list().tabs) {
      if (tab.kind === 'pull') followed.follow(tab.id);
    }
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    reads?.stop();
    reads = undefined;
  },
});
