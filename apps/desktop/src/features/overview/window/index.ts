// The overview feature in the window: each pull request's tab's overview, checked as main reads
// it, shown as the first of the tab's middle views, with its mark in the view switch and what it
// says in the status bar; the prompt `ya` copies; the setting for what a tab opens on; and the
// overview skill's rows.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

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
import { followSkill, installSkill } from './skill.ts';
import { OverviewStatus } from './Status.tsx';
import { catchUp, keepOnly, takeRevisions, takeState } from './store.ts';

/** The prompt the overview of the pull request on screen offers, or why there's none. */
function promptOnScreen(): string | { why: string } {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return { why: 'There’s no pull request on screen.' };
  return promptNow(tab) ?? { why: 'There’s no prompt for this pull request’s overview now.' };
}

export default {
  commands: handlers(keys, {
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
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(open.map(({ id }) => id))));
    tabs()
      .list()
      .then(({ tabs: open }) =>
        catchUp(open.filter(({ kind }) => kind === 'pull').map(({ id }) => id)),
      )
      .catch((error: unknown) => console.error("Lo couldn't list the tabs:", error));
  },
} satisfies WindowFeature;
