// The timeline feature in main: each view's timeline, and what goes beside its description, read
// the first time the window shows it and kept current from then on, until its tab closes.

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { TimelineTab } from './follow.ts';

const followed = new Map<string, TimelineTab>();
const stops: (() => void)[] = [];

const log = (line: string) => console.error(`timeline: ${line}`);

/** Follows view `id` as it changes, once its timeline has been shown; closed as its tab closes. */
function follow(context: FeatureContext<typeof contract>, id: string): void {
  const tab = followed.get(id);
  if (!tab) return;
  const info = context.use(tabs).pull(id);
  if (info) {
    tab.update(info);
    return;
  }
  tab.close();
  followed.delete(id);
}

export default defineFeature(contract, {
  uses: [tabs, github],
  handlers: {
    show({ id }, context) {
      const info = context.use(tabs).pull(id);
      if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
      let tab = followed.get(id);
      if (!tab) {
        tab = new TimelineTab({
          id,
          github: context.use(github),
          publish: {
            timeline: (view) => context.publish('timeline', view),
            sidebar: (view) => context.publish('sidebar', view),
          },
          log: (line) =>
            log(`${info.repository.owner}/${info.repository.name}#${info.number}: ${line}`),
        });
        followed.set(id, tab);
        tab.update(info);
      }
      return tab.show();
    },
  },
  start(context) {
    stops.push(context.use(tabs).onPull((id) => follow(context, id)));
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    for (const tab of followed.values()) tab.close();
    followed.clear();
  },
});
