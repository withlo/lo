// The comments feature in the window: each view's review threads, as main sends them, placed under
// their lines in the view's diff and drawn there, and counted on each file's header and its row in
// the tree; the threads panel, in the tab's right panel, with its keys and the header toggle's
// count, and each stack layer's unresolved threads, for the layer on screen; posts' text, as other
// features draw it through `Post`, from the HTML main reads for the posts on screen; writing
// comments: the keys that open a comment box in the diff, the box's frame, its draft, which main
// keeps until it's sent, and the files attached to it; and acting on threads, in the diff and the
// panel: replying, resolving, and editing and deleting your comments, with the dialog that asks
// before a delete. The threads on an overview's code blocks are drawn under their lines too, and
// `c` there opens a box under them. The status bar says which drafts the diff took down open that
// no box has taken since. What it keeps of a view goes as the view's tab closes.

import { vimOn } from '@lo/ui/code';
import { handlers, type HeaderTarget, type LineTarget, type Target } from '@lo/ui/commands';
import { createElement } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { onDiffDrawn, setThreader, threadsChanged, writingDiff } from '../../diff/window/shared.ts';
import {
  blockLines,
  blockThreadsChanged,
  followOverviews,
  isCodeBlock,
  onOverviewChanged,
  setBlockThreads,
} from '../../overview/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import { settingRow } from '../../settings/window/shared.ts';
import { setLayerCounts } from '../../stacks/window/shared.ts';
import { viewIds } from '../../tab/contract.ts';
import {
  activeTab,
  dialogs,
  right,
  showTabOf,
  status,
  toasts,
  type PullTab,
} from '../../tab/window/shared.ts';
import { fileCountsChanged, setFileCounts } from '../../tree/window/shared.ts';
import keys from '../keys.ts';
import { threads as threadsSetting, vim } from '../settings.ts';
import { DiscardedToast } from './Discarded.tsx';
import KeptRow from './KeptRow.tsx';
import {
  atWork,
  edit,
  keepActsOf,
  remove,
  reply,
  resolve,
  resolvedNow,
  settleActs,
  takeActs,
  threadFor,
  type ThreadKeyTarget,
} from './acts.ts';
import { threadsOnBlock } from './blocks.ts';
import {
  canWrite,
  catchUpDrafts,
  comment,
  commentOnBlock,
  commentOnFile,
  discarding,
  undiscarding,
  offering,
  frameWith,
  keepBoxesOf,
  keptAway,
  landBoxes,
  knowPull,
  noDiff,
  restore,
  reopenAll,
  restoreBlock,
  saveAll,
  showKeptDrafts,
  takeDrafts,
  takeJoined,
  takeOffer,
} from './boxes.ts';
import { DeleteDialog } from './DeleteDialog.tsx';
import { frameOf } from './Frame.tsx';
import { KeptStatus } from './KeptStatus.tsx';
import { main, tabs } from './main.ts';
import {
  canClearFilter,
  clearFilter,
  inPanel,
  moveRow,
  onThread,
  rowsListed,
  showTarget,
  stepFilter,
} from './panel.ts';
import { Said, tell } from './Said.tsx';
import { ThreadsPanel, UnresolvedCount, unresolvedOf } from './ThreadsPanel.tsx';
import { followThreadsMode, threadsMode } from './mode.ts';
import {
  canShowPopover,
  closePopover,
  moveRing,
  pinFirst,
  popoverPinned,
  ringed,
  showPopover,
} from './popover.ts';
import { renderPopover, renderThreads } from './render.ts';
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
import { followVim, switchVim } from './vim.ts';

/** The pull request's tab on screen, where a comment can be written, or why one can't. */
function writable(): PullTab | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  const can = canWrite(tab.id);
  if (can !== true) return can;
  return tab;
}

/** The same, in the diff the keys act on. */
function inDiff(): PullTab | string {
  const tab = writable();
  if (typeof tab === 'string') return tab;
  if (writingDiff(tab.id, true)) return tab;
  return noDiff(tab.id, 'Go to the diff to comment');
}

function enabled(check: () => PullTab | string) {
  return (): true | string => {
    const tab = check();
    return typeof tab === 'string' ? tab : true;
  };
}

/**
 * Whether a thread can be resolved, or a comment of it deleted, on `target`: a comment can be
 * written, and no change to the thread is at work, which is one at a time. Otherwise why not, as
 * the thread's control says it: "Resolving…".
 */
function free(target: ThreadKeyTarget): true | string {
  const tab = writable();
  if (typeof tab === 'string') return tab;
  const row = threadFor(tab.id, target);
  return typeof row === 'string' ? true : (atWork(tab.id, row.id) ?? true);
}

/** Whether the thread on `target` shows as resolved now, a resolve or unresolve asked counted. */
function onResolved(target: ThreadKeyTarget): boolean {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return false;
  const row = threadFor(tab.id, target);
  return typeof row !== 'string' && resolvedNow(tab.id, row);
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
    openThread: { run: showPopover, enabled: canShowPopover },
    closeThread: { run: closePopover, enabled: popoverPinned },
    nextComment: { run: moveRing(1) },
    previousComment: { run: moveRing(-1) },
    reply: { run: actOn(reply), enabled: enabled(writable) },
    resolve: {
      // From the line beside lines, the thread's popover pins first, and that's all.
      run: actOn((tab, target) => {
        if (!pinFirst(tab, target)) resolve(tab, target);
      }),
      enabled: free,
      // Named by what it would do to the thread it's on, as its card shows it: in the thread's own
      // menu without the object.
      named: (target) => (target.kind === 'thread' && onResolved(target) ? 'Unresolve' : undefined),
      labelled: (target) => (onResolved(target) ? 'Unresolve thread' : undefined),
    },
    edit: {
      run: actOn((tab, target) => edit(tab, target, ringed(target))),
      enabled: enabled(writable),
    },
    remove: {
      // From the line beside lines, the thread's popover pins under the dialog that asks.
      run: actOn((tab, target) => {
        pinFirst(tab, target);
        remove(tab, target, ringed(target));
      }),
      enabled: free,
    },
    discard: discarding,
    undiscard: undiscarding,
    sendAnyway: offering('sendAgain'),
    checkAgain: offering('checkAgain'),
    moveToFile: offering('onFile'),
    showLatest: offering('showLatest', 'loadNewer'),
    vim: { run: switchVim, checked: vimOn },
    keptDrafts: {
      run: (target) => {
        if (target.kind !== 'tab') {
          const tab = activeTab();
          if (tab) showKeptDrafts(tab.id);
          return;
        }
        // From Settings, for a pull request whose tab may not be on screen: its tab first, so the
        // list opens over its status bar where it can be seen.
        const view = target.tab;
        showTabOf(view).then(
          () => showKeptDrafts(view),
          (error: unknown) => console.error("Lo couldn't show the tab:", error),
        );
      },
      enabled: (target) => {
        const view = target.kind === 'tab' ? target.tab : activeTab()?.id;
        return view !== undefined && keptAway.get(view).length > 0 ? true : 'No kept drafts';
      },
    },
    nextThread: { run: () => moveRow(1), enabled: rowsListed },
    previousThread: { run: () => moveRow(-1), enabled: rowsListed },
    showThread: { run: showTarget, enabled: onThread },
    filterThreads: { run: stepFilter, enabled: inPanel },
    clearFilter: { run: clearFilter, enabled: canClearFilter },
    resolveInPanel: {
      run: actOn(resolve),
      labelled: (target) => (onResolved(target) ? 'Unresolve thread' : undefined),
      enabled: (target) => {
        const on = onThread(target);
        return on === true && target.kind === 'thread' ? free(target) : on;
      },
    },
  }),
  views: [
    // Settings › Keyboard, first.
    settingRow(vim, { order: 10, id: 'comments.vim' }),
    // Settings › Pull requests, after Diff layout.
    settingRow(threadsSetting, { order: 25 }),
    KeptRow,
    defineView(right, {
      id: 'comments.panel',
      order: 10,
      label: 'Threads',
      render: ({ tab }) => createElement(ThreadsPanel, { tab }),
      count: UnresolvedCount,
    }),
    // After the other features' dialogs: one opens at a time.
    defineView(dialogs, {
      id: 'comments.delete',
      order: 40,
      render: () => createElement(DeleteDialog),
    }),
    // Nothing to see: what the comments say to a screen reader as it happens. Beside the dialogs,
    // outside the toasts' own region: a region inside another is read by one of them at most.
    defineView(dialogs, {
      id: 'comments.said',
      order: 41,
      render: () => createElement(Said),
    }),
    // Under the updates' offer.
    defineView(toasts, {
      id: 'comments.discarded',
      order: 10,
      render: () => createElement(DiscardedToast),
    }),
    // After the diff's.
    defineView(status, {
      id: 'comments.status',
      order: 25,
      render: ({ tab }) => createElement(KeptStatus, { tab }),
    }),
  ],
  start() {
    followVim();
    followThreadsMode();
    // An overview's code blocks are gone while overviews are off, and the comments on them.
    followOverviews((on) => registry().setOff(['comments.commentOnBlock'], !on));
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const kept = new Set(viewIds(open));
      keepOnly(kept);
      keepBoxesOf(kept);
      keepActsOf(kept);
      keepUploadsOf(kept);
    });
    main().subscribe('drafts', takeDrafts);
    main().subscribe('joined', takeJoined);
    main().subscribe('uploads', takeProgress);
    frameWith(frameOf);
    onDiffDrawn((view) => {
      catchUpDrafts(view);
      // Before a box opens, main says whether the account can upload, so its box says so as it's
      // drawn, not after.
      void checkUploads(view);
      queueMicrotask(() => restore(view));
    });
    // A draft written on a block opens under it while the overview has it, and otherwise where it
    // would with none: which, as the overview changes.
    onOverviewChanged(() => queueMicrotask(reopenAll));
    // What waits to be saved is saved as the window goes.
    window.addEventListener('pagehide', saveAll);
    main().subscribe('threads', (view) => {
      if (!takeThreads(view)) return;
      // A change GitHub took that the threads now show is done with, in the same drawing.
      settleActs(view.id);
      changed(view.id);
      // Once they're drawn: a box that showed its comment until its card came goes with it.
      landBoxes(view.id);
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
      mode: threadsMode,
      popover(tab) {
        knowPull(tab);
        return renderPopover(tab);
      },
      settled,
      // Only from the tab on screen, whose diff marked the line.
      arrived(view) {
        if (activeTab()?.id === view) tell('New thread');
      },
    });
    setBlockThreads({
      threadsOn(block) {
        const threads = held.get(block.tab).threads;
        if (threads === undefined) catchUp(block.tab, () => changed(block.tab));
        if (threads?.status === 'run') return [];
        const known = revisionsOf(block.tab);
        return threadsOnBlock(threads?.threads ?? [], block, (head) => revisionLabel(known, head));
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
