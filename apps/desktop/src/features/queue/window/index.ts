import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { kinds, onClosed } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  canOpenOnGithub,
  canOpenRow,
  canShowQueue,
  canStepBranch,
  move,
  openOnGithub,
  openRow,
  queueOnScreen,
  showQueueTab,
  stepBranch,
} from './actions.ts';
import { main } from './main.ts';
import { QueueTabView } from './QueueTabView.tsx';
import { forgetQueue, showQueue } from './store.ts';

/** Why `j` and `k` can't move, or `true`. */
function canMove(): true | string {
  const tab = queueOnScreen();
  return typeof tab === 'string' ? tab : true;
}

export default {
  commands: handlers(keys, {
    show: { run: showQueueTab, enabled: canShowQueue },
    down: { run: () => move(1), enabled: canMove },
    up: { run: () => move(-1), enabled: canMove },
    open: { run: openRow, enabled: canOpenRow },
    nextBranch: { run: () => stepBranch(1), enabled: canStepBranch },
    previousBranch: { run: () => stepBranch(-1), enabled: canStepBranch },
    openOnGithub: { run: openOnGithub, enabled: canOpenOnGithub },
  }),
  views: [
    // A merge queue is drawn in its tab, and in no other.
    defineView(kinds, {
      id: 'queue.tab',
      order: 0,
      render: ({ tab }) => (tab.kind === 'queue' ? createElement(QueueTabView, { tab }) : null),
    }),
  ],
  start() {
    main().subscribe('queue', showQueue);
    onClosed(forgetQueue);
  },
} satisfies WindowFeature;
