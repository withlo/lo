// The banner on a pull request's tab once Lo saw it leave its merge queue without merging: one line,
// and the merge panel, `m`, whose first row says why, with the failed checks' runs. Dismissing it
// forgets why it left.

import { Banner } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import type { BannerSwitch, PullTab } from '../../tab/window/shared.ts';
import type { LeftQueue } from '../contract.ts';
import { openPanel } from './actions.ts';
import { leftNow, leftTitle, leftTone } from './places.ts';
import { dismissLeft, queues } from './queued.ts';
import { statuses } from './store.ts';

/** Why `tab`'s pull request left its merge queue, with the branch, while it's news. */
function leftOf(tab: PullTab): { left: LeftQueue; base: string } | undefined {
  const view = statuses.getState().views.get(tab.id);
  if (view?.kind !== 'known') return undefined;
  const left = leftNow(view.state, queues.getState().views.get(tab.id));
  return left && { left, base: view.state.base };
}

/** The first key of command `id`, as this system shows it. */
function keyOf(id: string): readonly string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

export function LeftBanner({ tab }: { tab: PullTab }) {
  // Read for their changes: why it left, and its status.
  useStore(queues);
  useStore(statuses);
  const found = leftOf(tab);
  if (!found) return null;
  return (
    <Banner
      tone={leftTone(found.left)}
      title={leftTitle(tab.number)}
      action={{
        label: 'Merge panel',
        keys: keyOf('merge.panel'),
        onClick: () => openPanel(tab.id, tab.number),
      }}
      onDismiss={() => dismissLeft(tab.id)}
    />
  );
}

/** What a tab's banner says: while its pull request's leaving the queue is news. */
export const leftSwitch: BannerSwitch = {
  said(tab) {
    const found = leftOf(tab);
    return found && { tone: leftTone(found.left), title: leftTitle(tab.number) };
  },
  subscribe(_tab, listener) {
    const left = queues.subscribe(listener);
    const status = statuses.subscribe(listener);
    return () => {
      left();
      status();
    };
  },
};
