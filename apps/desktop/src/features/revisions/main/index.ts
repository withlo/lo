// The revisions feature in main: for each pull request's tab, its revisions and what it compares,
// sent to the window each time they change, and offered to the features that show it, with the
// files a push changed since they were marked viewed shown from there. It notes the heads each
// account's poller sees, "last seen here" as the reader leaves a pull request, and where each file
// was marked viewed, and marks files viewed on GitHub.

import { app } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { compareWait } from '../../../main/environment.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { comparisons, type OnScreen } from '../service.ts';
import { Marks } from './marks.ts';
import { RevisionsTab } from './pull.ts';

const followed = new Map<string, RevisionsTab>();
/** How long a tab waits for the comparison "last seen here" asks for, if not the tab's own. */
let holdLimit: number | undefined;
const listeners = new Set<(id: string) => void>();
const stops: (() => void)[] = [];
let marks: Marks | undefined;
/** The tab on screen, which the reader leaves when another is shown. */
let active: string | undefined;

const log = (line: string) => console.error(`revisions: ${line}`);

const WHOLE: OnScreen = { kind: 'head' };

function changed(id: string): void {
  for (const listener of listeners) {
    try {
      listener(id);
    } catch (error) {
      log(`a listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function tabOf(id: string): RevisionsTab {
  const tab = followed.get(id);
  if (!tab) throw new IpcError('missing', "There's no pull request's tab with that id.");
  return tab;
}

/** The marks, from the database the first time anything asks for them. */
function marksOf(context: FeatureContext<typeof contract>): Marks {
  marks ??= new Marks(context.database);
  return marks;
}

/**
 * Follows pull request `id`'s tab: its revisions made the first time, closed as the tab closes. A
 * view of a run of a stack's layers has none: it compares nothing and marks nothing.
 */
function follow(context: FeatureContext<typeof contract>, id: string): void {
  const service = context.use(tabs);
  const info = service.pull(id);
  if (!info || info.run) {
    const gone = followed.get(id);
    if (gone) {
      gone.left();
      gone.close();
      followed.delete(id);
      changed(id);
    }
    return;
  }
  let tab = followed.get(id);
  if (!tab) {
    tab = new RevisionsTab({
      id,
      github: context.use(github),
      clone: () => service.clone(id),
      marks: marksOf(context),
      publish: (view) => context.publish('comparison', view),
      changed: () => changed(id),
      holdLimit,
      log: (line) =>
        log(`${info.repository.owner}/${info.repository.name}#${info.number}: ${line}`),
    });
    followed.set(id, tab);
  }
  tab.update(info);
}

export default defineFeature(contract, {
  uses: [tabs, github],
  provide: () => [
    provides(comparisons, {
      onScreen: (id) => followed.get(id)?.onScreen() ?? WHOLE,
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      drawn: (id, head) => followed.get(id)?.drawn(head),
    }),
  ],
  handlers: {
    list: ({ id }) => followed.get(id)?.view(),
    compare({ id, from, to }) {
      tabOf(id).compare(from, to);
    },
    markViewed: ({ id, path, viewed, at }) => tabOf(id).markViewed(path, viewed, at),
  },
  start(context) {
    holdLimit = compareWait({ packaged: app.isPackaged, env: process.env });
    const store = marksOf(context);
    try {
      store.prune(Date.now());
    } catch (error) {
      log(
        `forgetting closed pull requests' marks: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const access = context.use(github);
    stops.push(
      access.onEvent((event) => {
        switch (event.kind) {
          case 'seen':
            try {
              store.noteSeen(event.login, event.pull, event.heads, event.at);
            } catch (error) {
              log(
                `noting the heads a poller saw: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            for (const tab of followed.values()) tab.heard(event.pull, event.heads);
            return;
          case 'removed':
            try {
              store.forget(event.login);
            } catch (error) {
              log(
                `forgetting a removed account's marks: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            return;
          case 'signedOut':
          case 'cantSave':
          case 'cantSaveOver':
            return;
          default:
            event satisfies never;
        }
      }),
    );
    const service = context.use(tabs);
    stops.push(service.onPull((id) => follow(context, id)));
    // Leaving a pull request's tab for another notes where the reader left off.
    stops.push(
      service.onTabs((now) => {
        if (now.active === active) return;
        if (active !== undefined) followed.get(active)?.left();
        active = now.active;
      }),
    );
    const now = service.list();
    active = now.active;
    for (const tab of now.tabs) if (tab.kind === 'pull') follow(context, tab.id);
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    // Lo quitting leaves the pull request on screen.
    if (active !== undefined) followed.get(active)?.left();
    for (const tab of followed.values()) tab.close();
    followed.clear();
    listeners.clear();
  },
});
