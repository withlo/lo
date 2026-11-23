// The banner on a pull request's tab for a merge Lo sent that needs the reader, once neither dialog
// is showing it: one line, what failed and why, and one button. GitHub refused it for a newer
// revision, with "Show r6"; Lo can't tell whether it merged, with "Check again", a read, busy while
// it looks; else the merge panel, `m`. Dismissing it forgets the merge.

import { Banner, type BannerAction } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { usePull, withoutBidi, type BannerSwitch, type PullTab } from '../../tab/window/shared.ts';
import type { JobView } from '../contract.ts';
import { openPanel } from './actions.ts';
import { askAgain, checking, dismissJob, newerLabel, newerOf, seeNewer } from './merging.ts';
import { jobOf, merging, shipping, shipShows, statuses } from './store.ts';
import { outcomeDetail, outcomeTitle } from './words.ts';

/** The merge of `tab`'s pull request whose end needs the reader, unless the dialog shows it. */
function outcomeOf(tab: PullTab): JobView | undefined {
  const job = jobOf(tab);
  if (!job || outcomeTitle(job) === undefined) return undefined;
  // The auto-merge watch's banner says what came of its own.
  if (job.watch === true) return undefined;
  const { dialog, seen } = merging.getState();
  if (seen.has(job.key)) return undefined;
  if (dialog && dialog.kind !== 'planning' && dialog.plan.key === job.key) return undefined;
  if (shipShows() === job.key) return undefined;
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
  useStore(shipping);
  useStore(statuses);
  usePull(tab.id);
  const job = outcomeOf(tab);
  if (!job) return null;
  const detail = outcomeDetail(job);
  return (
    <Banner
      tone={job.state.kind === 'refused' ? 'danger' : 'warn'}
      title={withoutBidi(outcomeTitle(job) ?? '')}
      detail={detail === '' ? undefined : withoutBidi(detail)}
      action={actionOf(tab, job)}
      onDismiss={() => dismissJob(job.key)}
    />
  );
}

/** The banner's one button for `job`: what its end asks for. */
function actionOf(tab: PullTab, job: JobView): BannerAction {
  if (job.state.kind === 'refused') {
    const newer = newerOf(tab.id, job.state.refusal, job.head);
    if (newer) {
      return {
        label: newerLabel(tab.id, newer),
        // Busy until Lo has read the newer revision.
        busy: newer.to === undefined,
        onClick: () => {
          if (newer.to === undefined) return;
          dismissJob(job.key);
          seeNewer(tab.id, newer);
        },
      };
    }
  }
  // A chain that stopped waiting to hear how its merge went asks the same.
  if (job.state.kind === 'unknown') {
    return {
      label: 'Check again',
      busy: checking(job.key),
      working: 'Checking…',
      onClick: () => void askAgain(job.key),
    };
  }
  return {
    label: 'Merge panel',
    keys: keyOf('merge.panel'),
    onClick: () => openPanel(tab.id, tab.number),
  };
}

/** Whether a tab's banner shows: while its pull request's merge needs the reader. */
export const outcomeSwitch: BannerSwitch = {
  shows: (tab) => outcomeOf(tab) !== undefined,
  subscribe(_tab, listener) {
    const merges = merging.subscribe(listener);
    const ships = shipping.subscribe(listener);
    return () => {
      merges();
      ships();
    };
  },
};
