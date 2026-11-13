// The stacks feature in main: for each pull request's tab, the stack its pull request is in, found
// among its repository's open pull requests as its account's poller lists them, and sent to the
// window each time it changes, and where the layer on screen's diff starts: with the layer below
// it, set before the diff is drawn, or offered once it is. Only the tab on screen reads its layers'
// state.

import { PullRef } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { tabs, type TabService } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { StackFinder, type FinderTab } from './finder.ts';

let finder: StackFinder | undefined;
const stops: (() => void)[] = [];

const log = (line: string) => console.error(`stacks: ${line}`);

/** The pull requests' tabs as the finder follows them. */
function tabsOf(service: TabService): FinderTab[] {
  const { tabs: open, active } = service.list();
  return open.flatMap((tab) => {
    if (tab.kind !== 'pull') return [];
    const info = service.pull(tab.id);
    if (!info) return [];
    const { local, compareFrom } = info;
    return [
      {
        id: tab.id,
        // As the tab's poller watches it: by the name it was opened by.
        pull: new PullRef(tab.owner, tab.repo, tab.number),
        repository: info.repository.name,
        login: info.acting?.kind === 'account' ? info.acting.login : undefined,
        state: tab.state,
        onScreen: tab.id === active,
        head: info.shown,
        compareFrom,
        drawn: info.drawn,
        missing:
          local.kind === 'ready' &&
          local.from?.commit === compareFrom &&
          local.from?.missing === true,
      },
    ];
  });
}

export default defineFeature(contract, {
  uses: [tabs, github],
  handlers: {
    state: ({ id }) => finder?.state(id),
    useStart({ id, commit }) {
      if (!finder?.useStart(id, commit)) {
        throw new IpcError('moved', 'That start is no longer what the layer is offered.');
      }
    },
  },
  start(context) {
    const service = context.use(tabs);
    const access = context.use(github);
    const running = new StackFinder({
      poller: (login) => access.poller(login),
      publish: (state) => context.publish('stack', state),
      compareFrom: (id, commit) => service.compareFrom(id, commit),
      log,
    });
    finder = running;
    const follow = () => running.follow(tabsOf(service));
    stops.push(
      service.onTabs(follow),
      service.onPull(follow),
      access.onEvent((event) => {
        if (event.kind === 'removed') running.forgetAccount(event.login);
      }),
    );
    follow();
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    finder?.stop();
    finder = undefined;
  },
});
