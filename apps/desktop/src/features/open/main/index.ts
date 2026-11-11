// The open feature in main: it reads links, from the open box, the Recent list and other apps, and
// opens each through the tabs, as the account that can see it; hands the window the pull request
// link on the clipboard, and nothing else from it; and installs the `lo` command.

import { join } from 'node:path';

import { app, clipboard } from 'electron';

import { openPage } from '../../../main/browser.ts';
import { commandFolder, dataFolder } from '../../../main/environment.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { incomingLinks } from '../../../main/links.ts';
import { github } from '../../accounts/service.ts';
import { tabs } from '../../tab/service.ts';
import {
  commandState,
  contract,
  installed,
  opened,
  preview,
  recentPull,
  type RecentPull,
} from '../contract.ts';
import {
  BUNDLE_ID,
  commandScript,
  elevateOnMac,
  findCommand,
  installCommand,
  type Folders,
  type Launch,
} from './command.ts';
import { Browser, link, look, pullLinkIn, type LinkOptions } from './link.ts';

const log = (line: string) => console.error(`open: ${line}`);

/** How many of the pull requests opened lately the Recent list shows: all Lo keeps. */
const RECENT = 100;

/**
 * Web links go to the system's browser, unless Lo is that browser, which would hand them straight
 * back, or they come back from it as soon as Lo hands them over.
 */
const browser = new Browser({
  open: openPage,
  isDefault: () => app.isDefaultProtocolClient('https'),
});

/** What opening a link needs, for a link from the window or from another app. */
function linkOptions(context: FeatureContext<typeof contract>, fromOutside: boolean): LinkOptions {
  return {
    github: context.use(github),
    tabs: context.use(tabs),
    browse: (url) => browser.hand(url, { fromOutside }),
    httpsOnly: !fromOutside,
    log,
  };
}

/**
 * Where `lo` goes: `LO_COMMAND_FOLDER` in a build run from source when it's set; otherwise
 * `/usr/local/bin` on macOS, or `~/.local/bin` when that can't be, and `~/.local/bin` on Linux.
 */
function folders(): Folders {
  const chosen = commandFolder({ packaged: app.isPackaged, env: process.env });
  if (chosen !== undefined) return { user: chosen };
  const user = join(app.getPath('home'), '.local', 'bin');
  return process.platform === 'darwin' ? { system: '/usr/local/bin', user } : { user };
}

/**
 * How `lo` starts Lo: a packaged Lo on macOS by its bundle ID; otherwise by running its program, as
 * a build run from source with its own folder and its data folder, so it reaches the Lo running.
 */
function launch(): Launch {
  if (app.isPackaged && process.platform === 'darwin') {
    return { kind: 'bundle', bundleId: BUNDLE_ID };
  }
  if (app.isPackaged) return { kind: 'program', program: process.execPath, args: [] };
  const data = process.env.LO_USER_DATA_DIR
    ? dataFolder({ packaged: false, appData: app.getPath('appData'), env: process.env })
    : undefined;
  return {
    kind: 'program',
    program: process.execPath,
    args: [app.getAppPath()],
    env: data === undefined ? undefined : { LO_USER_DATA_DIR: data },
  };
}

let stopTaking: (() => void) | undefined;

export default defineFeature(contract, {
  uses: [github, tabs],
  handlers: {
    async look({ text }, { use }) {
      // Checked as a push is, so the window gets nothing but what the contract says.
      return preview.parse(await look(text, use(github)));
    },
    async open({ text, login }, context) {
      return opened.parse(await link(text, linkOptions(context, false), { login }));
    },
    async clipboard() {
      return pullLinkIn(await clipboard.readText());
    },
    recent(_input, { use }) {
      return use(github)
        .recent(RECENT)
        .flatMap(({ pull, title, login, openedAt }): RecentPull[] => {
          const row = recentPull.safeParse({
            owner: pull.repo.owner,
            repo: pull.repo.name,
            number: pull.number,
            title: title ?? null,
            login,
            openedAt,
          });
          return row.success ? [row.data] : [];
        });
    },
    async command() {
      return commandState.parse(await findCommand(folders(), commandScript(launch())));
    },
    async installCommand() {
      const done = await installCommand({
        folders: folders(),
        script: commandScript(launch()),
        elevate: process.platform === 'darwin' ? elevateOnMac() : undefined,
        path: process.env.PATH,
        log,
      });
      return installed.parse(done);
    },
  },
  start(context) {
    // `lo://` links open in a packaged Lo. One built from source runs on Electron's own app, which
    // must never be made the system's handler for them.
    if (app.isPackaged && !app.isDefaultProtocolClient('lo')) {
      app.setAsDefaultProtocolClient('lo');
    }
    // Links other apps hand Lo, those from before it started included, open as a typed one does.
    // One Lo can't open says why in the window.
    const outside = linkOptions(context, true);
    stopTaking = incomingLinks.take((text) => {
      link(text, outside)
        .then((done) => {
          if (done.kind === 'refused') context.publish('refused', { message: done.message });
        })
        .catch((error: unknown) => log(`opening a link from another app: ${String(error)}`));
    });
  },
  stop() {
    stopTaking?.();
  },
});
