// Where the mouse submits a review: the header's "Submit review…", beside the merge status, always
// there, and dimmed with why while the view can't submit; and the status bar's item for your
// pending review, "3 pending comments", while it holds comments, whose tooltip names the command and
// its key. Each runs `review.submit`, as its key does.

import { Button, Key, keyAria, StatusItem, Tooltip } from '@lo/ui';
import { controlOf, heldRegistry, runControl } from '@lo/ui/commands';
import { useEffect, useId, useSyncExternalStore } from 'react';

import { usePull, useRun, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { counted, pendingCount } from './model.ts';
import { catchUp, pendings } from './store.ts';

/** The command both run. */
const SUBMIT = 'review.submit';

/** How many times the keys have changed, which draws each control again. */
let changes = 0;

const subscribe = (listener: () => void): (() => void) =>
  heldRegistry()?.subscribe(() => {
    changes += 1;
    listener();
  }) ?? (() => undefined);

/** Draws again as the keymap changes, so a control never shows a key that has moved. */
function useKeymap(): void {
  useSyncExternalStore(
    subscribe,
    () => changes,
    () => 0,
  );
}

/** The header's button, beside the merge status: dimmed, with why, while the view can't submit. */
export function SubmitButton({ tab }: { tab: PullTab }) {
  // Read for their changes: the account the view acts as, and whether it shows a run of layers.
  usePull(tab.id);
  useRun(tab.id);
  useKeymap();
  const why = useId();
  const control = controlOf(SUBMIT);
  if (!control) return null;
  const off = control.off !== undefined;
  return (
    <>
      <Button
        aria-disabled={off || undefined}
        aria-describedby={off ? why : undefined}
        hint={control.off ?? null}
        {...keyAria(control.keys, control.shortcut)}
        onClick={() => {
          if (!off) runControl(SUBMIT);
        }}
      >
        {control.label}
        {control.keys && <Key keys={control.keys} decorative />}
      </Button>
      {off && (
        <span id={why} className="sr-only">
          {control.off}
        </span>
      )}
    </>
  );
}

/** The status bar's item: how many comments your pending review holds, which opens the dialog. */
export function PendingItem({ tab }: { tab: PullTab }) {
  const pending = useTabState(pendings, tab.id);
  const pull = usePull(tab.id);
  const run = useRun(tab.id);
  useKeymap();
  // A view drawn before main said anything of its pending review asks once.
  useEffect(() => {
    if (pending === undefined) catchUp(tab.id);
  }, [pending, tab.id]);
  if (pull?.acting?.kind !== 'account' || run || !pending) return null;
  const count = pendingCount(pending);
  if (count === 0) return null;
  const control = controlOf(SUBMIT);
  return (
    // The item takes no tooltip of its own: this one names its command and key.
    <Tooltip label={control?.label ?? null} keys={control?.keys} side="top">
      <span className="inline-flex min-w-0">
        <StatusItem onClick={() => runControl(SUBMIT)}>
          {counted(count, 'pending comment')}
        </StatusItem>
      </span>
    </Tooltip>
  );
}
