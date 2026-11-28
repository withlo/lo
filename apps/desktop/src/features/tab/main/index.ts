// The tab feature in main: it keeps the window's tabs, tells the window each time they change, and
// opens them for other features, as links from other apps will. Each view of a pull request's tab,
// one for each layer of a stack it has shown, watches its pull request with its account's poller,
// and fetches its local copy once it's shown. Other features follow a pull request's tab by its
// view on screen. It also copies text and opens github.com pages for every feature, and shows a
// local copy's folder and copies its path. And it keeps the window's own state: the layout every
// pull request's tab draws its row with, and where the window is, how big, and whether it fills
// the screen, which it puts back as the window opens.

import { existsSync } from 'node:fs';

import { app, clipboard, screen, shell, type BrowserWindow } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { openPage } from '../../../main/browser.ts';
import { offlineAfter } from '../../../main/environment.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { tokens } from '../../../main/tokens.ts';
import { github } from '../../accounts/service.ts';
import { settings } from '../../settings/service.ts';
import { login as accountLogin } from '../../accounts/contract.ts';
import {
  contract,
  isGithubPage,
  oid,
  opening as openingSchema,
  queueOpening,
  run as runSchema,
  stack as stackSchema,
  viewsOnScreen,
  type Tabs,
} from '../contract.ts';
import { tabs } from '../service.ts';
import { before, open as openOn } from '../settings.ts';
import { carryOver } from './carry.ts';
import { folderToShow } from './local.ts';
import { Refreshes } from './refreshes.ts';
import { createTabs, type TabList } from './tabs.ts';
import { Watcher } from './watcher.ts';
import { createPlaces, createWindowStore, type WindowStore } from './window.ts';

/** A run's layers, as the tab keeps them. */
const runLayers = runSchema.shape.layers;

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

/** What reads each part of a tab again as the reader asks, all at once. */
const refreshes = new Refreshes(log);

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

let windowStore: WindowStore | undefined;

/** The window's own state, read from the database the first time anything asks for it. */
function windowOf({ database }: FeatureContext<typeof contract>): WindowStore {
  windowStore ??= createWindowStore(database, {
    left: { min: tokens.size('lo-panel-left-min-w'), max: tokens.size('lo-panel-left-max-w') },
    threads: { min: tokens.size('lo-panel-right-min-w'), max: tokens.size('lo-panel-right-max-w') },
  });
  return windowStore;
}

/** Stops keeping the windows' places, which the feature does from the time it starts. */
let stopPlaces: (() => void) | undefined;

/** Stops watching the key `tab.open` replaced. */
let stopBefore: (() => void) | undefined;

/** The watcher, which starts with the feature. */
function watching(): Watcher {
  if (!watcher) throw new IpcError('unavailable', 'Lo hasn’t started its tabs yet.');
  return watcher;
}

/** The watcher, once it's checked that `id` is a view of a pull request's tab. */
function pullTab(id: string): Watcher {
  const running = watching();
  if (!running.has(id)) {
    throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
  }
  return running;
}

export default defineFeature(contract, {
  uses: [github, settings],
  provide: (context) => [
    provides(tabs, {
      list: () => viewsOnScreen(tabsOf(context).list()),
      // Checked as a request's input is: what another feature hands over may come from a link.
      open: (opening, as) =>
        tabsOf(context).open(
          opening.kind === 'queue' ? queueOpening.parse(opening) : openingSchema.parse(opening),
          as === undefined ? undefined : { login: accountLogin.parse(as.login) },
        ),
      // Checked too: the stack's numbers and branch come from GitHub.
      setLayers: (id, stack) =>
        tabsOf(context).setLayers(id, stack === undefined ? undefined : stackSchema.parse(stack)),
      // Checked too: the layers and the start come from GitHub.
      openRun: (id, run) =>
        tabsOf(context).openRun(id, {
          layers: runLayers.parse(run.layers),
          start: oid.parse(run.start),
        }),
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
      // Checked too: the commit comes from GitHub.
      compareFrom: (id, commit) =>
        watcher?.compareFrom(id, commit === undefined ? undefined : oid.parse(commit)),
      clone: (id) => watcher?.clone(id),
      drawn: (id, head) => watcher?.drawn(id, head),
      onRefresh: (refresher) => refreshes.listen(refresher),
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
        ? tabsOf(context).move(input.id, input.to, input.brought)
        : tabsOf(context).step(input.id, input.step, input.within),
    state: ({ id }) => watching().snapshot(id),
    reload({ id }) {
      pullTab(id).reload(id);
    },
    retry({ id }) {
      pullTab(id).retry(id);
    },
    refresh: ({ id }) => refreshes.refresh(id),
    showLocal({ id }) {
      // The clone's folder as main keeps it, shown in its folder and never opened, so nothing in
      // it runs.
      shell.showItemInFolder(folderToShow(pullTab(id).localFolder(id), existsSync));
    },
    async copyLocal({ id }) {
      const folder = pullTab(id).localFolder(id);
      if (folder === undefined) throw new IpcError('notReady', 'The local copy isn’t ready.');
      await clipboard.writeText(folder);
    },
    async choose({ id, login }) {
      await pullTab(id).choose(id, login);
    },
    async copy({ text }) {
      await clipboard.writeText(text);
    },
    layout: (_input, context) => windowOf(context).layout(),
    keepLayout(layout, context) {
      windowOf(context).keepLayout(layout);
    },
    async openExternal({ url }) {
      // The contract refuses anything else; this holds even if it's loosened.
      if (!isGithubPage(url)) throw new IpcError('refused', 'Lo opens only pages on github.com.');
      // In the system's browser, or the program `LO_BROWSER` names in a build run from source.
      await openPage(url);
    },
  },
  start(context) {
    // Each window opens where the last one was.
    const placing = createPlaces(windowOf(context), log);
    const follow = (_event: unknown, window: BrowserWindow) =>
      placing.follow(
        window,
        screen.getAllDisplays().map((display) => display.workArea),
      );
    app.on('browser-window-created', follow);
    stopPlaces = () => {
      app.off('browser-window-created', follow);
      placing.stop();
    };
    // The window reads it as a pull request's tab opens, and changes it from Settings.
    const file = context.use(settings);
    file.declare(openOn);
    // A value saved under the key it replaced, carried over once.
    stopBefore = file.watch(before, (value) => {
      if (value !== null) void carryOver(file, value, log);
    });
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
    const reading = watcher;
    refreshes.listen((id) => (reading.has(id) ? reading.refresh(id) : undefined));
    watcher.follow(list.list());
  },
  stop() {
    stopPlaces?.();
    stopPlaces = undefined;
    stopBefore?.();
    stopBefore = undefined;
    following.clear();
    watchingTabs.clear();
    refreshes.clear();
    watcher?.stop();
  },
});
