// The diff feature in the window: the diff in the middle of each pull request's tab, and beside it
// the whole-file view, their keys, and what the diff says in the status bar. Each tab's diff loads
// as main says what changed, and is drawn while it's on screen; a file opens whole from the diff,
// the tree and the file finder.

import type { FileFold } from '@lo/ui/code';
import type { HeaderTarget, LineTarget, Place, Span, Target } from '@lo/ui/commands';
import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import { announce, fail } from '../../../window/commands/notices.tsx';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { registry } from '../../../window/commands/registry.ts';
import { defineView } from '../../../window/slots.tsx';
import { followOverviews } from '../../overview/window/shared.ts';
import { changeSetting, settingNow, settingRow } from '../../settings/window/shared.ts';
import { contract as tabContract, viewIds } from '../../tab/contract.ts';
import {
  activeTab,
  besideNow,
  middle,
  showingMiddle,
  status,
  type PullTab,
} from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import type { FileVersions } from '../contract.ts';
import keys from '../keys.ts';
import { layout, whitespace } from '../settings.ts';
import { Diff } from './Diff.tsx';
import { drawnElsewhere, linesElsewhere } from './elsewhere.ts';
import { changesLink, fileLink } from './links.ts';
import { main } from './main.ts';
import { fromMoved, movedNow } from './moved.ts';
import { keepPlaces, openWhole, showTreeFiles } from './places.ts';
import { DiffStatus } from './Status.tsx';
import { drawnFor, keepOnly, loaderOf, takeState, type Drawn } from './tabs.ts';
import { markViewed, viewedAt, viewedEnabled } from './viewed.ts';
import { spansOf } from './spans.ts';
import { WholeFile } from './WholeFile.tsx';
import {
  changedIn,
  DIFF_VIEW,
  opened,
  type Opened,
  pathIn,
  type Read,
  reads,
  readWhole,
  WHOLE_VIEW,
  wholeDrawn,
  wholeWork,
} from './whole.ts';

const tabs = () => client(tabContract);

/** The diff on screen, or why a key can't run. */
function onScreen(): Drawn | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  if (wholeDrawn(tab.id)) return 'Go to the diff first';
  return drawnFor(tab.id) ?? 'Reading changed files…';
}

/** Runs `act` on the diff on screen. */
function withDiff<T = undefined>(
  act: (drawn: Drawn, target: T, count: number | undefined) => unknown,
) {
  return (target: T, count?: number): void => {
    const drawn = onScreen();
    if (typeof drawn !== 'string') void act(drawn, target, count);
  };
}

function drawnNow(): true | string {
  const drawn = onScreen();
  return typeof drawn === 'string' ? drawn : true;
}

/** The code Find… searches, a file whole on screen or the diff, or why there's none. */
function findable(): { find(): void } | string {
  const tab = activeTab();
  const whole = tab?.kind === 'pull' ? wholeDrawn(tab.id) : undefined;
  if (whole) return whole.view() ?? 'Go to the diff first';
  const drawn = onScreen();
  return typeof drawn === 'string' ? drawn : drawn.view;
}

/** The whole file on screen, as the keys act on it. */
interface WholeOn {
  readonly tab: PullTab;
  readonly open: Opened;
  /** The file in the diff, if the pull request changes it. */
  readonly change: FileVersions | undefined;
  /** The path of the version shown. */
  readonly path: TreePath;
  /** The head on screen. */
  readonly head: string | undefined;
  /** The commit a stack's layer's diff starts from, if any. */
  readonly from: string | null;
  readonly read: Read | undefined;
}

/** The whole file on screen in the tab on screen, if there is one. */
function wholeOnScreen(): WholeOn | undefined {
  const tab = activeTab();
  if (tab?.kind !== 'pull' || !wholeDrawn(tab.id)) return undefined;
  const open = opened.get(tab.id);
  if (!open) return undefined;
  const state = loaderOf(tab.id).snapshot().state;
  const change = changedIn(state?.files, open.key);
  const path = pathIn(change, open.version, () => open.path);
  return {
    tab,
    open,
    change,
    path,
    head: state?.at ?? undefined,
    from: state?.compareFrom ?? null,
    read: reads.get(tab.id),
  };
}

/** The lines of the whole file on screen, if it shows them. */
function wholeLines(whole: WholeOn): readonly string[] | undefined {
  const content = whole.read?.content;
  return content?.kind === 'text' ? content.lines : undefined;
}

/** Runs `act` on the whole file on screen, if there is one, or on the diff on screen. */
function inCode<T>(
  onWhole: (whole: WholeOn, target: T, count: number | undefined) => unknown,
  onDiff: (drawn: Drawn, target: T, count: number | undefined) => unknown,
) {
  return (target: T, count?: number): void => {
    const whole = wholeOnScreen();
    if (whole) void onWhole(whole, target, count);
    else withDiff(onDiff)(target, count);
  };
}

/** Why a key for the code on screen can't run, or `true`: a whole file's, or the diff's. */
function codeNow(): true | string {
  const tab = activeTab();
  if (tab?.kind === 'pull' && wholeDrawn(tab.id)) {
    return opened.get(tab.id) ? true : 'No whole file open';
  }
  return drawnNow();
}

/** A file's path, by its id in the view. */
function pathOfId(drawn: Drawn, id: string): TreePath | undefined {
  const entry = drawn.loader.snapshot().ready?.entries.find((each) => each.id === id);
  return entry?.versions.path;
}

/** The line a line target names: the cursor's, or the last of the lines `v` selected. */
function placeOf(at: Place | Span): Place {
  return 'line' in at ? at : { file: at.file, side: at.side, line: Math.max(at.from, at.to) };
}

/** Whether the diff on screen has an overview's note on the target's line. */
function hasNote(target: LineTarget): boolean {
  return noteNow(target) === true;
}

/** Whether "Overview note" can open a note on the target's line, or why not. */
function noteNow(target: LineTarget): true | string {
  const drawn = onScreen();
  if (typeof drawn === 'string') return drawn;
  return drawn.view.hasNote(placeOf(target.at)) || 'No overview note on this line';
}

/** Whether `gm` can go from the target's line, in moved code, to the other end, or why not. */
function otherEndNow(target: LineTarget): true | string {
  const drawn = onScreen();
  if (typeof drawn === 'string') return drawn;
  return movedNow(drawn.view, placeOf(target.at));
}

/** The line a target is on, for a link: the cursor's, or the last of the lines selected. */
function lineOf(target: LineTarget | HeaderTarget) {
  if (target.kind === 'header') return { file: target.file, line: undefined };
  const { at } = target;
  const line = 'line' in at ? at.line : Math.max(at.from, at.to);
  return { file: at.file, line: { side: at.side, line } };
}

/**
 * GitHub's link to the whole file on screen, at `line` if given: in the pull request's changes for
 * a file it changes, else in the file at the head on screen.
 */
async function wholeLink(whole: WholeOn, line: number | undefined): Promise<string | undefined> {
  const pull = { owner: whole.tab.owner, repo: whole.tab.repo, number: whole.tab.number };
  if (whole.change) {
    const at = line === undefined ? undefined : { side: whole.open.version, line };
    return changesLink(pull, whole.change.path, at);
  }
  return whole.head === undefined ? undefined : fileLink(pull, whole.head, whole.path, line);
}

/** Opens or closes what a target is on, the reader's own say over how its file shows. */
function fold(how: 'open' | 'close' | 'file' | 'toggle') {
  return (drawn: Drawn, target: LineTarget | HeaderTarget): void => {
    drawn.acted(target.kind === 'header' ? target.file : target.at.file);
    drawn.view.fold(target, how);
  };
}

/** What the header's menu calls `za` on a file, by what it would do there: "Collapse" by default. */
const foldNames: Record<FileFold, string | undefined> = {
  collapse: undefined,
  expand: 'Expand',
  show: 'Show large file',
};

/** The diff's layout, at once in the view on screen, then for every tab, as the setting. */
async function setLayout({ view }: Drawn, next: 'split' | 'inline'): Promise<void> {
  view.setLayout(next);
  await changeSetting(layout, next);
}

/** Whether the diff on screen can change its layout: code beside a reading view is inline. */
function layoutNow(): true | string {
  const drawn = onScreen();
  if (typeof drawn === 'string') return drawn;
  return !besideNow() || 'Code beside is inline';
}

/** What a copy says once it's done, or what failed, in a note: no button in view says it. */
interface Said {
  readonly done: string;
  readonly failed: string;
}

const LINES: Said = { done: 'Copied lines', failed: 'Couldn’t copy the lines' };
const LINK: Said = { done: 'Copied link to line', failed: 'Couldn’t copy the link' };
const PATH: Said = { done: 'Copied path', failed: 'Couldn’t copy the path' };

/**
 * Puts `text` on the clipboard, for a key or a menu row, and says how that went in a note:
 * `said.done`, or `said.failed` with what main said behind Details.
 */
async function copy(text: string, said: Said): Promise<void> {
  try {
    await tabs().copy({ text });
  } catch (error) {
    console.error(`${said.failed}:`, error);
    fail(said.failed, error instanceof Error && error.message !== '' ? error.message : undefined);
    return;
  }
  announce(said.done);
}

/** `yy` in the whole file on screen, or in the diff on screen. */
const copyCode = inCode<LineTarget>(
  async (whole, target, count) => {
    const all = wholeLines(whole);
    if (!all) return;
    const lines = spansOf(target, count).flatMap((span) =>
      all.slice(Math.min(span.from, span.to) - 1, Math.max(span.from, span.to)),
    );
    await copy(lines.join('\n'), LINES);
  },
  async ({ view }, target, count) => {
    await copy(
      spansOf(target, count)
        .flatMap((span) => view.lines(span))
        .join('\n'),
      LINES,
    );
  },
);

export default {
  commands: handlers(keys, {
    show: showingMiddle(DIFF_VIEW),
    nextChange: { run: withDiff(({ view }) => view.jump('change', 1)), enabled: drawnNow },
    previousChange: { run: withDiff(({ view }) => view.jump('change', -1)), enabled: drawnNow },
    nextFile: { run: withDiff(({ view }) => view.jump('file', 1)), enabled: drawnNow },
    previousFile: { run: withDiff(({ view }) => view.jump('file', -1)), enabled: drawnNow },
    nextThread: { run: withDiff(({ view }) => view.jump('thread', 1)), enabled: drawnNow },
    previousThread: { run: withDiff(({ view }) => view.jump('thread', -1)), enabled: drawnNow },
    otherEnd: {
      run: withDiff((drawn, target: LineTarget) => fromMoved(drawn, placeOf(target.at))),
      enabled: otherEndNow,
    },
    markViewed: {
      run: withDiff(markViewed),
      enabled: (target) => {
        const drawn = onScreen();
        return typeof drawn === 'string' ? drawn : viewedEnabled(drawn, target);
      },
      // Named for what it does now: on a viewed file, its menu row unmarks it.
      named: (target) => {
        const drawn = onScreen();
        return typeof drawn !== 'string' && viewedAt(drawn, target) ? 'Unmark viewed' : undefined;
      },
    },
    otherSide: { run: withDiff(({ view }) => view.otherSide()), enabled: drawnNow },
    find: {
      run() {
        const code = findable();
        if (typeof code !== 'string') code.find();
      },
      enabled() {
        const code = findable();
        return typeof code === 'string' ? code : true;
      },
    },
    sideBySide: {
      run: withDiff((drawn) => setLayout(drawn, 'split')),
      enabled: layoutNow,
      checked: () => settingNow(layout) === 'split',
    },
    inline: {
      run: withDiff((drawn) =>
        setLayout(drawn, drawn.view.probe.layout === 'split' ? 'inline' : 'split'),
      ),
      enabled: layoutNow,
      checked: () => settingNow(layout) === 'inline',
    },
    whitespace: {
      run: withDiff(async ({ loader }) => {
        await changeSetting(whitespace, loader.whitespaceShown() ? 'hide' : 'show');
      }),
      enabled: drawnNow,
      checked: () => settingNow(whitespace) === 'hide',
    },
    openRun: { run: withDiff(fold('open')), enabled: drawnNow },
    closeRun: { run: withDiff(fold('close')), enabled: drawnNow },
    openFile: { run: withDiff(fold('file')), enabled: drawnNow },
    toggleFile: {
      run: withDiff(fold('toggle')),
      enabled: drawnNow,
      named: (target) => {
        const drawn = onScreen();
        if (typeof drawn === 'string') return undefined;
        const now = drawn.view.foldOf(target.kind === 'header' ? target.file : target.at.file);
        return now === undefined ? undefined : foldNames[now];
      },
    },
    toggleThread: {
      run: withDiff(({ view }, target) => void view.openThread(target.thread, 'toggle')),
      enabled: drawnNow,
      named: (target) => (target.collapsed ? 'Expand' : undefined),
    },
    wholeFile: {
      run: withDiff((drawn, target) => {
        const tab = activeTab();
        const file = target.kind === 'header' ? target.file : target.at.file;
        const key = drawn.loader.ids.keyOf(file);
        if (tab?.kind !== 'pull' || key === undefined) return;
        const path = pathOfId(drawn, file);
        if (!path) return;
        const side = target.kind === 'header' ? target.side : target.at.side;
        const at: Target = target.kind === 'header' ? target : { kind: 'line', at: target.at };
        openWhole(tab.id, { key, path, version: side, at, focus: true });
      }),
      enabled: drawnNow,
    },
    loadWhole: {
      run: () => {
        const whole = wholeOnScreen();
        if (whole?.head === undefined || whole.read?.content.kind !== 'large') return;
        const file = { key: whole.open.key, version: whole.open.version, path: whole.path };
        readWhole(whole.tab.id, file, whole.head, whole.from, true, wholeWork(whole.tab.id));
      },
      enabled: () => {
        const whole = wholeOnScreen();
        if (!whole) return 'No whole file open';
        return whole.read?.content.kind === 'large' || 'This file is already shown';
      },
    },
    overviewNote: {
      run: withDiff(({ view }, target: LineTarget) => {
        view.openNote(placeOf(target.at));
      }),
      enabled: noteNow,
      listed: hasNote,
    },
    copyLines: {
      // Code another feature draws, such as an overview's code block, copies from what it draws.
      run: (target, count) => {
        const elsewhere = linesElsewhere(spansOf(target, count));
        if (elsewhere) void copy(elsewhere.join('\n'), LINES);
        else copyCode(target, count);
      },
      enabled: (target) => drawnElsewhere(target.at.file) || codeNow(),
    },
    copyLink: {
      run: inCode(
        async (whole, target) => {
          const link = await wholeLink(whole, lineOf(target).line?.line);
          if (link) await copy(link, LINK);
        },
        async (drawn, target) => {
          const { file, line } = lineOf(target);
          const path = pathOfId(drawn, file);
          if (path) await copy(await changesLink(drawn.pull, path, line), LINK);
        },
      ),
      enabled: codeNow,
    },
    copyPath: {
      run: inCode(
        async (whole) => {
          await copy(whole.path.text, PATH);
        },
        async (drawn, target) => {
          const path = pathOfId(drawn, lineOf(target).file);
          if (path) await copy(path.text, PATH);
        },
      ),
      enabled: codeNow,
    },
    openOnGithub: {
      run: inCode(
        async (whole, target) => {
          const link = await wholeLink(whole, lineOf(target).line?.line);
          if (link) await tabs().openExternal({ url: link });
        },
        async (drawn, target) => {
          const { file, line } = lineOf(target);
          const path = pathOfId(drawn, file);
          if (path) await tabs().openExternal({ url: await changesLink(drawn.pull, path, line) });
        },
      ),
      enabled: codeNow,
    },
  }),
  views: [
    defineView(middle, {
      id: DIFF_VIEW,
      order: 20,
      label: 'Diff',
      kind: 'code',
      render: ({ tab, shown }) => createElement(Diff, { tab, shown }),
    }),
    // After the diff. With no label, it's not one of the views `` ` `` steps through: a file opens
    // in it, and `⌃o` goes back.
    defineView(middle, {
      id: WHOLE_VIEW,
      order: 25,
      kind: 'code',
      render: ({ tab, shown }) => createElement(WholeFile, { tab, shown }),
    }),
    defineView(status, {
      id: 'diff.status',
      order: 20,
      render: ({ tab }) => createElement(DiffStatus, { tab }),
    }),
    // Settings › Pull requests, after how a pull request opens.
    settingRow(layout, { order: 20, command: 'diff.inline' }),
    settingRow(whitespace, { order: 30, command: 'diff.whitespace' }),
  ],
  start() {
    // An overview's note has nothing to show while overviews are off.
    followOverviews((on) => registry().setOff(['diff.overviewNote'], !on));
    main().subscribe('state', takeState);
    showTreeFiles();
    // Each view of a pull request's tab keeps its diff until the tab closes.
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const ids = new Set(viewIds(open));
      keepOnly(ids);
      keepPlaces(ids);
    });
  },
} satisfies WindowFeature;
