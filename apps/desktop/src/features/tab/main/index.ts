// The tab feature in main: it keeps the window's tabs, tells the window each time they change, and
// opens them for other features, as links from other apps will. Each view of a pull request's tab,
// one for each layer of a stack it has shown, watches its pull request with its account's poller,
// and fetches its local copy once it's shown. Other features follow a pull request's tab by its
// view on screen. It also copies text and opens github.com pages for every feature.

import { app, clipboard } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { openPage } from '../../../main/browser.ts';
import { offlineAfter } from '../../../main/environment.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { login as accountLogin } from '../../accounts/contract.ts';
import {
  contract,
  isGithubPage,
  opening as openingSchema,
  stack as stackSchema,
  viewsOnScreen,
  type Tabs,
} from '../contract.ts';
import { tabs } from '../service.ts';
import { createTabs, type TabList } from './tabs.ts';
import { Watcher } from './watcher.ts';

let kept: TabList | undefined;
let watcher: Watcher | undefined;
/** Other features following pull requests' tabs, which may start listening before the watcher. */
const following = new Set<(id: string) => void>();
/**
 * Other features following the tabs themselves: which are open, and which is on screen, each pull
 * request's tab by its view on screen.
 */
const watchingTabs = new Set<(value: Tabs) => void>();

const log = (line: string) => console.error(`tab: ${line}`);

/** The tabs, read from the database the first time anything asks for them. */
function tabsOf({ database, publish }: FeatureContext<typeof contract>): TabList {
  kept ??= createTabs({
    database,
    changed: (value) => {
      publish('tabs', value);
      watcher?.follow(value);
      const views = viewsOnScreen(value);
      for (const listener of watchingTabs) {
        try {
          listener(views);
        } catch (error) {
          log(`a listener failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  });
  return kept;
}

/** The watcher, which starts with the feature. */
function watching(): Watcher {
  if (!watcher) throw new IpcError('unavailable', "Lo hasn't started its tabs yet.");
  return watcher;
}

/** The watcher, once it's checked that `id` is a view of a pull request's tab. */
function pullTab(id: string): Watcher {
  const running = watching();
  if (!running.has(id)) {
    throw new IpcError('missing', "There's no pull request's tab with that id.");
  }
  return running;
}

export default defineFeature(contract, {
  uses: [github],
  provide: (context) => [
    provides(tabs, {
      list: () => viewsOnScreen(tabsOf(context).list()),
      // Checked as a request's input is: what another feature hands over may come from a link.
      open: (opening, as) =>
        tabsOf(context).open(
          openingSchema.parse(opening),
          as === undefined ? undefined : { login: accountLogin.parse(as.login) },
        ),
      // Checked too: the stack's numbers and branch come from GitHub.
      setLayers: (id, stack) =>
        tabsOf(context).setLayers(id, stack === undefined ? undefined : stackSchema.parse(stack)),
      pull: (id) => watcher?.info(id),
      onPull(listener) {
        following.add(listener);
        return () => {
          following.delete(listener);
        };
      },
      onTabs(listener) {
        watchingTabs.add(listener);
        return () => {
          watchingTabs.delete(listener);
        };
      },
      clone: (id) => watcher?.clone(id),
      drawn: (id, head) => watcher?.drawn(id, head),
    }),
  ],
  handlers: {
    list: (_input, context) => tabsOf(context).list(),
    open: (opening, context) => tabsOf(context).open(opening),
    close({ id }, context) {
      tabsOf(context).close(id);
    },
    select(choice, context) {
      tabsOf(context).select(choice);
    },
    layer: ({ id, number }, context) => tabsOf(context).layer(id, number),
    move: (input, context) =>
      'to' in input
        ? tabsOf(context).move(input.id, input.to)
        : tabsOf(context).step(input.id, input.step, input.within),
    state: ({ id }) => watching().snapshot(id),
    reload({ id }) {
      pullTab(id).reload(id);
    },
    retry({ id }) {
      pullTab(id).retry(id);
    },
    async choose({ id, login }) {
      await pullTab(id).choose(id, login);
    },
    async copy({ text }) {
      await clipboard.writeText(text);
    },
    async openExternal({ url }) {
      // The contract refuses anything else; this holds even if it's loosened.
      if (!isGithubPage(url)) throw new IpcError('refused', 'Lo opens only pages on github.com.');
      // In the system's browser, or the program `LO_BROWSER` names in a build run from source.
      await openPage(url);
    },
  },
  start(context) {
    const list = tabsOf(context);
    watcher = new Watcher({
      offlineAfter: offlineAfter({ packaged: app.isPackaged, env: process.env }),
      github: context.use(github),
      git: context.git,
      publish: {
        pull: (value) => context.publish('pull', value),
        files: (value) => context.publish('files', value),
        local: (value) => context.publish('local', value),
      },
      store: {
        kept: (id) => list.kept(id),
        keep(id, { title, state, login, repository }) {
          if (title !== undefined && state !== undefined) list.describe(id, { title, state });
          if (login !== undefined || repository !== undefined) {
            list.remember(id, { login, repository });
          }
        },
      },
      log,
    });
    watcher.onChange((id) => {
      for (const listener of following) listener(id);
    });
    watcher.follow(list.list());
  },
  stop() {
    following.clear();
    watchingTabs.clear();
    watcher?.stop();
  },
});
