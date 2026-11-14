// The timeline feature in the window: each pull request's tab's timeline, the third of its middle
// views, read the first time it's shown, its keys, and its rows' menu: `c` comments on the pull
// request in the box at its end, and `i` and `dd` edit and delete your comments there.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import {
  deletePullComment,
  editPullComment,
  focusCommentBox,
  onCommentWritten,
} from '../../comments/window/shared.ts';
import { middle, type PullTab } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { showDiff } from '../../diff/window/shared.ts';
import {
  compare,
  move,
  nextLink,
  onRow,
  onScreen,
  openOnGithub,
  revealHidden,
  seeOlder,
  stillHidden,
} from './actions.ts';
import { main, revisions } from './main.ts';
import type { Row } from './rows.ts';
import { claim, takeRevisions, takeSidebar, takeTimeline } from './store.ts';
import { TimelineMiddle } from './TimelineView.tsx';
import { changeTarget, loginOf } from './yours.ts';

/** Whether there's a timeline on screen for a key to act on, or why not. */
function timelineNow(): true | string {
  const timeline = onScreen();
  return typeof timeline === 'string' ? timeline : true;
}

/** `i` or `dd` on `row` of tab `tab`'s timeline: your comment it is, or why it can't be changed. */
function yourCommentIn(tab: PullTab, row: Row, change: 'edit' | 'delete') {
  return changeTarget(row, stillHidden(tab.id, row), loginOf(tab.id), change);
}

/** Why `change` can't be made to `row` of tab `tab`'s timeline: nothing when it can. */
function whyNot(tab: PullTab, row: Row, change: 'edit' | 'delete'): string | undefined {
  const comment = yourCommentIn(tab, row, change);
  return typeof comment === 'string' ? comment : undefined;
}

export default {
  commands: handlers(keys, {
    down: { run: () => move(1), enabled: timelineNow },
    up: { run: () => move(-1), enabled: timelineNow },
    nextLink: { run: () => nextLink(1), enabled: timelineNow },
    previousLink: { run: () => nextLink(-1), enabled: timelineNow },
    comment: {
      run: () => {
        const timeline = onScreen();
        if (typeof timeline !== 'string') focusCommentBox(timeline.tab);
      },
      enabled: timelineNow,
    },
    editComment: onRow(
      (row, { tab }) => whyNot(tab, row, 'edit'),
      async (row, { tab }) => {
        const comment = yourCommentIn(tab, row, 'edit');
        if (typeof comment !== 'string') await editPullComment(tab, comment);
      },
    ),
    deleteComment: onRow(
      (row, { tab }) => whyNot(tab, row, 'delete'),
      (row, { tab }) => {
        const comment = yourCommentIn(tab, row, 'delete');
        if (typeof comment !== 'string') deletePullComment(tab, comment);
      },
    ),
    showComment: onRow(
      (row, { tab }) =>
        stillHidden(tab.id, row) ? undefined : 'This event isn’t a hidden comment.',
      (row, timeline) => revealHidden(timeline, row.key),
    ),
    showInDiff: onRow(
      (row) =>
        row.kind === 'review' && row.comments > 0 ? undefined : 'This event left no comments.',
      (_, { tab }) => {
        showDiff(tab.id);
      },
    ),
    compare: onRow(
      (row) =>
        row.kind === 'forcePush' && row.compare
          ? undefined
          : 'This event isn’t a force-push Lo can compare.',
      (row, { tab }) => {
        if (row.kind === 'forcePush' && row.compare) {
          compare(tab.id, row.compare.from, row.compare.to);
        }
      },
    ),
    seeOlder: onRow(
      (row) => (row.kind === 'older' ? undefined : 'Every event is in the timeline.'),
      (_, { tab }) => seeOlder(tab),
    ),
    openOnGithub: onRow(
      () => undefined,
      (row, { tab }) => openOnGithub(tab, row),
    ),
  }),
  views: [
    // The third middle view, after the overview (10), the diff (20) and the whole file (25).
    defineView(middle, {
      id: 'timeline.view',
      order: 30,
      label: 'Timeline',
      render: ({ tab, shown }) => createElement(TimelineMiddle, { tab, shown }),
    }),
  ],
  start() {
    main().subscribe('timeline', takeTimeline);
    // What the reader's own write changed shows at once, as it comes.
    onCommentWritten(claim);
    main().subscribe('sidebar', takeSidebar);
    revisions().subscribe('comparison', takeRevisions);
  },
} satisfies WindowFeature;
