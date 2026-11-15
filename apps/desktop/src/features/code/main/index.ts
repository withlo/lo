// The code feature in main: trust. For each view of a pull request's tab, whether language servers
// may run on it, decided from the trusted entries in the settings file and, once one names the
// view, the repositories' node IDs read from GitHub, and sent to the window each time it changes.
// Trust is written only here, once main's own dialog, attached to the window, says "Trust"; the
// banner, the palette and Settings only ask. Taking trust away lets go of what ran on it: its
// checkouts are removed.

import { PullRef, readPullRequestRepositories, type PullRequestRepositories } from '@lo/github';
import { BrowserWindow, dialog } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { settings } from '../../settings/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { readTrusted, trusted, type TrustEntry } from '../settings.ts';
import { TrustAsker, type AskWindow } from './confirm.ts';
import { naming } from './decide.ts';
import { Dismissed } from './dismissed.ts';
import { removes, withEntry, withoutEntries } from './entries.ts';
import { TrustViews, type ViewInfo } from './views.ts';

type Context = FeatureContext<typeof contract>;

const log = (line: string) => console.error(`code: ${line}`);

let views: TrustViews | undefined;
let asker: TrustAsker<BrowserAsk> | undefined;
let dismissed: Dismissed | undefined;
const stops: (() => void)[] = [];

/**
 * What hears of an entry no longer trusted, once it's out of the settings file: each stops what
 * runs on what it trusted, then lets go of its checkouts.
 */
const untrusted = new Set<(entry: TrustEntry) => Promise<void>>();

/** Lo's window, which the dialog is attached to: the one in front, or else its only one. */
interface BrowserAsk extends AskWindow {
  readonly browser: BrowserWindow;
}

function loWindow(): BrowserAsk | undefined {
  const browser = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
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

/** Lets go of the checkouts of what `entry` trusted. */
async function dropCheckouts(context: Context, entry: TrustEntry): Promise<void> {
  const cache = context.git.cache;
  if (!cache) return;
  const [owner = '', name = ''] = entry.repo.split('/');
  await cache.dropCheckouts(owner, name, entry.kind === 'pull' ? { pull: entry.pull } : {});
}

/**
 * Takes out of the settings file the entries `take` picks, and tells those that hear of entries
 * no longer trusted, without holding up the reply.
 */
async function untrust(context: Context, take: (entry: TrustEntry) => boolean): Promise<void> {
  let removed: TrustEntry[] = [];
  await context.use(settings).update(trusted, (list) => {
    const changed = withoutEntries(list, take);
    removed = changed.removed;
    return changed.list;
  });
  for (const entry of removed) {
    for (const listener of untrusted) {
      listener(entry).catch((error: unknown) => {
        log(`couldn't let go of what ran on ${entry.repo}: ${String(error)}`);
      });
    }
  }
}

export default defineFeature(contract, {
  uses: [tabs, github, settings],
  handlers: {
    state: ({ view }) => viewsOf().status(view) ?? null,
    trust(request) {
      if (!asker) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
      return asker.ask(request);
    },
    async untrust(input, context) {
      if ('view' in input) {
        const view = viewInfo(context, input.view);
        if (!view) throw new IpcError('missing', "There's no pull request's tab with that id.");
        viewsOf().update(input.view);
        const by = viewsOf().decision(input.view)?.by;
        // What trusts it; or, while that isn't known, whatever names it.
        const take = by
          ? (entry: TrustEntry) =>
              removes({ id: by.id, pull: by.kind === 'pull' ? by.pull : null }, entry)
          : (entry: TrustEntry) => naming(view, [entry]).length > 0;
        await untrust(context, take);
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
      async read(view) {
        const repositories = await readRepositories(context, view.id);
        followed.took(view, repositories);
        return repositories;
      },
      window: loWindow,
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
    untrusted.add((entry) => dropCheckouts(context, entry));
    stops.push(
      context
        .use(settings)
        .watch(trusted, (value) => followed.setEntries(readTrusted(value).entries)),
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
