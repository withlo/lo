// The banner on a pull request's tab once the auto-merge watch acted on a push after your approval:
// it turned auto-merge off, couldn't, or can't tell yet whether the push would merge with your
// approval. It names who pushed which revision, and the one you approved, and offers the merge
// panel, `m`. Dismissing it forgets what the watch said.

import { Banner } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { useRevisions } from '../../revisions/window/shared.ts';
import { withoutBidi, type BannerSwitch, type PullTab } from '../../tab/window/shared.ts';
import type { Watched } from '../contract.ts';
import { openPanel } from './actions.ts';
import { dismissWatched, labelsOf } from './shipping.ts';
import { watchedWords } from './shipWords.ts';
import { pullKey, shipping } from './store.ts';

/** What the auto-merge watch last said of `tab`'s pull request, if anything. */
function watchedOf(tab: PullTab): Watched | undefined {
  return shipping.getState().watched.get(pullKey(tab.owner, tab.repo, tab.number));
}

/** The first key of command `id`, as this system shows it. */
function keyOf(id: string): readonly string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

export function WatchedBanner({ tab }: { tab: PullTab }) {
  // Read for their changes: what the watch said, and who pushed what.
  useStore(shipping, (state) => state.watched);
  const revisions = useRevisions(tab.id);
  const watched = watchedOf(tab);
  if (!watched) return null;
  const words = watchedWords(watched, revisions?.revisions, labelsOf(tab.id), Date.now());
  return (
    <Banner
      tone={words.tone}
      title={withoutBidi(words.title)}
      detail={withoutBidi(words.detail)}
      actions={[
        {
          label: 'Merge panel',
          keys: keyOf('merge.panel'),
          onClick: () => openPanel(tab.id, tab.number),
        },
      ]}
      onDismiss={() => dismissWatched(pullKey(tab.owner, tab.repo, tab.number))}
    />
  );
}

/** Whether a tab's banner shows: while the watch's word on its pull request isn't dismissed. */
export const watchedSwitch: BannerSwitch = {
  shows: (tab) => watchedOf(tab) !== undefined,
  subscribe: (_tab, listener) => shipping.subscribe(listener),
};
