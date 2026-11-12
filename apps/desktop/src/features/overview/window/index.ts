// The overview feature in the window: each pull request's tab's overview, checked as main reads
// it, shown as the first of the tab's middle views, with its mark in the view switch and what it
// says in the status bar; the prompt `ya` copies; the setting for what a tab opens on; and the
// overview skill's rows.

import { handlers, type Target } from '@lo/ui/commands';
import { closeCards } from '@lo/ui/overview';
import { createElement } from 'react';

import { overlay } from '../../../window/commands/overlays.tsx';
import { escapeToMiddle } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { commandLine } from '../../open/window/shared.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { opening } from '../../settings/window/shared.ts';
import { activeTab, middle, status } from '../../tab/window/shared.ts';
import { setup } from '../../welcome/window/shared.ts';
import keys from '../keys.ts';
import { copyPrompt, promptNow } from './copy.ts';
import { OVERVIEW_VIEW } from './labels.ts';
import { main, tabs } from './main.ts';
import { OverviewMark } from './Mark.tsx';
import { OpenRow } from './OpenRow.tsx';
import { OverviewView } from './Overview.tsx';
import { SkillRow, SkillStep } from './Rows.tsx';
import {
  besideFor,
  besides,
  blockAt,
  closeBesideAt,
  codeIn,
  drawnIn,
  focusBlock,
  focusLink,
  follow,
  followOf,
  keepPlaces,
  loadNewer,
  looseControl,
  nextBlock,
  nextLink,
  scroll,
  step,
  stepsIn,
  toggleBeside,
  type DrawnOverview,
  type Scroll,
} from './follow.ts';
import { followSkill, installSkill } from './skill.ts';
import { keepSinceOnly } from './since.ts';
import { OverviewStatus } from './Status.tsx';
import { catchUp, keepOnly, states, takeRevisions, takeState } from './store.ts';

/** The prompt the overview of the pull request on screen offers, or why there's none. */
function promptOnScreen(): string | { why: string } {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return { why: 'There’s no pull request on screen.' };
  return promptNow(tab) ?? { why: 'There’s no prompt for this pull request’s overview now.' };
}

/** The overview drawn in the tab on screen, or why a key for it can't run. */
function onScreen(): DrawnOverview | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  return drawnIn(tab.id) ?? 'There’s no overview on screen.';
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
  if (target.kind === 'none') return 'No block has focus. ] b goes to the next one.';
  const block = blockAt(overview, target);
  return block ? { overview, block } : 'That block isn’t in the overview on screen.';
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

/** Whether the block `target` names points at code, which its menu lists going to and showing beside. */
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

/** What main last said of the overview on screen, if it's said anything. */
function stateNow() {
  const tab = activeTab();
  return tab?.kind === 'pull' ? states.get(tab.id) : undefined;
}

export default {
  commands: handlers(keys, {
    nextBlock: moving(1),
    previousBlock: moving(-1),
    nextLink: linking(1),
    previousLink: linking(-1),
    nextStep: stepping(1),
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
    },
    beside: {
      run: (target) => {
        const overview = onScreen();
        if (typeof overview === 'string') return;
        const found = blockOf(target);
        toggleBeside(overview, typeof found === 'string' ? undefined : found.block);
      },
      enabled: (target) => {
        const overview = onScreen();
        if (typeof overview === 'string') return overview;
        if (besides.get(overview.tab) !== undefined) return true;
        const found = blockOf(target);
        const chosen = besideFor(overview, typeof found === 'string' ? undefined : found.block);
        return typeof chosen === 'string' ? chosen : true;
      },
      listed: hasCode,
    },
    closeBeside: {
      run: () => {
        // A term's card closes first, as `Esc` closes it anywhere in the overview.
        if (closeCards()) return;
        const overview = onScreen();
        if (typeof overview !== 'string' && closeBesideAt(overview)) return;
        escapeToMiddle();
      },
      enabled: () => {
        const tab = activeTab();
        if (tab?.kind === 'pull' && besides.get(tab.id) !== undefined) return true;
        // From the palette or key help, it only closes the code beside. Its key, which reaches it
        // only in the overview, still closes a term's card or gives the overview focus.
        return overlay() === undefined ? true : 'There’s no code beside the overview.';
      },
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
      enabled: () => (stateNow()?.newer ? true : 'No newer overview was pushed.'),
      listed: () => Boolean(stateNow()?.newer),
    },
    retry: {
      run: () => {
        const tab = activeTab();
        if (tab?.kind !== 'pull') return;
        main()
          .retry({ id: tab.id })
          .catch((error: unknown) => console.error("Lo couldn't read the overview again:", error));
      },
      enabled: () => (stateNow()?.problem ? true : 'The overview was read without a problem.'),
      listed: () => Boolean(stateNow()?.problem),
    },
    copyPrompt: {
      run: async () => {
        const prompt = promptOnScreen();
        if (typeof prompt === 'string') await copyPrompt(prompt);
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
    },
  }),
  views: [
    // The first middle view, before the diff (20).
    defineView(middle, {
      id: OVERVIEW_VIEW,
      order: 10,
      label: 'Overview',
      mark: OverviewMark,
      render: ({ tab, shown }) => createElement(OverviewView, { tab, shown }),
    }),
    defineView(status, {
      id: 'overview.status',
      order: 30,
      render: ({ tab }) => createElement(OverviewStatus, { tab }),
    }),
    // Before the diff's layout (20), in Settings' Opening PRs.
    defineView(opening, {
      id: 'overview.open',
      order: 10,
      render: () => createElement(OpenRow),
    }),
    // After the welcome screen's `lo` command (10) and its PR links (20).
    defineView(setup, {
      id: 'overview.skillStep',
      order: 30,
      render: () => createElement(SkillStep),
    }),
    defineView(commandLine, {
      id: 'overview.skillRow',
      order: 10,
      render: () => createElement(SkillRow),
    }),
  ],
  start() {
    followSkill();
    main().subscribe('state', takeState);
    client(revisionsContract).subscribe('comparison', takeRevisions);
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const ids = new Set(open.map(({ id }) => id));
      keepOnly(ids);
      keepPlaces(ids);
      keepSinceOnly(ids);
    });
    tabs()
      .list()
      .then(({ tabs: open }) =>
        catchUp(open.filter(({ kind }) => kind === 'pull').map(({ id }) => id)),
      )
      .catch((error: unknown) => console.error("Lo couldn't list the tabs:", error));
  },
} satisfies WindowFeature;
