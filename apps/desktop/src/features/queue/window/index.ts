import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { dialogs, kinds, onClosed } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  act,
  autoMerge,
  autoMergeName,
  canAct,
  canAutoMerge,
  closedQueue,
  followQueues,
  offersJump,
  openRow,
  sentPlan,
} from './acting.ts';
import {
  canOpenOnGithub,
  canOpenRow,
  canShowQueue,
  canStepBranch,
  move,
  onQueueRow,
  openOnGithub,
  queueOnScreen,
  showQueueTab,
  stepBranch,
} from './actions.ts';
import { main } from './main.ts';
import { QueueConfirm } from './QueueConfirm.tsx';
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
    open: { run: openRow, enabled: canOpenRow, listed: onQueueRow },
    remove: {
      run: (target) => act('remove', target),
      enabled: (target) => canAct('remove', target),
      listed: onQueueRow,
    },
    jump: {
      run: (target) => act('jump', target),
      enabled: (target) => canAct('jump', target),
      // Offered only to the repository's admins, whom GitHub lets move an entry.
      listed: (target) => onQueueRow(target) && offersJump(target),
    },
    autoMerge: {
      run: autoMerge,
      enabled: canAutoMerge,
      listed: onQueueRow,
      named: autoMergeName,
    },
    nextBranch: { run: () => stepBranch(1), enabled: canStepBranch },
    previousBranch: { run: () => stepBranch(-1), enabled: canStepBranch },
    openOnGithub: { run: openOnGithub, enabled: canOpenOnGithub, listed: onQueueRow },
  }),
  views: [
    // A merge queue is drawn in its tab, and in no other.
    defineView(kinds, {
      id: 'queue.tab',
      order: 0,
      render: ({ tab }) => (tab.kind === 'queue' ? createElement(QueueTabView, { tab }) : null),
    }),
    // With the other dialogs that write: submit, delete, merging.
    defineView(dialogs, {
      id: 'queue.confirm',
      order: 40,
      render: () => createElement(QueueConfirm),
    }),
  ],
  start() {
    main().subscribe('queue', showQueue);
    main().subscribe('sent', sentPlan);
    onClosed(forgetQueue);
    onClosed(closedQueue);
    followQueues();
  },
} satisfies WindowFeature;
