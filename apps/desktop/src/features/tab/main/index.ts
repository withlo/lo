// The tab feature in main: it keeps the window's tabs, tells the window each time they change, and
// opens them for other features, as links from other apps will. Each pull request's tab watches
// its pull request with its account's poller, and fetches its local copy once it's shown. It also
// copies text and opens github.com pages for every feature.

import { clipboard, shell } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { login as accountLogin } from '../../accounts/contract.ts';
import { contract, isGithubPage, opening as openingSchema } from '../contract.ts';
import { tabs } from '../service.ts';
import { createTabs, type TabList } from './tabs.ts';
import { Watcher } from './watcher.ts';

let kept: TabList | undefined;
let watcher: Watcher | undefined;

const log = (line: string) => console.error(`tab: ${line}`);

/** The tabs, read from the database the first time anything asks for them. */
function tabsOf({ database, publish }: FeatureContext<typeof contract>): TabList {
  kept ??= createTabs({
    database,
    changed: (value) => {
      publish('tabs', value);
      watcher?.follow(value);
    },
  });
  return kept;
}

/** The watcher, which starts with the feature. */
function watching(): Watcher {
  if (!watcher) throw new IpcError('unavailable', "Lo hasn't started its tabs yet.");
  return watcher;
}

/** The watcher, once it's checked that `id` is a pull request's tab. */
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
      list: () => tabsOf(context).list(),
      // Checked as a request's input is: what another feature hands over may come from a link.
      open: (opening, as) =>
        tabsOf(context).open(
          openingSchema.parse(opening),
          as === undefined ? undefined : { login: accountLogin.parse(as.login) },
        ),
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
    move({ id, to }, context) {
      tabsOf(context).move(id, to);
    },
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
      await shell.openExternal(url);
    },
  },
  start(context) {
    const list = tabsOf(context);
    watcher = new Watcher({
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
    watcher.follow(list.list());
  },
  stop() {
    watcher?.stop();
  },
});
