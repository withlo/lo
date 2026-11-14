// The comments feature in the window: each view's review threads, as main sends them, placed under
// their lines in the view's diff and drawn there, and counted on each file's header and its row in
// the tree; the threads panel, in the tab's right panel, with its keys and the header toggle's
// count, and each stack layer's unresolved threads, for the layer on screen; posts' text, as other
// features draw it through `Post`, from the HTML main reads for the posts on screen; writing
// comments: the keys that open a comment box in the diff, the box's frame, its draft, which main
// keeps until it's sent, and the files attached to it; and acting on threads, in the diff and the
// panel: replying, resolving, and editing and deleting your comments, with the dialog that asks
// before a delete. The threads on an overview's code blocks are drawn under their lines too, and
// `c` there opens a box under them. What it keeps of a view goes as the view's tab closes.

import { handlers, type HeaderTarget, type LineTarget, type Target } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { onDiffDrawn, setThreader, threadsChanged, writingDiff } from '../../diff/window/shared.ts';
import {
  blockLines,
  blockThreadsChanged,
  isCodeBlock,
  setBlockThreads,
} from '../../overview/window/shared.ts';
import { setLayerCounts } from '../../stacks/window/shared.ts';
import { viewIds } from '../../tab/contract.ts';
import { activeTab, dialogs, right, type PullTab } from '../../tab/window/shared.ts';
import { fileCountsChanged, setFileCounts } from '../../tree/window/shared.ts';
import keys from '../keys.ts';
import { edit, remove, reply, resolve, takeActs, type ThreadKeyTarget } from './acts.ts';
import { threadsOnBlock } from './blocks.ts';
import {
  canWrite,
  catchUpDrafts,
  comment,
  commentOnBlock,
  commentOnFile,
  offering,
  frameWith,
  keepBoxesOf,
  knowPull,
  restore,
  restoreBlock,
  saveAll,
  takeDrafts,
  takeOffer,
} from './boxes.ts';
import { DeleteDialog } from './DeleteDialog.tsx';
import { frameOf } from './Frame.tsx';
import { main, tabs } from './main.ts';
import { inPanel, moveRow, onThread, showTarget, stepFilter } from './panel.ts';
import { ThreadsPanel, UnresolvedCount, unresolvedOf } from './ThreadsPanel.tsx';
import { renderThreads } from './render.ts';
import { keepOnly } from './store.ts';
import { checkUploads, keepUploadsOf, takeProgress } from './uploads.ts';
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

/** The pull request's tab on screen, where a comment can be written on `target`, a code block's. */
function onBlock(target: Target): PullTab | string {
  const tab = writable();
  if (typeof tab === 'string') return tab;
  const found = blockLines(tab.id, target);
  return typeof found === 'string' ? found : tab;
}

/** Says tab `view`'s threads changed, wherever they're drawn: its diff and its code blocks. */
function changed(view: string): void {
  threadsChanged(view);
  blockThreadsChanged(view);
}

/** Opens a box as `c`, `C` or `s` do. */
function writing(how: 'review' | 'now', suggest = false) {
  return (target: LineTarget | HeaderTarget): void => {
    const tab = inDiff();
    if (typeof tab !== 'string') void comment(tab, target, how, suggest);
  };
}

/** Whether view `view`'s threads' first read has ended: asked of main once, if it's said nothing. */
function settled(view: string): boolean {
  const threads = held.get(view).threads;
  if (threads === undefined) catchUp(view, () => changed(view));
  return threads !== undefined && threads.status !== 'loading';
}

/** Acts on a thread as `r`, `x`, `i` or `dd` do. */
function actOn(run: (tab: PullTab, target: ThreadKeyTarget) => unknown) {
  return (target: ThreadKeyTarget): void => {
    const tab = writable();
    if (typeof tab !== 'string') void run(tab, target);
  };
}

export default {
  commands: handlers(keys, {
    comment: { run: writing('review'), enabled: enabled(inDiff) },
    commentNow: { run: writing('now'), enabled: enabled(inDiff) },
    suggest: { run: writing('review', true), enabled: enabled(inDiff) },
    commentOnBlock: {
      run: (target) => {
        const tab = onBlock(target);
        if (typeof tab !== 'string') void commentOnBlock(tab, target, 'review');
      },
      enabled: (target) => {
        const tab = onBlock(target);
        return typeof tab === 'string' ? tab : true;
      },
      // On a block's menu, only a code block's.
      listed: (target) => {
        const tab = activeTab();
        return target.kind !== 'block' || (tab?.kind === 'pull' && isCodeBlock(tab.id, target));
      },
    },
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
    reply: { run: actOn(reply), enabled: enabled(writable) },
    resolve: { run: actOn(resolve), enabled: enabled(writable) },
    edit: { run: actOn(edit), enabled: enabled(writable) },
    remove: { run: actOn(remove), enabled: enabled(writable) },
    discard: offering('discard'),
    sendAnyway: offering('sendAnyway'),
    moveToFile: offering('onFile'),
    loadNewer: offering('loadNewer'),
    showLatest: offering('showLatest'),
    nextThread: { run: () => moveRow(1), enabled: inPanel },
    previousThread: { run: () => moveRow(-1), enabled: inPanel },
    showThread: { run: showTarget, enabled: onThread },
    filterThreads: { run: stepFilter, enabled: inPanel },
    resolveInPanel: {
      run: actOn(resolve),
      enabled: (target) => {
        const on = onThread(target);
        return on === true ? enabled(writable)() : on;
      },
    },
  }),
  views: [
    defineView(right, {
      id: 'comments.panel',
      order: 10,
      render: ({ tab }) => createElement(ThreadsPanel, { tab }),
      count: UnresolvedCount,
    }),
    // After the other features' dialogs: one opens at a time.
    defineView(dialogs, {
      id: 'comments.delete',
      order: 40,
      render: () => createElement(DeleteDialog),
    }),
  ],
  start() {
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const kept = new Set(viewIds(open));
      keepOnly(kept);
      keepBoxesOf(kept);
      keepUploadsOf(kept);
    });
    main().subscribe('drafts', takeDrafts);
    main().subscribe('uploads', takeProgress);
    frameWith(frameOf);
    onDiffDrawn((view) => {
      catchUpDrafts(view);
      // Before a box opens, main says whether the account can upload, so its box says so as it's
      // drawn, not after.
      void checkUploads(view);
      queueMicrotask(() => restore(view));
    });
    // What waits to be saved is saved as the window goes.
    window.addEventListener('pagehide', saveAll);
    main().subscribe('threads', (view) => {
      if (takeThreads(view)) changed(view.id);
    });
    main().subscribe('review', takeReview);
    main().subscribe('acts', takeActs);
    setThreader({
      threadsIn(view, drawn) {
        // A view drawn before main said anything of it asks main once.
        if (held.get(view).threads === undefined) catchUp(view, () => changed(view));
        const before = countsIn(view);
        const placed = placedIn(view, drawn);
        if (!sameCounts(before, placed.byKey)) fileCountsChanged(view);
        return placed;
      },
      render(tab, toggle) {
        knowPull(tab);
        return renderThreads(tab, toggle);
      },
      settled,
    });
    setBlockThreads({
      threadsOn(block) {
        const threads = held.get(block.tab).threads;
        if (threads === undefined) catchUp(block.tab, () => changed(block.tab));
        return threads?.status === 'run' ? [] : threadsOnBlock(threads?.threads ?? [], block);
      },
      settled,
      render(tab, toggle) {
        knowPull(tab);
        return renderThreads(tab, toggle);
      },
      drawn: restoreBlock,
    });
    setFileCounts({ countsIn });
    setLayerCounts({
      unresolvedIn: (view) => unresolvedOf(held.get(view).threads),
      subscribe: (listener) => held.subscribe(listener),
    });
  },
} satisfies WindowFeature;
