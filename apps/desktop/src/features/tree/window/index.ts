import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as tabContract } from '../../tab/contract.ts';
import { left } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  closeRow,
  focusedFile,
  githubPage,
  goToTree,
  move,
  openRow,
  pathOf,
  pullOnScreen,
  setAll,
  show,
  showable,
  treeShown,
  wholeShowable,
} from './actions.ts';
import { Files } from './Files.tsx';
import { main } from './main.ts';
import { pathOfKey } from './paths.ts';
import { choices, showState } from './store.ts';
import { showFile } from './shared.ts';

/** Runs `act` on the pull request's tab on screen. */
function onTab(act: (tab: string) => void): () => void {
  return () => {
    const tab = pullOnScreen();
    if (typeof tab !== 'string') act(tab.id);
  };
}

/** Why a key for the tree can't run: there's no pull request on screen. */
function inPull(): true | string {
  const tab = pullOnScreen();
  return typeof tab === 'string' ? tab : true;
}

/** The file a command acts on: the one it was given, or the one the keyboard is on. */
function fileOf(target: { kind: 'file'; file: string } | { kind: 'none' }, tab: string) {
  return target.kind === 'file' ? target.file : focusedFile(tab);
}

const tabs = () => client(tabContract);

export default {
  commands: handlers(keys, {
    focus: {
      run: onTab(goToTree),
      enabled: () => {
        const ready = inPull();
        return ready === true ? treeShown() : ready;
      },
    },
    mode: {
      run: onTab((tab) =>
        choices.update(tab, (current) => ({
          ...current,
          mode: current.mode === 'tree' ? 'review' : 'tree',
        })),
      ),
      enabled: inPull,
    },
    changedOnly: {
      run: onTab((tab) =>
        choices.update(tab, (current) => ({ ...current, changedOnly: !current.changedOnly })),
      ),
      enabled: inPull,
    },
    down: { run: onTab((tab) => move(tab, 1)), enabled: inPull },
    up: { run: onTab((tab) => move(tab, -1)), enabled: inPull },
    open: { run: onTab(openRow), enabled: inPull },
    close: { run: onTab(closeRow), enabled: inPull },
    openAll: { run: onTab((tab) => setAll(tab, true)), enabled: inPull },
    closeAll: { run: onTab((tab) => setAll(tab, false)), enabled: inPull },
    show: {
      run: (target) => {
        const tab = pullOnScreen();
        if (typeof tab === 'string') return;
        const key = target.kind === 'file' ? target.file : undefined;
        const row = key ?? focusedFile(tab.id);
        if (row !== undefined) show(tab.id, row);
        else openRow(tab.id);
      },
      enabled: (target) => {
        const tab = pullOnScreen();
        if (typeof tab === 'string') return tab;
        const key = fileOf(target, tab.id);
        return key === undefined ? true : showable(tab.id, key);
      },
    },
    wholeFile: {
      run: (target) => {
        const tab = pullOnScreen();
        if (typeof tab !== 'string') showFile('whole', tab.id, target.file);
      },
      enabled: () => {
        const ready = inPull();
        return ready === true ? wholeShowable() : ready;
      },
    },
    copyPath: {
      run: async (target) => {
        const tab = pullOnScreen();
        const path = typeof tab === 'string' ? pathOfKey(target.file) : pathOf(tab.id, target.file);
        await tabs().copy({ text: path.text });
      },
    },
    openOnGithub: {
      run: async (target) => {
        const tab = pullOnScreen();
        if (typeof tab === 'string') return;
        await tabs().openExternal({ url: await githubPage(tab, target.file) });
      },
      enabled: inPull,
    },
  }),
  views: [
    defineView(left, {
      id: 'tree.files',
      order: 20,
      render: ({ tab }) =>
        createElement(Files, {
          tab,
          // A click on a folder's row, its twisty or not, opens or closes it; on a file, shows it.
          onRow: (id, key) => show(id, key),
        }),
    }),
  ],
  start() {
    main().subscribe('state', showState);
  },
} satisfies WindowFeature;
