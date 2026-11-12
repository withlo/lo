// The diff feature in the window: the diff in the middle of each pull request's tab, and beside it
// the whole-file view, their keys, and what the diff says in the status bar. Each tab's diff loads
// as main says what changed, and is drawn while it's on screen; a file opens whole from the diff,
// the tree and the file finder.

import type { HeaderTarget, LineTarget, Place, Span, Target } from '@lo/ui/commands';
import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { changeSetting, opening } from '../../settings/window/shared.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { activeTab, middle, status, type PullTab } from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import type { FileVersions } from '../contract.ts';
import keys from '../keys.ts';
import { layout, whitespace } from '../settings.ts';
import { Diff } from './Diff.tsx';
import { changesLink, fileLink } from './links.ts';
import { main } from './main.ts';
import { keepPlaces, openWhole, showTreeFiles } from './places.ts';
import { LayoutRow } from './LayoutRow.tsx';
import { DiffStatus } from './Status.tsx';
import { keepOnly, keysDiff, loaderOf, takeState, type Drawn } from './tabs.ts';
import { markViewed } from './viewed.ts';
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

/** The diff on screen, or the file of it beside another view that has focus, or why a key can't run. */
function onScreen(): Drawn | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  if (wholeDrawn(tab.id)) return 'A whole file is on screen, not the diff.';
  return keysDiff(tab.id) ?? 'The diff isn’t drawn yet.';
}

/** Runs `act` on the diff on screen. */
function withDiff<T = undefined>(act: (drawn: Drawn, target: T) => unknown) {
  return (target: T): void => {
    const drawn = onScreen();
    if (typeof drawn !== 'string') void act(drawn, target);
  };
}

function drawnNow(): true | string {
  const drawn = onScreen();
  return typeof drawn === 'string' ? drawn : true;
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
  return { tab, open, change, path, head: state?.at ?? undefined, read: reads.get(tab.id) };
}

/** The lines of the whole file on screen, if it shows them. */
function wholeLines(whole: WholeOn): readonly string[] | undefined {
  const content = whole.read?.content;
  return content?.kind === 'text' ? content.lines : undefined;
}

/** Runs `act` on the whole file on screen, if there is one, or on the diff on screen. */
function inCode<T>(
  onWhole: (whole: WholeOn, target: T) => unknown,
  onDiff: (drawn: Drawn, target: T) => unknown,
) {
  return (target: T): void => {
    const whole = wholeOnScreen();
    if (whole) void onWhole(whole, target);
    else withDiff(onDiff)(target);
  };
}

/** Why a key for the code on screen can't run, or `true`: a whole file's, or the diff's. */
function codeNow(): true | string {
  const tab = activeTab();
  if (tab?.kind === 'pull' && wholeDrawn(tab.id)) {
    return opened.get(tab.id) ? true : 'No file is open whole.';
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
  return drawn.view.hasNote(placeOf(target.at)) || 'There’s no overview note on this line.';
}

/** The lines a line target is on: the cursor's line, or the lines `v` selected. */
function spanOf(at: Place | Span): Span {
  return 'line' in at ? { file: at.file, side: at.side, from: at.line, to: at.line } : at;
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

async function copy(text: string): Promise<void> {
  await tabs().copy({ text });
}

export default {
  commands: handlers(keys, {
    nextChange: { run: withDiff(({ view }) => view.jump('change', 1)), enabled: drawnNow },
    previousChange: { run: withDiff(({ view }) => view.jump('change', -1)), enabled: drawnNow },
    nextFile: { run: withDiff(({ view }) => view.jump('file', 1)), enabled: drawnNow },
    previousFile: { run: withDiff(({ view }) => view.jump('file', -1)), enabled: drawnNow },
    markViewed: { run: withDiff(markViewed), enabled: drawnNow },
    otherSide: { run: withDiff(({ view }) => view.otherSide()), enabled: drawnNow },
    inline: {
      run: withDiff(async ({ view }) => {
        const next = view.probe.layout === 'split' ? 'inline' : 'split';
        // At once, then for every tab, as the setting.
        view.setLayout(next);
        await changeSetting(layout, next);
      }),
      enabled: () => {
        const drawn = onScreen();
        if (typeof drawn === 'string') return drawn;
        return !drawn.beside || 'Code beside the overview is always inline.';
      },
    },
    whitespace: {
      run: withDiff(async ({ loader }) => {
        await changeSetting(whitespace, loader.whitespaceShown() ? 'hide' : 'show');
      }),
      enabled: drawnNow,
    },
    openRun: { run: withDiff(fold('open')), enabled: drawnNow },
    closeRun: { run: withDiff(fold('close')), enabled: drawnNow },
    openFile: { run: withDiff(fold('file')), enabled: drawnNow },
    toggleFile: { run: withDiff(fold('toggle')), enabled: drawnNow },
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
        readWhole(whole.tab.id, file, whole.head, true, wholeWork(whole.tab.id));
      },
      enabled: () => {
        const whole = wholeOnScreen();
        if (!whole) return 'There’s no whole file on screen.';
        return whole.read?.content.kind === 'large' || 'The file on screen isn’t waiting to load.';
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
      run: inCode(
        async (whole, target) => {
          const span = spanOf(target.at);
          const lines = wholeLines(whole)?.slice(
            Math.min(span.from, span.to) - 1,
            Math.max(span.from, span.to),
          );
          if (lines) await copy(lines.join('\n'));
        },
        async ({ view }, target) => {
          await copy(view.lines(spanOf(target.at)).join('\n'));
        },
      ),
      enabled: codeNow,
    },
    copyLink: {
      run: inCode(
        async (whole, target) => {
          const link = await wholeLink(whole, lineOf(target).line?.line);
          if (link) await copy(link);
        },
        async (drawn, target) => {
          const { file, line } = lineOf(target);
          const path = pathOfId(drawn, file);
          if (path) await copy(await changesLink(drawn.pull, path, line));
        },
      ),
      enabled: codeNow,
    },
    copyPath: {
      run: inCode(
        async (whole) => {
          await copy(whole.path.text);
        },
        async (drawn, target) => {
          const path = pathOfId(drawn, lineOf(target).file);
          if (path) await copy(path.text);
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
      render: ({ tab, shown }) => createElement(Diff, { tab, shown }),
    }),
    // After the diff, among the middle views `` ` `` steps through.
    defineView(middle, {
      id: WHOLE_VIEW,
      order: 25,
      render: ({ tab, shown }) => createElement(WholeFile, { tab, shown }),
    }),
    defineView(status, {
      id: 'diff.status',
      order: 20,
      render: ({ tab }) => createElement(DiffStatus, { tab }),
    }),
    // After how a pull request opens, in Settings' Pull requests.
    defineView(opening, {
      id: 'diff.layout',
      order: 20,
      render: () => createElement(LayoutRow),
    }),
  ],
  start() {
    main().subscribe('state', takeState);
    showTreeFiles();
    tabs().subscribe('tabs', ({ tabs: open }) => {
      const ids = new Set(open.map(({ id }) => id));
      keepOnly(ids);
      keepPlaces(ids);
    });
  },
} satisfies WindowFeature;
