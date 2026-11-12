import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { commandLine } from '../../open/window/shared.ts';
import { setup } from '../../welcome/window/shared.ts';
import keys from '../keys.ts';
import { SkillRow, SkillStep } from './Rows.tsx';
import { followSkill, installSkill } from './skill.ts';

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
  },
} satisfies WindowFeature;
