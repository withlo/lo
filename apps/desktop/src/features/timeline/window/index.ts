// The timeline feature in the window: each pull request's tab's timeline, the third of its middle
// views, read the first time it's shown, its keys, and its rows' menu.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { middle } from '../../tab/window/shared.ts';
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
import { takeRevisions, takeSidebar, takeTimeline } from './store.ts';
import { TimelineMiddle } from './TimelineView.tsx';

/** Whether there's a timeline on screen for a key to act on, or why not. */
function timelineNow(): true | string {
  const timeline = onScreen();
  return typeof timeline === 'string' ? timeline : true;
}

export default {
  commands: handlers(keys, {
    down: { run: () => move(1), enabled: timelineNow },
    up: { run: () => move(-1), enabled: timelineNow },
    nextLink: { run: () => nextLink(1), enabled: timelineNow },
    previousLink: { run: () => nextLink(-1), enabled: timelineNow },
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
    main().subscribe('sidebar', takeSidebar);
    revisions().subscribe('comparison', takeRevisions);
  },
} satisfies WindowFeature;
