// The timeline feature in the window: each pull request's tab's timeline, the third of its middle
// views, read the first time it's shown, and its keys.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { middle } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  compare,
  focusedRow,
  movable,
  move,
  onScreen,
  openOnGithub,
  showHidden,
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
    down: { run: () => move(1), enabled: () => movable(1) },
    up: { run: () => move(-1), enabled: () => movable(-1) },
    openOnGithub: { run: openOnGithub, enabled: timelineNow },
    showComment: {
      run: () => {
        const timeline = onScreen();
        if (typeof timeline === 'string') return;
        const row = focusedRow(timeline);
        if (row && stillHidden(timeline.tab.id, row)) showHidden(timeline.tab.id, row.key);
      },
      enabled: () => {
        const timeline = onScreen();
        if (typeof timeline === 'string') return timeline;
        return stillHidden(timeline.tab.id, focusedRow(timeline)) || 'No hidden comment is chosen.';
      },
    },
    compare: {
      run: () => {
        const timeline = onScreen();
        if (typeof timeline === 'string') return;
        const row = focusedRow(timeline);
        if (row?.kind === 'forcePush' && row.compare) {
          compare(timeline.tab.id, row.compare.from, row.compare.to);
        }
      },
      enabled: () => {
        const timeline = onScreen();
        if (typeof timeline === 'string') return timeline;
        const row = focusedRow(timeline);
        if (row?.kind !== 'forcePush') return 'No force-push is chosen.';
        return row.compare ? true : 'Lo can’t compare the revisions of this force-push.';
      },
    },
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
