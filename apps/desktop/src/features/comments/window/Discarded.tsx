// What "Discard draft" says it did, among the window's toasts, with the way back: "Undo" opens the
// box again where it was, with its text. It goes by itself once the draft can't come back.

import { Toast } from '@lo/ui';
import { useSyncExternalStore } from 'react';

import { lastDiscarded, onDiscarded, undiscard } from './boxes.ts';
import { DISCARDED, UNDO } from './writing.ts';

export function DiscardedToast() {
  const last = useSyncExternalStore(onDiscarded, lastDiscarded);
  if (last === undefined) return null;
  return <Toast tone="info" title={DISCARDED} action={{ label: UNDO, onClick: undiscard }} />;
}
