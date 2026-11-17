// The merge feature in the window: the header's merge status and the merge panel it opens, with
// the panel's keys, and the banner for a pull request that left its merge queue. Main sends each
// view's status, and its place in a merge queue, as they change; a closed view's are forgotten.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners, headerStatus, onClosed } from '../../tab/window/shared.ts';
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
import { LeftBanner, leftSwitch } from './LeftBanner.tsx';
import { main } from './main.ts';
import { MergeHeader } from './MergeHeader.tsx';
import { forgetQueued, takeQueued } from './queued.ts';
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
    // Before the other features' banners: the reader learns it won't merge as they expected.
    defineView(banners, {
      id: 'merge.left',
      order: 6,
      render: ({ tab }) => createElement(LeftBanner, { tab }),
      ...leftSwitch,
    }),
  ],
  start() {
    main().subscribe('status', takeStatus);
    main().subscribe('queued', takeQueued);
    onClosed(forgetStatus);
    onClosed(forgetQueued);
  },
} satisfies WindowFeature;
