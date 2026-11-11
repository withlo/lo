import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import { notify } from '../../../window/commands/notices.tsx';
import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { dialogs, header, kinds } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { focusFilter, openRow, pasteLink, stepChosen } from './actions.ts';
import { openBox } from './box.ts';
import { installCommand } from './command.ts';
import CommandLine from './CommandLine.tsx';
import { main } from './main.ts';
import { OpenBox } from './OpenBox.tsx';
import { ReadOnly } from './ReadOnly.tsx';
import { RecentTab } from './Recent.tsx';

export default {
  commands: handlers(keys, {
    box: { run: () => openBox() },
    paste: { run: pasteLink },
    filter: { run: focusFilter },
    openRecent: { run: () => openRow() },
    nextRecent: { run: () => stepChosen(1) },
    previousRecent: { run: () => stepChosen(-1) },
    installCommand: {
      run: async () => {
        await installCommand();
      },
    },
  }),
  views: [
    defineView(dialogs, { id: 'open.box', order: 10, render: () => createElement(OpenBox) }),
    // Recent is drawn in its tab, and in no other.
    defineView(kinds, {
      id: 'open.recent',
      order: 0,
      render: ({ tab }) => (tab.kind === 'recent' ? createElement(RecentTab) : null),
    }),
    // After the revision picker, which waits for an account.
    defineView(header, { id: 'open.readOnly', order: 100, render: ReadOnly }),
    CommandLine,
  ],
  start() {
    // A link another app handed Lo that it couldn't open says why.
    main().subscribe('refused', ({ message }) => notify('Open a link', message));
  },
} satisfies WindowFeature;
