import { handlers, type History, type NoTarget, type TabTarget } from '@lo/ui/commands';
import { createElement } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as app } from '../../app/contract.ts';
import { viewIds, type Choice, type Tab } from '../contract.ts';
import keys from '../keys.ts';
import { follow } from './follow.ts';
import { main } from './main.ts';
import { moreStore, setMoreOpen } from './more.ts';
import { inStrip, movable, stepTab } from './order.ts';
import { middleIds, panels, stepAmong, viewCounts } from './panels.ts';
import { PullRequestTab } from './PullRequestTab.tsx';
import { activeTab, kinds } from './shared.ts';
import { pullsStore, showFiles, showLocal, showPull, showTabs, tabsStore } from './store.ts';

declare global {
  interface Window {
    /** The registry's history, for the smoke test, in a build run from source. */
    loHistory?: History;
  }
}

/** Asks main to show a tab. */
function select(choice: Choice): Promise<void> {
  return main().select(choice);
}

/** The pull request's tab on screen, or why a key for one can't run. */
function pullOnScreen(): Extract<Tab, { kind: 'pull' }> | string {
  const tab = activeTab();
  return tab?.kind === 'pull' ? tab : 'There’s no pull request on screen.';
}

/**
 * Steps the tab on screen's middle view by `step` among those the header's switch lists, round the
 * ends. A view with no label, such as a file whole, opens from what it shows and isn't stepped to.
 */
function stepMiddle(step: 1 | -1): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const { labeled } = middleIds;
  panels.update(tab.id, (current) => ({
    ...current,
    middle: stepAmong(current.middle % Math.max(1, labeled.length), step, labeled),
  }));
}

/** Why the middle view can't change: there's no pull request on screen, or one view at most. */
function middleSteps(): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  const listed = middleIds.labeled.filter(Boolean).length;
  return listed > 1 ? true : 'This pull request has one view so far.';
}

/** Asks main what it has for every view of a pull request's tab the window has heard nothing of. */
function catchUp(): void {
  const { views } = pullsStore.getState();
  const unheard = tabsStore
    .getState()
    .tabs.flatMap((tab) => (tab.kind === 'pull' ? viewIds([tab]) : []))
    .filter((id) => !views.has(id));
  for (const id of unheard) {
    main()
      .state({ id })
      .then((state) => {
        if (!state) return;
        // A topic that arrived meanwhile is newer.
        if (!pullsStore.getState().views.has(id)) showPull(state.pull);
        if (state.files && !pullsStore.getState().files.has(id)) showFiles(state.files);
        if (!pullsStore.getState().locals.has(id)) showLocal(state.local);
      })
      .catch((error: unknown) => console.error("Lo couldn't ask about a tab:", error));
  }
}

/** Why `target`, a tab or the one on screen, can't be closed, or `true` when it can. */
function closable(target: TabTarget | NoTarget): true | string {
  const { tabs, active } = tabsStore.getState();
  const id = target.kind === 'tab' ? target.tab : active;
  return tabs.find((tab) => tab.id === id)?.kind === 'recent'
    ? "Recent pull requests can't be closed: it shows while no other tab is open."
    : true;
}

export default {
  commands: handlers(keys, {
    show1: { run: () => select({ position: 1 }) },
    show2: { run: () => select({ position: 2 }) },
    show3: { run: () => select({ position: 3 }) },
    show4: { run: () => select({ position: 4 }) },
    show5: { run: () => select({ position: 5 }) },
    show6: { run: () => select({ position: 6 }) },
    show7: { run: () => select({ position: 7 }) },
    show8: { run: () => select({ position: 8 }) },
    showLast: { run: () => select({ last: true }) },
    next: { run: () => select({ step: 1, within: inStrip() }) },
    previous: { run: () => select({ step: -1, within: inStrip() }) },
    moveLeft: {
      run: (target) => stepTab(target, -1),
      enabled: (target) => movable(tabsStore.getState(), target, -1, inStrip()),
    },
    moveRight: {
      run: (target) => stepTab(target, 1),
      enabled: (target) => movable(tabsStore.getState(), target, 1, inStrip()),
    },
    more: {
      run: () => setMoreOpen(true),
      enabled: () => moreStore.getState().folded.length > 0 || 'Every tab fits in the strip.',
    },
    leftPanel: {
      run: () => {
        const tab = pullOnScreen();
        if (typeof tab === 'string') return;
        panels.update(tab.id, (current) => ({ ...current, leftOpen: !current.leftOpen }));
      },
      enabled: () => {
        const tab = pullOnScreen();
        if (typeof tab === 'string') return tab;
        return viewCounts.left > 0 || 'This pull request has no left panel yet.';
      },
    },
    nextView: { run: () => stepMiddle(1), enabled: middleSteps },
    previousView: { run: () => stepMiddle(-1), enabled: middleSteps },
    // Main closes the tab on screen as it has it, so two quick presses close two tabs.
    close: {
      run: (target) => main().close(target.kind === 'tab' ? { id: target.tab } : {}),
      enabled: closable,
    },
  }),
  views: [
    defineView(kinds, {
      id: 'tab.pull',
      order: 0,
      render: ({ tab }) => (tab.kind === 'pull' ? createElement(PullRequestTab, { tab }) : null),
    }),
  ],
  start() {
    const tabs = main();
    // The registry and the title follow the tabs from the first time main says what they are.
    follow(registry(), tabsStore, (title) => {
      document.title = title;
    });
    // Subscribed first, so no change between the two is missed.
    tabs.subscribe('tabs', showTabs);
    tabs.subscribe('pull', showPull);
    tabs.subscribe('files', showFiles);
    tabs.subscribe('local', showLocal);
    tabsStore.subscribe(catchUp);
    tabs
      .list()
      .then(showTabs)
      .catch((error: unknown) => console.error("Lo couldn't list its tabs:", error));
    // The smoke test records places of its own in the history, to walk them by key.
    client(app)
      .info()
      .then(({ packaged }) => {
        if (!packaged) window.loHistory = registry().history;
      })
      .catch((error: unknown) => console.error("Lo couldn't ask how it was built:", error));
  },
} satisfies WindowFeature;
