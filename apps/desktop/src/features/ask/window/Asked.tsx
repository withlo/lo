// The question main is asking, as Lo's own dialog: its title, what happens that the title doesn't
// say, then Cancel and the action. Cancel is the default: it has focus as the dialog opens, so `⏎`
// presses it, as `Esc` and a click outside do, and a key held down from what asked never presses
// the action. Only a key's first press acts while the dialog is open.

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
import { answer, asked, subscribeAsked } from './store.ts';

/** A key written in Lo's notation, such as `esc`, as this system shows it. */
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

/** `⏎` on the dialog itself, where a click leaves focus, is Cancel too. */
function cancelOnEnter(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (event.target instanceof Element && event.target.closest(CONTROLS) !== null) return;
  event.preventDefault();
  answer(false);
}

/** The dialog, open while main asks a question. */
export function Asked(): ReactNode {
  const question = useSyncExternalStore(subscribeAsked, asked);
  const cancel = useRef<HTMLButtonElement>(null);
  const open = question !== null;
  // A held key repeats: only a key's first press acts while the dialog is open.
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false);
      }}
      title={question?.title}
      size="sm"
      foot={
        <>
          <DialogSpacer />
          <Button ref={cancel} onClick={pressed(() => answer(false))}>
            Cancel
            <Key keys={labels('esc')} decorative />
          </Button>
          <Button variant="primary" onClick={pressed(() => answer(true))}>
            {question?.action}
          </Button>
        </>
      }
      initialFocus={cancel}
      onKeyDown={cancelOnEnter}
      container={document.getElementById('root')}
      testId="asked"
    >
      {question !== null && question.detail !== '' && (
        <p className="m-0 text-fg-muted">{question.detail}</p>
      )}
    </Dialog>
  );
}
