// The comments feature in the window: each view's review threads, as main sends them, placed under
// their lines in the view's diff and drawn there, and counted on each file's header and its row in
// the tree; the threads panel, in the tab's right panel, with its keys and the header toggle's
// count, and each stack layer's unresolved threads, for the layer on screen; and posts' text, as
// other features draw it through `Post`, from the HTML main reads for the posts on screen. What it
// keeps of a view goes as the view's tab closes.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { setThreader, threadsChanged } from '../../diff/window/shared.ts';
import { setLayerCounts } from '../../stacks/window/shared.ts';
import { viewIds } from '../../tab/contract.ts';
import { right } from '../../tab/window/shared.ts';
import { fileCountsChanged, setFileCounts } from '../../tree/window/shared.ts';
import keys from '../keys.ts';
import { main, tabs } from './main.ts';
import { inPanel, moveRow, onThread, showTarget, stepFilter } from './panel.ts';
import { ThreadsPanel, UnresolvedCount, unresolvedOf } from './ThreadsPanel.tsx';
import { renderThreads } from './render.ts';
import { revisions, takeRevisions } from './revisions.ts';
import { keepOnly } from './store.ts';
import {
  catchUp,
  countsIn,
  held,
  placedIn,
  sameCounts,
  takeReview,
  takeThreads,
} from './threads.ts';

export default {
  commands: handlers(keys, {
    nextThread: { run: () => moveRow(1), enabled: inPanel },
    previousThread: { run: () => moveRow(-1), enabled: inPanel },
    showThread: { run: showTarget, enabled: onThread },
    filterThreads: { run: stepFilter, enabled: inPanel },
  }),
  views: [
    defineView(right, {
      id: 'comments.panel',
      order: 10,
      render: ({ tab }) => createElement(ThreadsPanel, { tab }),
      count: UnresolvedCount,
    }),
  ],
  start() {
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(viewIds(open))));
    main().subscribe('threads', (view) => {
      if (takeThreads(view)) threadsChanged(view.id);
    });
    main().subscribe('review', takeReview);
    revisions().subscribe('comparison', takeRevisions);
    setThreader({
      threadsIn(view, drawn) {
        // A view drawn before main said anything of it asks main once.
        if (held.get(view).threads === undefined) catchUp(view, () => threadsChanged(view));
        const before = countsIn(view);
        const placed = placedIn(view, drawn);
        if (!sameCounts(before, placed.byKey)) fileCountsChanged(view);
        return placed;
      },
      render: renderThreads,
      settled(view) {
        const threads = held.get(view).threads;
        if (threads === undefined) catchUp(view, () => threadsChanged(view));
        return threads !== undefined && threads.status !== 'loading';
      },
    });
    setFileCounts({ countsIn });
    setLayerCounts({
      unresolvedIn: (view) => unresolvedOf(held.get(view).threads),
      subscribe: (listener) => held.subscribe(listener),
    });
  },
} satisfies WindowFeature;
