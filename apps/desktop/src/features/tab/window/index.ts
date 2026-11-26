import { handlers, type History, type NoTarget, type TabTarget } from '@lo/ui/commands';
import { createElement } from 'react';

import { menuStale } from '../../../window/commands/bar.ts';
import { openMenuOf } from '../../../window/commands/menus.tsx';
import { announce, fail, saidBy } from '../../../window/commands/notices.tsx';
import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as app } from '../../app/contract.ts';
import { settingRow } from '../../settings/window/shared.ts';
import { overviewRows } from '../../welcome/window/shared.ts';
import { layerOf, viewIds, type Choice, type PlaceChoice, type Tab } from '../contract.ts';
import keys from '../keys.ts';
import { open as openOn } from '../settings.ts';
import { follow } from './follow.ts';
import { copyLocalPath, localShowable, showLocalCopy } from './localCopy.ts';
import { main } from './main.ts';
import { moreStore, setMoreOpen } from './more.ts';
import { choosable, chooseAccount } from './Notes.tsx';
import { OpenOnChoice, OpenOnRow, useOpenOnLine } from './OpenOn.tsx';
import { blocked } from './banners.ts';
import {
  besideDrawable,
  besideDrawn,
  drawable,
  drawnRow,
  firstLayout,
  keepLayout,
  layout,
  loadLayout,
  panelDrawn,
  resetLayout,
  resettable,
  resetWidth,
  row,
  steppable,
  stepWidth,
  togglePanel,
  viewCounts,
  type Edge,
} from './layout.ts';
import { inStrip, movable, showable, stepTab } from './order.ts';
import {
  bringView,
  focusView,
  kindOf,
  middleIds,
  panels,
  stepAmong,
  toggleBeside,
  toggleRight,
  viewsOf,
} from './panels.ts';
import { PullRequestTab } from './PullRequestTab.tsx';
import { activeTab, kinds, middleShown, viewsShown } from './shared.ts';
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

/** The command that shows the tab `choice` names, as it's asked, while that's one to show. */
function showing(choice: () => PlaceChoice) {
  return {
    run: () => select(choice()),
    enabled: () => showable(tabsStore.getState(), choice()),
  };
}

/** The pull request's tab on screen, or why a key for one can't run. */
function pullOnScreen(): Extract<Tab, { kind: 'pull' }> | string {
  const tab = activeTab();
  return tab?.kind === 'pull' ? tab : 'Open a pull request first';
}

/**
 * The views `` ` `` and `~` step through, by whether each has a label: those the header's switch
 * lists, or with the code beside, its reading views, which take the reading view's place.
 */
function steppedThrough(two: boolean): readonly boolean[] {
  const { labeled, ids } = middleIds;
  return two ? labeled.map((has, at) => has && kindOf(ids[at]) === 'reading') : labeled;
}

/**
 * Steps the tab on screen's middle view by `step` among those the header's switch lists, round the
 * ends; with the code beside, its reading view among the reading views. A view with no label, such
 * as a file whole, opens from what it shows and isn't stepped to.
 */
function stepMiddle(step: 1 | -1): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const two = besideDrawn();
  const { ids } = middleIds;
  const from = two ? viewsShown(tab.id)[0] : middleShown(tab.id);
  const at = Math.max(0, ids.indexOf(from ?? ''));
  const next = ids[stepAmong(at, step, steppedThrough(two))];
  if (next !== undefined) bringView(tab.id, next, two);
}

/**
 * Why the middle view can't change: there's no pull request on screen, or one view at most, or
 * with the code beside, one reading view, with nothing to say.
 */
function middleSteps(): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  const two = besideDrawn();
  const listed = steppedThrough(two).filter(Boolean).length;
  if (listed > 1) return true;
  return two ? '' : 'Only one view so far';
}

/** Why the code can't be put beside a reading view, or taken away, in the tab on screen. */
function besideSwitch(): true | string {
  const tab = activeTab();
  // Recent, Settings and a merge queue have no row to lay out.
  if (tab?.kind !== 'pull') return '';
  const why = rowless();
  if (why !== undefined) return why;
  if (viewCounts.reading === 0 || viewCounts.code === 0) return '';
  return besideDrawable();
}

/**
 * The other of the two views on screen in the tab on screen, from the one focus is in, or why
 * there's none to go to: `''`, with nothing to say, where there's one view, or focus isn't in one.
 */
function otherView(): string {
  const tab = activeTab();
  if (tab?.kind !== 'pull' || rowless() !== undefined) return '';
  const saved = layout.getState();
  if (!saved.beside || viewCounts.reading === 0 || viewCounts.code === 0) return '';
  const id = document.activeElement
    ?.closest('[data-lo-views] [data-lo-middle-view]')
    ?.getAttribute('data-lo-middle-view');
  const shown = viewsShown(tab.id);
  if (!id || !shown.includes(id)) return '';
  if (shown.length === 2) return shown.find((each) => each !== id) ?? '';
  // With room for one, the other of the tab's two.
  const two = viewsOf(tab.id, panels.get(tab.id), undefined, true);
  if (!two.beside) return '';
  return kindOf(id) === 'code' ? two.reading : two.code;
}

/**
 * Goes to the other view, as `\` does: focus goes into it, or with room for only one, it's drawn in
 * the place of the one that had focus, and takes it.
 */
function goToOtherView(): void {
  const tab = activeTab();
  const id = otherView();
  if (tab?.kind !== 'pull' || id === '') return;
  if (viewsShown(tab.id).length === 2) {
    focusView(id);
    return;
  }
  panels.update(tab.id, (current) => ({ ...current, middle: id }));
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

/** The link to the pull request on screen, in a stack's tab the layer it shows, or `''` with none. */
function linkOnScreen(): string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return '';
  return `https://github.com/${tab.owner}/${tab.repo}/pull/${layerOf(tab)}`;
}

/** Why there's no pull request on screen to link to, or `true` when there is. */
function linkable(): true | string {
  const tab = pullOnScreen();
  return typeof tab === 'string' ? tab : true;
}

/** Copies the link to the pull request on screen, and says so, or what failed. */
async function copyLink(): Promise<void> {
  const text = linkOnScreen();
  if (text === '') return;
  try {
    await main().copy({ text });
  } catch (error) {
    console.error("Lo couldn't copy the link:", error);
    fail('Couldn’t copy the link', saidBy(error));
    return;
  }
  announce('Copied link');
}

/** Opens the pull request on screen on GitHub, and says so if that failed. */
async function openOnGithub(): Promise<void> {
  const url = linkOnScreen();
  if (url === '') return;
  try {
    await main().openExternal({ url });
  } catch (error) {
    console.error("Lo couldn't open the pull request on GitHub:", error);
    fail('Couldn’t open GitHub’s page', saidBy(error));
  }
}

/** The banner row's button `kind`, "+1" or Dismiss, on the banner the tab on screen shows. */
function bannerButton(kind: 'more' | 'dismiss'): HTMLElement | undefined {
  const found = document.querySelectorAll<HTMLElement>(
    `[data-lo-banners] [data-lo-banner="${kind}"]`,
  );
  return [...found].find((button) => button.closest('[inert]') === null);
}

/** Whether the banner on screen has the button `kind`, or why not. */
function pressable(kind: 'more' | 'dismiss'): true | string {
  if (bannerButton(kind)) return true;
  const shown = document.querySelector('[data-lo-banners] :is([role="status"], [role="alert"])');
  if (!shown) return 'No messages';
  return kind === 'more' ? 'No other messages' : 'This message can’t be dismissed';
}

/** Why the pull request on screen has no row to lay out: there's none, or it can't be shown. */
function rowless(): string | undefined {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  // Its panels' controls are off with the rest of what it can't show.
  return blocked(pullsStore.getState().views.get(tab.id)) ? '' : undefined;
}

/** Whether panel `edge` can open or close in the pull request on screen, or why not. */
function switchable(edge: Edge, none: string): true | string {
  const why = rowless();
  if (why !== undefined) return why;
  if ((edge === 'left' ? viewCounts.left : viewCounts.right) === 0) return none;
  return drawable(edge);
}

/** Whether panel `edge` is drawn in the pull request on screen. */
function drawnOnScreen(edge: Edge): boolean {
  return rowless() === undefined && panelDrawn(edge);
}

/** What the app menu shows of the row: which panels are drawn, and which can't be. */
function rowShown(): string {
  const { left, threads, views, cramped } = drawnRow();
  return JSON.stringify([left !== undefined, threads !== undefined, views.length, cramped]);
}

/** Why `target`, a tab or the one on screen, can't be closed, or `true` when it can. */
function closable(target: TabTarget | NoTarget): true | string {
  const { tabs, active } = tabsStore.getState();
  const id = target.kind === 'tab' ? target.tab : active;
  return tabs.find((tab) => tab.id === id)?.kind === 'recent'
    ? 'Recent pull requests can’t be closed'
    : true;
}

/**
 * Whether a tab's right-click menu lists moving and closing it: not on Recent pull requests, which
 * never moves or closes, so its tab opens no menu with nothing to run.
 */
function notRecent(target: TabTarget | NoTarget): boolean {
  if (target.kind !== 'tab') return true;
  return tabsStore.getState().tabs.find((tab) => tab.id === target.tab)?.kind !== 'recent';
}

export default {
  commands: handlers(keys, {
    show1: showing(() => ({ position: 1 })),
    show2: showing(() => ({ position: 2 })),
    show3: showing(() => ({ position: 3 })),
    show4: showing(() => ({ position: 4 })),
    show5: showing(() => ({ position: 5 })),
    show6: showing(() => ({ position: 6 })),
    show7: showing(() => ({ position: 7 })),
    show8: showing(() => ({ position: 8 })),
    showLast: showing(() => ({ last: true })),
    next: showing(() => ({ step: 1, within: inStrip() })),
    previous: showing(() => ({ step: -1, within: inStrip() })),
    moveLeft: {
      run: (target) => stepTab(target, -1),
      enabled: (target) => movable(tabsStore.getState(), target, -1, inStrip()),
      listed: notRecent,
    },
    moveRight: {
      run: (target) => stepTab(target, 1),
      enabled: (target) => movable(tabsStore.getState(), target, 1, inStrip()),
      listed: notRecent,
    },
    more: {
      run: () => setMoreOpen(true),
      enabled: () => moreStore.getState().folded.length > 0 || 'Every tab fits',
    },
    leftPanel: {
      run: () => {
        togglePanel('left');
      },
      enabled: () => switchable('left', 'No left panel yet'),
      checked: () => drawnOnScreen('left'),
    },
    rightPanel: {
      run: toggleRight,
      enabled: () => switchable('threads', 'No threads panel yet'),
      checked: () => drawnOnScreen('threads'),
    },
    beside: {
      run: () => {
        toggleBeside();
      },
      enabled: besideSwitch,
      checked: () => rowless() === undefined && besideDrawn(),
    },
    otherView: { run: goToOtherView, enabled: () => otherView() !== '' || '' },
    widen: { run: () => stepWidth(1), enabled: () => steppable(1) },
    narrow: { run: () => stepWidth(-1), enabled: () => steppable(-1) },
    resetWidth: { run: resetWidth, enabled: resettable },
    resetLayout: {
      run: resetLayout,
      enabled: () => (rowless() === undefined && !firstLayout()) || '',
    },
    nextView: { run: () => stepMiddle(1), enabled: middleSteps },
    previousView: { run: () => stepMiddle(-1), enabled: middleSteps },
    openOnGithub: { run: openOnGithub, enabled: linkable },
    copyLink: { run: copyLink, enabled: linkable },
    showLocalCopy: { run: showLocalCopy, enabled: localShowable },
    copyLocalPath: { run: copyLocalPath, enabled: localShowable },
    // As a click on the banner's own button, which hands focus on as it does.
    nextBanner: { run: () => bannerButton('more')?.click(), enabled: () => pressable('more') },
    // One that asks where opens its menu as a key does, with its first row ready.
    dismissBanner: {
      run: () => {
        const button = bannerButton('dismiss');
        if (button?.getAttribute('aria-haspopup') === 'menu') openMenuOf(button);
        else button?.click();
      },
      enabled: () => pressable('dismiss'),
    },
    chooseAccount: {
      run: (target) => {
        const tab = pullOnScreen();
        if (typeof tab !== 'string') chooseAccount(tab, target.kind === 'row' ? target.row : null);
      },
      enabled: () => {
        const tab = pullOnScreen();
        return typeof tab === 'string' ? tab : choosable(tab);
      },
    },
    // Main closes the tab on screen as it has it, so two quick presses close two tabs.
    close: {
      run: (target) => main().close(target.kind === 'tab' ? { id: target.tab } : {}),
      enabled: closable,
      listed: notRecent,
    },
  }),
  views: [
    defineView(kinds, {
      id: 'tab.pull',
      order: 0,
      render: ({ tab }) => (tab.kind === 'pull' ? createElement(PullRequestTab, { tab }) : null),
    }),
    // Settings › Pull requests, after whether overviews show (5).
    settingRow(openOn, { order: 10, control: OpenOnChoice, useLine: useOpenOnLine }),
    // The welcome's step that says what an overview is, after whether there are overviews (10).
    defineView(overviewRows, {
      id: 'tab.openOnRow',
      order: 20,
      render: () => createElement(OpenOnRow),
    }),
  ],
  start() {
    const tabs = main();
    // The registry and the title follow the tabs from the first time main says what they are.
    follow(registry(), tabsStore, (title) => {
      document.title = title;
    });
    // The layout first, so the first frame of a tab is laid out as it was kept; then each change
    // to it is kept. Without it, the tabs draw on the first layout.
    const laidOut = loadLayout()
      .catch((error: unknown) => console.error("Lo couldn't read the window's layout:", error))
      .finally(keepLayout);
    // Subscribed first, so no change between the two is missed.
    tabs.subscribe('tabs', (value) => void laidOut.then(() => showTabs(value)));
    tabs.subscribe('pull', showPull);
    tabs.subscribe('files', showFiles);
    tabs.subscribe('local', showLocal);
    tabsStore.subscribe(catchUp);
    // The app menu's checks, and what it dims, follow the tabs and their panels however they move:
    // as the layout changes, and as the row's width puts a panel away or brings it back, but not at
    // each frame of a drag.
    for (const store of [tabsStore, panels, layout]) {
      store.subscribe(() => menuStale());
    }
    let shownRow = rowShown();
    row.subscribe(() => {
      const now = rowShown();
      if (now === shownRow) return;
      shownRow = now;
      menuStale();
    });
    tabs
      .list()
      .then(async (value) => {
        await laidOut;
        showTabs(value);
      })
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
