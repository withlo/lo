// The comments feature in the window: each view's review threads, as main sends them, placed under
// their lines in the view's diff and drawn there, and counted on each file's header and its row in
// the tree; and posts' text, as other features draw it through `Post`, from the HTML main reads for
// the posts on screen. What it keeps of a view goes as the view's tab closes.

import type { WindowFeature } from '../../../window/features.ts';
import { setThreader, threadsChanged } from '../../diff/window/shared.ts';
import { viewIds } from '../../tab/contract.ts';
import { fileCountsChanged, setFileCounts } from '../../tree/window/shared.ts';
import { main, tabs } from './main.ts';
import { renderThreads } from './render.ts';
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
  start() {
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(viewIds(open))));
    main().subscribe('threads', (view) => {
      if (takeThreads(view)) threadsChanged(view.id);
    });
    main().subscribe('review', takeReview);
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
  },
} satisfies WindowFeature;
