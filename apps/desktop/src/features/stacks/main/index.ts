// The stacks feature in main: for each pull request's tab, the stack its pull request is in, found
// among its repository's open pull requests as its account's poller lists them, and sent to the
// window each time it changes, and kept with the tab, so a link to any of its layers shows that tab;
// and where the layer on screen's diff starts: with the layer below it, set before the diff is
// drawn, or offered once it is. Only the tab on screen reads its layers' state. A run of layers the
// window chose shows as one diff, in a view the tab makes of it. And making a chain a GitHub stack:
// planned here from what GitHub says, and run here once the reader confirms the plan, unless Lo is
// merging a pull request on its path. Each repository's stacks and conversions are offered to the
// features that merge. What the reader dismissed for a stack or a layer is kept in the database,
// and what they turned off is in Settings: neither is offered again.

import { PullRef } from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { overviews } from '../../overview/service.ts';
import { settings } from '../../settings/service.ts';
import { tabs, type TabService } from '../../tab/service.ts';
import { contract, type Notice, type StackState } from '../contract.ts';
import { forest } from '../service.ts';
import { offerConvert, offerStart } from '../settings.ts';
import { Conversions } from './conversion.ts';
import { Dismissed } from './dismissed.ts';
import { StackFinder, type FinderTab } from './finder.ts';
import { Holds } from './holds.ts';

let finder: StackFinder | undefined;
let conversions: Conversions | undefined;
let dismissed: Dismissed | undefined;
/** What the features that merge hold conversions back with. */
const holds = new Holds();
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
        run: info.run !== undefined,
      },
    ];
  });
}

/**
 * Keeps the stack `state` says a tab's layer on screen is in with the tab, so a link to any of its
 * layers shows the tab, at that layer, or that it's in none. A stack not known yet keeps the last.
 */
function keepLayers(service: TabService, { id, stack }: StackState): void {
  switch (stack.kind) {
    case 'stack':
      service.setLayers(id, { layers: stack.rows.map((row) => row.number), root: stack.root });
      return;
    case 'none':
      service.setLayers(id, undefined);
      return;
    case 'unknown':
      return;
    default:
      stack satisfies never;
      throw new Error(`A stack of a kind Lo doesn’t know: ${JSON.stringify(stack)}.`);
  }
}

/** The conversions, once the feature has started. */
function converting(): Conversions {
  if (!conversions) throw new IpcError('stopped', 'Lo is quitting.');
  return conversions;
}

export default defineFeature(contract, {
  uses: [tabs, github, overviews, settings],
  provide: () => [
    provides(forest, {
      forest: (repo, login) => finder?.forest(repo, login),
      converting: (repo) => conversions?.converting(repo),
      holdConversions: (check) => holds.add(check),
    }),
  ],
  handlers: {
    state: ({ id }) => finder?.state(id),
    useStart({ id, commit }) {
      if (!finder?.useStart(id, commit)) {
        throw new IpcError('moved', 'The stack has changed.');
      }
    },
    dismiss({ id, notice }, context) {
      const tab = tabsOf(context.use(tabs)).find((each) => each.id === id);
      const stack = finder?.state(id)?.stack;
      if (!tab || !finder || !dismissed || (notice === 'convert' && stack?.kind !== 'stack')) {
        throw new IpcError('missing', 'There’s no stack in that tab.');
      }
      // The offer to convert is the stack's, so it's dismissed for each of its layers; the start
      // is the layer's own.
      const numbers =
        notice === 'convert' && stack?.kind === 'stack'
          ? stack.rows.map((row) => row.number)
          : [tab.pull.number];
      dismissed.add(notice, tab.pull.repo.key, numbers, Date.now());
      finder.noticesChanged();
    },
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
    run({ id, bottom, top }, context) {
      if (!finder) throw new IpcError('stopped', 'Lo is quitting.');
      const made = finder.run(id, bottom, top);
      if ('why' in made) throw new IpcError('refused', made.why);
      const view = context.use(tabs).openRun(id, made);
      if (view === undefined)
        throw new IpcError('notFound', 'There’s no pull request in that tab.');
      return view;
    },
  },
  start(context) {
    const service = context.use(tabs);
    const access = context.use(github);
    const switched = context.use(overviews);
    const kept = new Dismissed(context.database);
    dismissed = kept;
    // Whether each offer is on, once the settings file has been read: none is offered before, so
    // one turned off never shows for a moment.
    const on: Record<Notice, boolean | undefined> = { convert: undefined, start: undefined };
    const found = new StackFinder({
      poller: (login) => access.poller(login),
      publish: (state) => {
        context.publish('stack', state);
        // Once the finder is done: telling the tab changes the tabs, which the finder follows.
        queueMicrotask(() => {
          if (finder === found) keepLayers(service, state);
        });
      },
      compareFrom: (id, commit) => service.compareFrom(id, commit),
      offers: (notice, repo, numbers) => on[notice] === true && !kept.has(notice, repo, numbers),
      log,
      overviews: () => switched.on(),
    });
    const making = new Conversions({
      poller: (login) => access.poller(login),
      found: (id) => found.found(id),
      publish: (view) => context.publish('conversion', view),
      held: (repo, prs) => holds.held(repo, prs),
      log,
    });
    finder = found;
    conversions = making;
    const follow = () => {
      const followed = tabsOf(service);
      found.follow(followed);
      making.follow(new Set(followed.map((tab) => tab.id)));
    };
    const offering = (notice: Notice) => (value: boolean) => {
      on[notice] = value;
      found.noticesChanged();
    };
    stops.push(
      context.use(settings).watch(offerConvert, offering('convert')),
      context.use(settings).watch(offerStart, offering('start')),
      service.onTabs(follow),
      service.onPull(follow),
      access.onEvent((event) => {
        if (event.kind === 'removed') found.forgetAccount(event.login);
      }),
      switched.onChange(() => found.overviewsChanged()),
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
    dismissed = undefined;
  },
});
