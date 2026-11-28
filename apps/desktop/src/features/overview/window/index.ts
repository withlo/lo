// The overview feature in the window: each pull request's tab's overview, checked as main reads
// it, shown as the first of the tab's middle views, with its mark in the view switch and what it
// says in the status bar; its markers in the diff; copying from its blocks' code, as in the diff;
// the prompt `ya` copies; the overview skill's rows, with the command that installs it from a
// terminal, which `yc` copies; and the setting that turns overviews off, which takes every one of
// these away, and on again.

import { handlers, type Target } from '@lo/ui/commands';
import { createElement } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { setCodeElsewhere } from '../../diff/window/shared.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { settingRow } from '../../settings/window/shared.ts';
import { viewIds } from '../../tab/contract.ts';
import { activeTab, middle, runOf, showingMiddle, status } from '../../tab/window/shared.ts';
import { overviewRows, setup } from '../../welcome/window/shared.ts';
import keys from '../keys.ts';
import { auto, on } from '../settings.ts';
import { copyPrompt, promptNow } from './copy.ts';
import { blockCode } from './copying.ts';
import { OVERVIEW_VIEW } from './labels.ts';
import { main, tabs } from './main.ts';
import { standingOf } from './facts.ts';
import { followMarkers, keepMarkersOnly } from './markers.ts';
import { OverviewMark } from './Mark.tsx';
import { OverviewView } from './Overview.tsx';
import { InstallCommandRow, OverviewsRow, SkillRow, SkillStep } from './Rows.tsx';
import { followOverviews, overviews } from './shared.ts';
import {
  blockAt,
  codeIn,
  drawnIn,
  focusBlock,
  focusLink,
  follow,
  followName,
  followOf,
  keepPlaces,
  loadNewer,
  looseControl,
  nextBlock,
  nextLink,
  scroll,
  step,
  stepName,
  stepsIn,
  type DrawnOverview,
  type Scroll,
} from './follow.ts';
import { copyInstallCommand, followSkill, installable, installSkill } from './skill.ts';
import { keepSinceOnly } from './since.ts';
import { OverviewStatus } from './Status.tsx';
import {
  catchUp,
  keepOnly,
  readAgain,
  checked,
  states,
  takeOverviews,
  takeRevisions,
  takeState,
} from './store.ts';
import { takeStore } from './terms.ts';

/** Every command of the overview's, which Settings takes out of the app with overviews. */
const COMMANDS = Object.keys(keys.commands).map((name) => `${keys.feature}.${name}`);

/** The ids of the pull requests' tabs' views open now, as main lists them. */
function openViews(): Promise<string[]> {
  return tabs()
    .list()
    .then(({ tabs: open }) => viewIds(open.filter(({ kind }) => kind === 'pull')));
}

/** The prompt the overview of the pull request on screen offers, or why there's none. */
function promptOnScreen(): string | { why: string } {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return { why: 'Open a pull request first' };
  return promptNow(tab) ?? { why: 'This overview is up to date' };
}

/** The overview drawn in the tab on screen, or why a key for it can't run. */
function onScreen(): DrawnOverview | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  return drawnIn(tab.id) ?? 'Go to the overview first';
}

/**
 * A control with focus in the overview's view on screen, outside its blocks, which `⏎` presses:
 * with no overview drawn, such as one that couldn't be fetched, the view's own buttons.
 */
function looseOnScreen(): HTMLElement | undefined {
  const tab = activeTab();
  return tab?.kind === 'pull' ? looseControl(drawnIn(tab.id)) : undefined;
}

/** Whether there's an overview on screen for a key to act on, or why not. */
function overviewNow(): true | string {
  const overview = onScreen();
  return typeof overview === 'string' ? overview : true;
}

/** Runs `act` on the overview on screen. */
function withOverview(act: (overview: DrawnOverview) => void) {
  return (): void => {
    const overview = onScreen();
    if (typeof overview !== 'string') act(overview);
  };
}

/**
 * The block a key or menu acts on: the one its target names, a key's being the block that has
 * focus; or, for none, why there's none.
 */
function blockOf(target: Target): { overview: DrawnOverview; block: HTMLElement } | string {
  const overview = onScreen();
  if (typeof overview === 'string') return overview;
  if (target.kind === 'none') return 'Go to a block first';
  const block = blockAt(overview, target);
  return block ? { overview, block } : 'That block isn’t in this overview';
}

/** Whether a block's command can run on `target`, as `check` says of it. */
function onBlock(check: (overview: DrawnOverview, block: HTMLElement) => true | string) {
  return (target: Target): true | string => {
    const found = blockOf(target);
    return typeof found === 'string' ? found : check(found.overview, found.block);
  };
}

/** Runs `act` on the block `target` names. */
function withBlock(act: (overview: DrawnOverview, block: HTMLElement) => void) {
  return (target: Target): void => {
    const found = blockOf(target);
    if (typeof found !== 'string') act(found.overview, found.block);
  };
}

/** Whether the block `target` names points at code, which its menu lists going to. */
function hasCode(target: Target): boolean {
  const found = blockOf(target);
  return typeof found === 'string' || codeIn(found.overview, found.block) !== undefined;
}

/** Scrolls the overview on screen. */
function scrolling(how: Scroll) {
  return { run: withOverview((overview) => scroll(overview, how)), enabled: overviewNow };
}

/** Moves to the next or previous block. */
function moving(by: 1 | -1) {
  return {
    run: withOverview((overview) => {
      const next = nextBlock(overview, by);
      if (typeof next !== 'string') focusBlock(overview, next);
    }),
    enabled: () => {
      const overview = onScreen();
      if (typeof overview === 'string') return overview;
      const next = nextBlock(overview, by);
      return typeof next === 'string' ? next : true;
    },
  };
}

/** Moves to the next or previous link, part or control in the block that has focus. */
function linking(by: 1 | -1) {
  return {
    run: withOverview((overview) => {
      const next = nextLink(overview, by);
      if (typeof next === 'string') return;
      if (next instanceof HTMLElement && next.hasAttribute('data-lo-block')) {
        focusBlock(overview, next);
      } else {
        focusLink(overview, next);
      }
    }),
    enabled: () => {
      const overview = onScreen();
      if (typeof overview === 'string') return overview;
      const next = nextLink(overview, by);
      return typeof next === 'string' ? next : true;
    },
  };
}

/** Steps the walkthrough or tabs in the block that has focus. */
function stepping(by: 1 | -1) {
  return {
    run: withBlock((_overview, block) => step(block, by)),
    enabled: onBlock((_overview, block) => stepsIn(block)),
  };
}

/** What `act` calls a block's command on the block `target` names, as its chip and menu say it. */
function naming(act: (overview: DrawnOverview, block: HTMLElement) => string | undefined) {
  return (target: Target): string | undefined => {
    const found = blockOf(target);
    return typeof found === 'string' ? undefined : act(found.overview, found.block);
  };
}

/** What main last said of the overview on screen, if it's said anything. */
function stateNow() {
  const tab = activeTab();
  return tab?.kind === 'pull' ? states.get(tab.id) : undefined;
}

/** Whether reading the ref again could find more: its last read failed, or it's read only once. */
function lookAgain(state: ReturnType<typeof stateNow>): boolean {
  return Boolean(state?.problem) || state?.watching === false;
}

export default {
  commands: handlers(keys, {
    show: showingMiddle(OVERVIEW_VIEW),
    nextBlock: moving(1),
    previousBlock: moving(-1),
    nextLink: linking(1),
    previousLink: linking(-1),
    nextStep: { ...stepping(1), named: naming((_overview, block) => stepName(block)) },
    previousStep: stepping(-1),
    follow: {
      run: (target) => {
        const loose = target.kind === 'none' ? looseOnScreen() : undefined;
        if (loose) loose.click();
        else withBlock(follow)(target);
      },
      enabled: (target) => {
        if (target.kind === 'none' && looseOnScreen()) return true;
        return onBlock((overview, block) => {
          const found = followOf(overview, block);
          return typeof found === 'string' ? found : true;
        })(target);
      },
      listed: hasCode,
      named: naming(followName),
    },
    scrollDown: scrolling('down'),
    scrollUp: scrolling('up'),
    top: scrolling('top'),
    bottom: scrolling('bottom'),
    pageDown: scrolling('pageDown'),
    pageUp: scrolling('pageUp'),
    loadNewer: {
      run: () => {
        const tab = activeTab();
        if (tab?.kind === 'pull') loadNewer(tab.id);
      },
      enabled: () => (stateNow()?.newer ? true : 'This is the latest overview'),
      listed: () => Boolean(stateNow()?.newer),
    },
    retry: {
      run: () => {
        const tab = activeTab();
        if (tab?.kind === 'pull') readAgain(tab.id);
      },
      // After a failed read, or where main reads the ref once and doesn't watch it: a look again.
      enabled: () => (lookAgain(stateNow()) ? true : 'Nothing to try again'),
      listed: () => lookAgain(stateNow()),
    },
    copyPrompt: {
      run: async () => {
        const tab = activeTab();
        const prompt = promptOnScreen();
        if (tab?.kind === 'pull' && typeof prompt === 'string') await copyPrompt(tab.id, prompt);
      },
      enabled: () => {
        const prompt = promptOnScreen();
        return typeof prompt === 'string' || prompt.why;
      },
    },
    installSkill: {
      run: async () => {
        await installSkill();
      },
      enabled: installable,
    },
    copyInstallCommand: { run: () => copyInstallCommand() },
  }),
  views: [
    // The first middle view, before the diff (20).
    defineView(middle, {
      id: OVERVIEW_VIEW,
      order: 10,
      label: 'Overview',
      kind: 'reading',
      // A pull request with no overview, or a run of layers, which has none, has nothing to read
      // beside the code: the timeline is.
      empty: (tab) =>
        runOf(tab) !== undefined || standingOf(states.get(tab), checked.get(tab)).kind === 'none',
      mark: OverviewMark,
      render: ({ tab, shown }) => createElement(OverviewView, { tab, shown }),
      present: overviews,
    }),
    defineView(status, {
      id: 'overview.status',
      order: 30,
      render: ({ tab }) => createElement(OverviewStatus, { tab }),
      present: overviews,
    }),
    // Settings › Pull requests, first, before what a tab opens on (10). It stays while they're off,
    // to turn them on again.
    settingRow(on, { order: 5 }),
    // The welcome's step that says what an overview is: first, before what a tab opens on (20).
    defineView(overviewRows, {
      id: 'overview.onRow',
      order: 10,
      render: () => createElement(OverviewsRow),
    }),
    // After the welcome screen's `lo` command (10) and its PR links (20).
    defineView(setup, {
      id: 'overview.skillStep',
      order: 30,
      render: () => createElement(SkillStep),
      present: overviews,
    }),
    // Settings › Integrations, after the `lo` command (10).
    SkillRow,
    InstallCommandRow,
    settingRow(auto, { order: 40 }),
  ],
  start() {
    followSkill();
    followMarkers();
    // `yy` in a block's code copies from it, as in the diff.
    setCodeElsewhere(blockCode);
    // Off, the overview's commands go with its views, and what main said of each tab's overview;
    // on again, each tab's comes back as main reads it.
    let taken = true;
    followOverviews((now) => {
      registry().setOff(COMMANDS, !now);
      if (now === taken) return;
      taken = now;
      if (!now) {
        takeOverviews(false, []);
        return;
      }
      openViews()
        // Unless they were turned off again meanwhile.
        .then((open) => {
          if (taken) takeOverviews(true, open);
        })
        .catch((error: unknown) => console.error("Lo couldn't list the tabs:", error));
    });
    main().subscribe('state', takeState);
    main().subscribe('store', takeStore);
    client(revisionsContract).subscribe('comparison', takeRevisions);
    // Each view of a pull request's tab keeps its overview until the tab closes.
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const ids = new Set(viewIds(open));
      keepOnly(ids);
      keepPlaces(ids);
      keepSinceOnly(ids);
      keepMarkersOnly(ids);
    });
    openViews()
      .then(catchUp)
      .catch((error: unknown) => console.error("Lo couldn't list the tabs:", error));
  },
} satisfies WindowFeature;
