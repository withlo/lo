// The banner on a pull request's tab for a merge Lo sent that needs the reader, once the dialog
// isn't showing it: GitHub refused it, in the core's words, or Lo can't tell whether it merged, with
// "Ask GitHub again", a read. It offers the merge panel, `m`, and dismissing it forgets the merge.

import { Banner, type BannerAction } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { usePull, withoutBidi, type BannerSwitch, type PullTab } from '../../tab/window/shared.ts';
import type { JobView } from '../contract.ts';
import { openPanel } from './actions.ts';
import { askAgain, dismissJob, newerLabel, newerOf, seeNewer } from './merging.ts';
import { jobOf, merging, statuses } from './store.ts';
import { outcomeDetail, outcomeTitle } from './words.ts';

/** The merge of `tab`'s pull request whose end needs the reader, unless the dialog shows it. */
function outcomeOf(tab: PullTab): JobView | undefined {
  const job = jobOf(tab);
  if (!job || outcomeTitle(job) === undefined) return undefined;
  const { dialog, seen } = merging.getState();
  if (seen.has(job.key)) return undefined;
  if (dialog && dialog.kind !== 'planning' && dialog.plan.key === job.key) return undefined;
  return job;
}

/** The first key of command `id`, as this system shows it. */
function keyOf(id: string): readonly string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

export function OutcomeBanner({ tab }: { tab: PullTab }) {
  // Read for their changes: the merge, and a newer push read since.
  useStore(merging);
  useStore(statuses);
  usePull(tab.id);
  const job = outcomeOf(tab);
  if (!job) return null;
  const actions: BannerAction[] = [];
  if (job.state.kind === 'refused') {
    const newer = newerOf(tab.id, job.state.refusal, job.head);
    if (newer) {
      actions.push({
        label: newerLabel(tab.id, newer),
        onClick: () => {
          dismissJob(job.key);
          seeNewer(tab.id, newer);
        },
      });
    }
  }
  if (job.state.kind === 'unknown') {
    actions.push({ label: 'Ask GitHub again', onClick: () => askAgain(job.key) });
  }
  actions.push({
    label: 'Merge panel',
    keys: keyOf('merge.panel'),
    onClick: () => openPanel(tab.id, tab.number),
  });
  return (
    <Banner
      tone={job.state.kind === 'refused' ? 'danger' : 'warn'}
      title={outcomeTitle(job)}
      detail={withoutBidi(outcomeDetail(job))}
      actions={actions}
      onDismiss={() => dismissJob(job.key)}
    />
  );
}

/** Whether a tab's banner shows: while its pull request's merge needs the reader. */
export const outcomeSwitch: BannerSwitch = {
  shows: (tab) => outcomeOf(tab) !== undefined,
  subscribe: (_tab, listener) => merging.subscribe(listener),
};
