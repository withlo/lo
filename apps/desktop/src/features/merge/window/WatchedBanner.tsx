// The banner on a pull request's tab once the auto-merge watch acted on a push after your approval:
// it turned auto-merge off, couldn't, or can't tell yet whether the push would merge with your
// approval. One line names who pushed which revision, and its one button acts: "Show r5", the push,
// once auto-merge is off; else "Turn off auto-merge", busy while it's turned off. Dismissing it
// forgets what the watch said.

import { Banner, type BannerAction } from '@lo/ui';
import { useStore } from 'zustand';

import { onRevisions, revisionsOf, useRevisions } from '../../revisions/window/shared.ts';
import { withoutBidi, type BannerSwitch, type PullTab } from '../../tab/window/shared.ts';
import type { Watched } from '../contract.ts';
import { newerLabel, seeNewer, turnOffAutoMerge, turningOff } from './merging.ts';
import { dismissWatched, labelsOf } from './shipping.ts';
import { watchedWords } from './shipWords.ts';
import { merging, pullKey, shipping, statuses } from './store.ts';

/** What the auto-merge watch last said of `tab`'s pull request, if anything. */
function watchedOf(tab: PullTab): Watched | undefined {
  return shipping.getState().watched.get(pullKey(tab.owner, tab.repo, tab.number));
}

export function WatchedBanner({ tab }: { tab: PullTab }) {
  // Read for their changes: what the watch said, who pushed what, and auto-merge being turned off,
  // which lasts until the tab's status says it's off.
  useStore(shipping, (state) => state.watched);
  useStore(merging);
  useStore(statuses, (state) => state.views.get(tab.id));
  const revisions = useRevisions(tab.id);
  const watched = watchedOf(tab);
  if (!watched) return null;
  const words = watchedWords(watched, revisions?.revisions, labelsOf(tab.id));
  const key = pullKey(tab.owner, tab.repo, tab.number);
  const newer = { from: watched.approved, to: watched.head };
  const action: BannerAction =
    words.action === 'show'
      ? { label: newerLabel(tab.id, newer), onClick: () => seeNewer(tab.id, newer) }
      : {
          label: 'Turn off auto-merge',
          busy: turningOff(tab),
          working: 'Turning off…',
          onClick: () => {
            void turnOffAutoMerge(tab).then((sent) => {
              if (sent) dismissWatched(key);
            });
          },
        };
  return (
    <Banner
      tone={words.tone}
      title={withoutBidi(words.title)}
      detail={words.detail === undefined ? undefined : withoutBidi(words.detail)}
      action={action}
      onDismiss={() => dismissWatched(key)}
    />
  );
}

/** What a tab's banner says: while the watch's word on its pull request isn't dismissed. */
export const watchedSwitch: BannerSwitch = {
  said(tab) {
    const watched = watchedOf(tab);
    if (!watched) return undefined;
    const words = watchedWords(watched, revisionsOf(tab.id)?.revisions, labelsOf(tab.id));
    return { tone: words.tone, title: withoutBidi(words.title) };
  },
  subscribe(_tab, listener) {
    // Everything `said` reads: what the watch said, and who pushed which revision.
    const stops = [shipping.subscribe(listener), onRevisions(listener)];
    return () => {
      for (const stop of stops) stop();
    };
  },
};
