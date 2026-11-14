// The dialog that asks before your comment is deleted, in the tab feature's `tab.dialogs` slot: the
// comment's first line, whether it leaves your pending review, and whether its thread goes with
// it. Delete (`⏎`) deletes it; Cancel (`Esc`) leaves it. A held or repeated key never presses
// either: while the dialog is open, only a key's first press acts.

import { Button, Dialog, DialogSpacer, Key } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { cancelDelete, confirmDelete, deleteAsking, subscribeAsking } from './acts.ts';
import { excerptOf } from './Card.tsx';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/**
 * `run`, for a button's click, but not for a double click's second, which would press what comes
 * up in its place unseen.
 */
function pressed(run: () => void): (event: MouseEvent) => void {
  return (event) => {
    if (event.detail <= 1) run();
  };
}

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"]';

/** What deleting it does beyond the comment, as the dialog says it. */
export function deleteNotes(asking: { pending: boolean; onlyComment: boolean }): string[] {
  const notes: string[] = [];
  if (asking.pending) notes.push('It leaves your pending review.');
  if (asking.onlyComment) notes.push('It’s the thread’s only comment, so the thread goes too.');
  return notes;
}

/** The dialog, open while a comment's delete is asked for. */
export function DeleteDialog(): ReactNode {
  const asking = useSyncExternalStore(subscribeAsking, deleteAsking);
  const primary = useRef<HTMLButtonElement>(null);
  const open = asking !== undefined;
  // A held `d` or `⏎` repeats: only a key's first press acts while the dialog is open.
  useEffect(() => {
    if (!open) return undefined;
    const held = (event: globalThis.KeyboardEvent) => {
      if (!event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', held, true);
    return () => document.removeEventListener('keydown', held, true);
  }, [open]);
  // `⏎` on the dialog itself, where a click leaves focus, presses Delete.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest(CONTROLS) !== null) return;
    event.preventDefault();
    primary.current?.click();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelDelete();
      }}
      title="Delete your comment?"
      description={asking && excerptOf(asking.body)}
      foot={
        <>
          <DialogSpacer />
          <Button onClick={pressed(cancelDelete)}>
            Cancel
            <Key keys={labels('esc')} decorative />
          </Button>
          <Button ref={primary} variant="primary" onClick={pressed(() => void confirmDelete())}>
            Delete
            <Key keys={labels('enter')} decorative className="text-on-accent" />
          </Button>
        </>
      }
      initialFocus={primary}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="delete-comment"
    >
      {asking &&
        deleteNotes(asking).map((note) => (
          <p key={note} className="m-0 text-fg-muted">
            {note}
          </p>
        ))}
    </Dialog>
  );
}
