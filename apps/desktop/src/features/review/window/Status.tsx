// The status bar's item for your pending review: "3 pending · ⌘⏎" while it holds comments, a button
// that opens the submit dialog. A view acting as nobody, or a run of a stack's layers, has none.

import { Key, StatusItem } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { usePull, useRun, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { openDialog } from './actions.ts';
import { counted, pendingCount } from './model.ts';
import { catchUp, pendings } from './store.ts';

/** A key, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

export function PendingItem({ tab }: { tab: PullTab }) {
  const pending = useTabState(pendings, tab.id);
  const pull = usePull(tab.id);
  const run = useRun(tab.id);
  // A view drawn before main said anything of its pending review asks once.
  useEffect(() => {
    if (pending === undefined) catchUp(tab.id);
  }, [pending, tab.id]);
  if (pull?.acting?.kind !== 'account' || run || !pending) return null;
  const count = pendingCount(pending);
  if (count === 0) return null;
  return (
    <StatusItem
      title={`Submit your review: ${counted(count, 'pending comment')}`}
      onClick={() => openDialog(tab)}
    >
      {count} pending
      <span aria-hidden="true">·</span>
      <Key keys={labels('cmd+enter')} quiet decorative />
    </StatusItem>
  );
}
