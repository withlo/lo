// The merge feature in the window: the header's merge status and the merge panel it opens, with
// the panel's keys. Main sends each view's status as it changes; a closed view's is forgotten.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { headerStatus, onClosed } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  canEdit,
  canOpen,
  canStep,
  closePanel,
  edit,
  hasConversation,
  hasPage,
  isOpen,
  leaveCommit,
  move,
  nextConversation,
  onStatus,
  openPanel,
  openReason,
  reasonHasPage,
  stepMethod,
} from './actions.ts';
import { main } from './main.ts';
import { MergeHeader } from './MergeHeader.tsx';
import { forgetStatus, takeStatus } from './store.ts';

export default {
  commands: handlers(keys, {
    panel: { run: () => openPanel(), enabled: canOpen, listed: onStatus },
    down: { run: () => move(1), enabled: isOpen },
    up: { run: () => move(-1), enabled: isOpen },
    open: { run: openReason, enabled: hasPage, listed: reasonHasPage },
    nextMethod: { run: () => stepMethod(1), enabled: canStep },
    previousMethod: { run: () => stepMethod(-1), enabled: canStep },
    edit: { run: edit, enabled: canEdit },
    nextThread: { run: nextConversation, enabled: hasConversation },
    close: { run: () => closePanel() },
    leaveCommit: { run: leaveCommit },
  }),
  views: [
    defineView(headerStatus, {
      id: 'merge.status',
      order: 10,
      render: ({ tab }) => createElement(MergeHeader, { tab }),
    }),
  ],
  start() {
    main().subscribe('status', takeStatus);
    onClosed(forgetStatus);
  },
} satisfies WindowFeature;
