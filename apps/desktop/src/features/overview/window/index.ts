// The overview feature in the window: each pull request's tab's overview, checked as main reads
// it, for the views that show it; and the overview skill's rows.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { commandLine } from '../../open/window/shared.ts';
import { setup } from '../../welcome/window/shared.ts';
import keys from '../keys.ts';
import { main, tabs } from './main.ts';
import { SkillRow, SkillStep } from './Rows.tsx';
import { followSkill, installSkill } from './skill.ts';
import { catchUp, keepOnly, takeState } from './store.ts';

export default {
  commands: handlers(keys, {
    installSkill: {
      run: async () => {
        await installSkill();
      },
    },
  }),
  views: [
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
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(open.map(({ id }) => id))));
    tabs()
      .list()
      .then(({ tabs: open }) =>
        catchUp(open.filter(({ kind }) => kind === 'pull').map(({ id }) => id)),
      )
      .catch((error: unknown) => console.error("Lo couldn't list the tabs:", error));
  },
} satisfies WindowFeature;
