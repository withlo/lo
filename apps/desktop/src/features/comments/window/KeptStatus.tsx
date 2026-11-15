// What the comments say in a pull request's tab's status bar: one note for the drafts the diff,
// drawn again, had nowhere to open, a draft's own or "2 drafts kept", and on hover where each is and
// that it opens when its lines, its thread or its code block are shown again. A click says the same
// in a note, as "Show where kept drafts are" does from the palette and the app menu.

import { StatusItem } from '@lo/ui';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { keptAway, keptSummary, showKeptDrafts } from './boxes.ts';

export function KeptStatus({ tab }: { tab: PullTab }) {
  const summary = keptSummary(useTabState(keptAway, tab.id));
  if (!summary) return null;
  return (
    <StatusItem title={summary.title} onClick={() => showKeptDrafts(tab.id)}>
      {summary.note}
    </StatusItem>
  );
}
