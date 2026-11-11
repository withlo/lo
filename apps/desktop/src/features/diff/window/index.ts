// The diff feature in the window: the diff in the middle of each pull request's tab, its keys, and
// what it says in the status bar. Each tab's diff loads as main says what changed, and is drawn
// while the tab is on screen.

import type { HeaderTarget, LineTarget, Place, Span } from '@lo/ui/commands';
import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { changeSetting } from '../../settings/window/shared.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { activeTab, middle, status } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { layout, whitespace } from '../settings.ts';
import { Diff } from './Diff.tsx';
import { changesLink } from './links.ts';
import { main } from './main.ts';
import { DiffStatus } from './Status.tsx';
import { drawnFor, keepOnly, takeState, type Drawn } from './tabs.ts';

const tabs = () => client(tabContract);

/** The diff on screen, or why a key for it can't run. */
function onScreen(): Drawn | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  return drawnFor(tab.id) ?? 'The diff isn’t drawn yet.';
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

/** A file's path, by its id in the view. */
function pathOf(drawn: Drawn, id: string): { text: string; hex?: string | undefined } | undefined {
  const entry = drawn.loader.snapshot().ready?.entries.find((each) => each.id === id);
  return entry?.versions.path;
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

async function copy(text: string): Promise<void> {
  await tabs().copy({ text });
}

export default {
  commands: handlers(keys, {
    nextChange: { run: withDiff(({ view }) => view.jump('change', 1)), enabled: drawnNow },
    previousChange: { run: withDiff(({ view }) => view.jump('change', -1)), enabled: drawnNow },
    nextFile: { run: withDiff(({ view }) => view.jump('file', 1)), enabled: drawnNow },
    previousFile: { run: withDiff(({ view }) => view.jump('file', -1)), enabled: drawnNow },
    otherSide: { run: withDiff(({ view }) => view.otherSide()), enabled: drawnNow },
    inline: {
      run: withDiff(async ({ view }) => {
        const next = view.probe.layout === 'split' ? 'inline' : 'split';
        // At once, then for every tab, as the setting.
        view.setLayout(next);
        await changeSetting(layout, next);
      }),
      enabled: drawnNow,
    },
    whitespace: {
      run: withDiff(async ({ loader }) => {
        await changeSetting(whitespace, loader.whitespaceShown() ? 'hide' : 'show');
      }),
      enabled: drawnNow,
    },
    openRun: { run: withDiff(({ view }, target) => view.fold(target, 'open')), enabled: drawnNow },
    closeRun: {
      run: withDiff(({ view }, target) => view.fold(target, 'close')),
      enabled: drawnNow,
    },
    openFile: { run: withDiff(({ view }, target) => view.fold(target, 'file')), enabled: drawnNow },
    toggleFile: {
      run: withDiff(({ view }, target) => view.fold(target, 'toggle')),
      enabled: drawnNow,
    },
    copyLines: {
      run: withDiff(async ({ view }, target) => {
        await copy(view.lines(spanOf(target.at)).join('\n'));
      }),
      enabled: drawnNow,
    },
    copyLink: {
      run: withDiff(async (drawn, target) => {
        const { file, line } = lineOf(target);
        const path = pathOf(drawn, file);
        if (path) await copy(await changesLink(drawn.pull, path, line));
      }),
      enabled: drawnNow,
    },
    copyPath: {
      run: withDiff(async (drawn, target) => {
        const path = pathOf(drawn, lineOf(target).file);
        if (path) await copy(path.text);
      }),
      enabled: drawnNow,
    },
    openOnGithub: {
      run: withDiff(async (drawn, target) => {
        const { file, line } = lineOf(target);
        const path = pathOf(drawn, file);
        if (path) await tabs().openExternal({ url: await changesLink(drawn.pull, path, line) });
      }),
      enabled: drawnNow,
    },
  }),
  views: [
    defineView(middle, {
      id: 'diff.view',
      order: 20,
      render: ({ tab }) => createElement(Diff, { tab }),
    }),
    defineView(status, {
      id: 'diff.status',
      order: 20,
      render: ({ tab }) => createElement(DiffStatus, { tab }),
    }),
  ],
  start() {
    main().subscribe('state', takeState);
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(open.map(({ id }) => id))));
  },
} satisfies WindowFeature;
