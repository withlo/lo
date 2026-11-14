// The comments feature in the window: each view's review threads, as main sends them, placed under
// their lines in the view's diff and drawn there, and counted on each file's header and its row in
// the tree; the threads panel, in the tab's right panel, with its keys and the header toggle's
// count, and each stack layer's unresolved threads, for the layer on screen; posts' text, as other
// features draw it through `Post`, from the HTML main reads for the posts on screen; and writing
// comments: the keys that open a comment box in the diff, the box's frame, and its draft, which
// main keeps until it's sent. What it keeps of a view goes as the view's tab closes.

import { handlers, type HeaderTarget, type LineTarget } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { onDiffDrawn, setThreader, threadsChanged, writingDiff } from '../../diff/window/shared.ts';
import { setLayerCounts } from '../../stacks/window/shared.ts';
import { viewIds } from '../../tab/contract.ts';
import { activeTab, right, type PullTab } from '../../tab/window/shared.ts';
import { fileCountsChanged, setFileCounts } from '../../tree/window/shared.ts';
import keys from '../keys.ts';
import {
  canWrite,
  catchUpDrafts,
  comment,
  commentOnFile,
  offering,
  frameWith,
  keepBoxesOf,
  knowPull,
  restore,
  saveAll,
  takeDrafts,
  takeOffer,
} from './boxes.ts';
import { frameOf } from './Frame.tsx';
import { main, tabs } from './main.ts';
import { inPanel, moveRow, onThread, showTarget, stepFilter } from './panel.ts';
import { ThreadsPanel, UnresolvedCount, unresolvedOf } from './ThreadsPanel.tsx';
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

/** The pull request's tab on screen, where a comment can be written, or why one can't. */
function writable(): PullTab | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  const can = canWrite(tab.id);
  if (can !== true) return can;
  return tab;
}

/** The same, in the diff the keys act on. */
function inDiff(): PullTab | string {
  const tab = writable();
  if (typeof tab === 'string') return tab;
  if (writingDiff(tab.id, true)) return tab;
  return writingDiff(tab.id)
    ? 'Comments are written in the diff, not in the code beside another view.'
    : 'The diff isn’t drawn yet.';
}

function enabled(check: () => PullTab | string) {
  return (): true | string => {
    const tab = check();
    return typeof tab === 'string' ? tab : true;
  };
}

/** Opens a box as `c`, `C` or `s` do. */
function writing(how: 'review' | 'now', suggest = false) {
  return (target: LineTarget | HeaderTarget): void => {
    const tab = inDiff();
    if (typeof tab !== 'string') void comment(tab, target, how, suggest);
  };
}

export default {
  commands: handlers(keys, {
    comment: { run: writing('review'), enabled: enabled(inDiff) },
    commentNow: { run: writing('now'), enabled: enabled(inDiff) },
    suggest: { run: writing('review', true), enabled: enabled(inDiff) },
    commentOnFile: {
      run: (target) => {
        const tab = writable();
        if (typeof tab === 'string') return;
        if (target.kind === 'file') void commentOnFile(tab, target.file);
        else void comment(tab, target, 'review');
      },
      enabled: enabled(writable),
    },
    // `⏎` is Vim's but just after a line refused a comment.
    onFileInstead: {
      run: () => {
        const tab = activeTab();
        if (tab?.kind !== 'pull' || takeOffer(tab)) return;
        writingDiff(tab.id, true)?.vim(['<CR>']);
      },
    },
    discard: offering('discard'),
    sendAnyway: offering('sendAnyway'),
    moveToFile: offering('onFile'),
    loadNewer: offering('loadNewer'),
    showLatest: offering('showLatest'),
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
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const kept = new Set(viewIds(open));
      keepOnly(kept);
      keepBoxesOf(kept);
    });
    main().subscribe('drafts', takeDrafts);
    frameWith(frameOf);
    onDiffDrawn((view) => {
      catchUpDrafts(view);
      queueMicrotask(() => restore(view));
    });
    // What waits to be saved is saved as the window goes.
    window.addEventListener('pagehide', saveAll);
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
      render(tab, toggle) {
        knowPull(tab);
        return renderThreads(tab, toggle);
      },
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
