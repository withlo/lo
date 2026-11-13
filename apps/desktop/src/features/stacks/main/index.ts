// The stacks feature in main: for each pull request's tab, the stack its pull request is in, found
// among its repository's open pull requests as its account's poller lists them, and sent to the
// window each time it changes. Only the tab on screen reads its layers' state. And making a chain a
// GitHub stack: planned here from what GitHub says, and run here once the reader confirms the plan.

import { PullRef } from '@lo/github';

import { defineFeature } from '../../../main/features.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { github } from '../../accounts/service.ts';
import { tabs, type TabService } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { Conversions } from './conversion.ts';
import { StackFinder, type FinderTab } from './finder.ts';

let finder: StackFinder | undefined;
let conversions: Conversions | undefined;
const stops: (() => void)[] = [];

const log = (line: string) => console.error(`stacks: ${line}`);

/** The pull requests' tabs as the finder follows them. */
function tabsOf(service: TabService): FinderTab[] {
  const { tabs: open, active } = service.list();
  return open.flatMap((tab) => {
    if (tab.kind !== 'pull') return [];
    const info = service.pull(tab.id);
    if (!info) return [];
    return [
      {
        id: tab.id,
        // As the tab's poller watches it: by the name it was opened by.
        pull: new PullRef(tab.owner, tab.repo, tab.number),
        repository: info.repository.name,
        login: info.acting?.kind === 'account' ? info.acting.login : undefined,
        state: tab.state,
        onScreen: tab.id === active,
      },
    ];
  });
}

/** The conversions, once the feature has started. */
function converting(): Conversions {
  if (!conversions) throw new IpcError('stopped', 'Lo is quitting.');
  return conversions;
}

export default defineFeature(contract, {
  uses: [tabs, github],
  handlers: {
    state: ({ id }) => finder?.state(id),
    plan({ id }, context) {
      const service = context.use(tabs);
      const tab = tabsOf(service).find((each) => each.id === id);
      if (!tab) throw new IpcError('notFound', 'There’s no pull request in that tab.');
      return converting().plan({
        id,
        pull: tab.pull,
        repository: tab.repository,
        acting: service.pull(id)?.acting,
      });
    },
    convert: ({ key }) => converting().convert(key),
    stop({ key }) {
      conversions?.stop(key);
    },
    putBack: ({ key }) => converting().putBack(key),
  },
  start(context) {
    const service = context.use(tabs);
    const access = context.use(github);
    const found = new StackFinder({
      poller: (login) => access.poller(login),
      publish: (state) => context.publish('stack', state),
      log,
    });
    const making = new Conversions({
      poller: (login) => access.poller(login),
      found: (id) => found.found(id),
      publish: (view) => context.publish('conversion', view),
      log,
    });
    finder = found;
    conversions = making;
    const follow = () => {
      const followed = tabsOf(service);
      found.follow(followed);
      making.follow(new Set(followed.map((tab) => tab.id)));
    };
    stops.push(
      service.onTabs(follow),
      service.onPull(follow),
      access.onEvent((event) => {
        if (event.kind === 'removed') found.forgetAccount(event.login);
      }),
    );
    follow();
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    // Nothing more is sent: a change waiting is given up on, and no plan can be confirmed.
    conversions?.quit();
    conversions = undefined;
    finder?.stop();
    finder = undefined;
  },
});
