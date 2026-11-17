// The merge feature in the window: the header's merge status and the merge panel it opens, with
// the panel's keys; the dialog that confirms a merge and follows it, and the banner for one that
// needs the reader. Main sends each view's status, and each merge it sent, as they change; a closed
// view's status is forgotten.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { activeTab, banners, dialogs, headerStatus, onClosed } from '../../tab/window/shared.ts';
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
import { MergeConfirm } from './MergeConfirm.tsx';
import { MergeHeader } from './MergeHeader.tsx';
import { askAgain, canMerge, catchUpJobs, heardJob, mergeFromPanel } from './merging.ts';
import { OutcomeBanner, outcomeSwitch } from './OutcomeBanner.tsx';
import { forgetStatus, jobOf, takeStatus } from './store.ts';

/** The merge of the pull request on screen whose end Lo can't tell, or why there's none. */
function unsure(): { key: string } | string {
  const tab = activeTab();
  const job = tab?.kind === 'pull' ? jobOf(tab) : undefined;
  return job?.state.kind === 'unknown' ? job : 'Lo knows how its last merge of this went.';
}

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
    merge: { run: mergeFromPanel, enabled: canMerge },
    askAgain: {
      run: () => {
        const job = unsure();
        if (typeof job !== 'string') askAgain(job.key);
      },
      enabled: () => {
        const job = unsure();
        return typeof job === 'string' ? job : true;
      },
      listed: (target) => onStatus(target) && typeof unsure() !== 'string',
    },
    close: { run: () => closePanel() },
    leaveCommit: { run: leaveCommit },
  }),
  views: [
    defineView(headerStatus, {
      id: 'merge.status',
      order: 10,
      render: ({ tab }) => createElement(MergeHeader, { tab }),
    }),
    // With the other dialogs that write: submit, delete.
    defineView(dialogs, {
      id: 'merge.confirm',
      order: 40,
      render: () => createElement(MergeConfirm),
    }),
    // Before the other features' banners: a merge that failed matters more than any of them.
    defineView(banners, {
      id: 'merge.outcome',
      order: 5,
      render: ({ tab }) => createElement(OutcomeBanner, { tab }),
      ...outcomeSwitch,
    }),
  ],
  start() {
    main().subscribe('status', takeStatus);
    main().subscribe('jobs', (job) => heardJob(job));
    onClosed(forgetStatus);
    catchUpJobs();
  },
} satisfies WindowFeature;
