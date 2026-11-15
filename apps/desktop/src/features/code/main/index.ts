// The code feature in main: trust. For each view of a pull request's tab, whether language servers
// may run on it, decided from the trusted entries in the settings file and, once one names the
// view, the repositories' node IDs read from GitHub, and sent to the window each time it changes.
// Trust is written only here, once main's own dialog, attached to the window that asked, says
// "Trust"; the banner, the palette and Settings only ask. Taking trust away, however the settings
// file loses an entry, lets go of what ran on it: its checkouts are removed.

import { PullRef, readPullRequestRepositories, type PullRequestRepositories } from '@lo/github';
import { BrowserWindow, dialog } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { settings } from '../../settings/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { readTrusted, trusted, type TrustEntry } from '../settings.ts';
import { letGo } from './checkouts.ts';
import { TrustAsker, type AskWindow } from './confirm.ts';
import { Dismissed } from './dismissed.ts';
import {
  dropsFor,
  goneFrom,
  meant,
  removes,
  withEntry,
  withoutEntries,
  type Drop,
} from './entries.ts';
import { TrustViews, type ViewInfo } from './views.ts';

type Context = FeatureContext<typeof contract>;

const log = (line: string) => console.error(`code: ${line}`);

let views: TrustViews | undefined;
let asker: TrustAsker<BrowserAsk> | undefined;
let dismissed: Dismissed | undefined;
const stops: (() => void)[] = [];

/**
 * What hears of checkouts no longer trusted, once an entry is out of the settings file, however it
 * went: each stops what runs on them, then lets go of them.
 */
const untrusted = new Set<(drop: Drop) => Promise<void>>();

/** The window that asked, which the dialog is attached to. */
interface BrowserAsk extends AskWindow {
  readonly browser: BrowserWindow;
}

/** The window Electron numbers `id`, while it's open. */
function windowOf(id: number | undefined): BrowserAsk | undefined {
  const browser = id === undefined ? undefined : BrowserWindow.fromId(id);
  if (!browser || browser.isDestroyed()) return undefined;
  return {
    browser,
    onClosed(listener) {
      browser.once('closed', listener);
      return () => {
        browser.off('closed', listener);
      };
    },
  };
}

function viewsOf(): TrustViews {
  if (!views) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
  return views;
}

/** View `id` as the decision needs it, or nothing once it's closed. */
function viewInfo(context: Context, id: string): ViewInfo | undefined {
  const info = context.use(tabs).pull(id);
  if (!info) return undefined;
  const git = context.git.status?.status;
  const fork = info.head?.fork;
  return {
    id,
    repo: `${info.repository.owner}/${info.repository.name}`,
    number: info.number,
    noGit:
      info.local.kind === 'noGit' || git === 'missing' || git === 'tooOld'
        ? true
        : git === undefined
          ? undefined
          : false,
    local: info.local.kind === 'ready',
    fork: fork === undefined ? undefined : fork && `${fork.owner}/${fork.name}`,
    canRead: info.acting !== undefined,
    heads: `${info.latest ?? ''} ${info.shown ?? ''}`,
  };
}

/**
 * The repositories view `id`'s pull request joins, read from GitHub as the view acts: in its
 * account's queue, or without signing in for a public repository.
 */
async function readRepositories(context: Context, id: string): Promise<PullRequestRepositories> {
  const info = context.use(tabs).pull(id);
  if (!info?.acting) throw new Error("The view is closed, or doesn't know who it acts as yet.");
  const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
  const access = context.use(github);
  if (info.acting.kind === 'anonymous') return readPullRequestRepositories(access.anonymous, pull);
  const poller = await access.poller(info.acting.login);
  return poller.readOnce((client) => readPullRequestRepositories(client, pull));
}

/**
 * Takes out of the settings file the entries `take` picks. Watching the file, Lo then lets go of
 * what they trusted.
 */
async function untrust(context: Context, take: (entry: TrustEntry) => boolean): Promise<void> {
  await context.use(settings).update(trusted, (list) => withoutEntries(list, take).list);
}

/** Tells those that hear of checkouts no longer trusted, without holding up what changed. */
function letGoOf(drops: readonly Drop[]): void {
  for (const drop of drops) {
    for (const listener of untrusted) {
      listener(drop).catch((error: unknown) => {
        log(`couldn't let go of what ran on ${drop.repo}: ${String(error)}`);
      });
    }
  }
}

export default defineFeature(contract, {
  uses: [tabs, github, settings],
  handlers: {
    state: ({ view }) => viewsOf().status(view) ?? null,
    trust(request, _context, { windowId }) {
      if (!asker) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
      return asker.ask(request, windowOf(windowId));
    },
    async untrust(input, context) {
      if ('view' in input) {
        const view = viewInfo(context, input.view);
        if (!view) throw new IpcError('missing', "There's no pull request's tab with that id.");
        viewsOf().update(input.view);
        await untrust(context, meant(view, viewsOf().decision(input.view)));
        return;
      }
      await untrust(context, (entry) => removes(input, entry));
    },
    dismiss({ view }, context) {
      const info = viewInfo(context, view);
      if (!info || !dismissed) {
        throw new IpcError('missing', "There's no pull request's tab with that id.");
      }
      dismissed.add(info.repo, Date.now());
      viewsOf().updateAll();
    },
  },
  start(context) {
    const service = context.use(tabs);
    const kept = new Dismissed(context.database);
    dismissed = kept;
    const followed = new TrustViews({
      view: (id) => viewInfo(context, id),
      read: (view) => readRepositories(context, view.id),
      dismissed: (repo) => kept.has(repo),
      publish: (status) => context.publish('status', status),
      log,
    });
    views = followed;
    asker = new TrustAsker<BrowserAsk>({
      view(id) {
        const view = viewInfo(context, id);
        return view && { id, repo: view.repo, number: view.number };
      },
      read: (view) => followed.readNow(view.id),
      confirm: async ({ browser }, question, signal) => {
        const { response } = await dialog.showMessageBox(browser, {
          ...question,
          buttons: [...question.buttons],
          signal,
        });
        return response;
      },
      write: (entry) => context.use(settings).update(trusted, (list) => withEntry(list, entry)),
    });
    // Until language servers run, there's only the checkouts to let go of.
    untrusted.add(async (drop) => {
      const cache = context.git.cache;
      if (cache) await letGo(cache, drop);
    });
    /** The entries as the file last had them, once it's been read. */
    let before: readonly TrustEntry[] | undefined;
    stops.push(
      context.use(settings).watch(trusted, (value) => {
        const entries = readTrusted(value).entries;
        const gone = before === undefined ? [] : goneFrom(before, entries);
        before = entries;
        // Views are decided again first, so nothing runs on what's let go of.
        followed.setEntries(entries);
        letGoOf(dropsFor(gone, entries));
      }),
      service.onPull((id) => followed.update(id)),
    );
    context.git.onStatus(() => followed.updateAll());
    for (const tab of service.list().tabs) if (tab.kind === 'pull') followed.update(tab.id);
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    untrusted.clear();
    views?.stop();
    views = undefined;
    asker = undefined;
  },
});
