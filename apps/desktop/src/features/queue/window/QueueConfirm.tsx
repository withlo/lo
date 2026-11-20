// The merge queue's dialog, in the tab feature's `tab.dialogs` slot: the change `x` or `J` asks
// for, to confirm, with the account, the queue and the entry's place, and what else it does; then,
// when it didn't do what was asked, why. `⏎` confirms and `Esc` cancels. A held key confirms
// nothing, and nor does the press that opened it: only a fresh press of `⏎` once the question
// shows.

import {
  Branch,
  Button,
  Callout,
  Dialog,
  DialogSpacer,
  FactPerson,
  Facts,
  Key,
  Spinner,
  type FactItem,
} from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type { ActPlan } from '../contract.ts';
import {
  acting,
  confirmAct,
  confirmLabel,
  confirmTitle,
  effectsOf,
  endedTitle,
  leaveAct,
  ordinal,
  type QueueDialog,
} from './acting.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** What the dialog shows now. */
interface Shown {
  readonly title: string;
  readonly body: ReactNode;
  /** Its main button, `⏎`, if it has one now. */
  readonly primary: { readonly label: string; readonly busy: boolean } | undefined;
  /** What `Esc` says it does. */
  readonly close: string;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** What the change will do, as facts: who, in which queue, and where the entry stands. */
function factsOf(plan: ActPlan): FactItem[] {
  return [
    { label: 'As', value: <FactPerson login={plan.login} /> },
    { label: 'Queue', value: <Branch name={withoutBidi(plan.branch)} base /> },
    {
      label: 'Pull request',
      value: (
        <span className="min-w-0 truncate">
          #{plan.number} {withoutBidi(plan.title)}
        </span>
      ),
    },
    { label: 'Place', value: ordinal(plan.position) },
  ];
}

function shownOf(dialog: QueueDialog): Shown {
  switch (dialog.kind) {
    case 'planning':
      return {
        title: confirmTitle({ kind: dialog.asked, number: dialog.number, branch: dialog.branch }),
        step: 'planning',
        close: 'Cancel',
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        primary: { label: confirmLabel(dialog.asked), busy: true },
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Checking #{dialog.number} with GitHub
          </div>
        ),
      };
    case 'confirm': {
      const { plan } = dialog;
      return {
        title: confirmTitle(plan),
        step: `confirm ${plan.key}`,
        close: 'Cancel',
        primary: { label: confirmLabel(plan.kind), busy: dialog.sending },
        body: (
          <>
            <Facts items={factsOf(plan)} />
            {effectsOf(plan).map((line) => (
              <p key={line} className="m-0 text-fg text-small">
                {withoutBidi(line)}
              </p>
            ))}
            {dialog.note !== undefined && (
              <Callout tone="warning" role="status">
                {withoutBidi(dialog.note)}
              </Callout>
            )}
            {dialog.sending && (
              <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
                <Spinner />
                Checking #{plan.number} with GitHub, then sending. Cancel stops it until it’s sent.
              </div>
            )}
          </>
        ),
      };
    }
    case 'ended':
      return {
        title: confirmTitle(dialog.plan),
        step: `ended ${dialog.plan.key}`,
        close: 'Close',
        primary: undefined,
        body: (
          <Callout tone={dialog.how === 'refused' ? 'danger' : 'warning'} role="alert">
            <strong className="block font-semibold">{endedTitle(dialog.plan, dialog.how)}</strong>
            <span>{withoutBidi(dialog.why)}</span>
          </Callout>
        ),
      };
    default:
      dialog satisfies never;
      throw new Error(`a dialog Lo doesn't know: ${JSON.stringify(dialog)}`);
  }
}

/** The dialog's main button, with `⏎`. */
function PrimaryButton({
  primary,
  button,
}: {
  primary: NonNullable<Shown['primary']>;
  button: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Button
      ref={button}
      variant="primary"
      aria-disabled={primary.busy || undefined}
      onClick={(event) => {
        // Not a double click's second, which would press what came up in its place unseen.
        if (event.detail <= 1 && !primary.busy) confirmAct();
      }}
    >
      {primary.label}
      <Key keys={labels('enter')} decorative className="text-on-accent" />
    </Button>
  );
}

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"]';

/** When a key that has just gone down would have gone down, on the clock events are stamped by. */
function stampNow(): number {
  return new Event('lo-now').timeStamp;
}

/** The dialog, open while the queue's store says. */
export function QueueConfirm() {
  const dialog = useStore(acting, (state) => state.dialog);
  const button = useRef<HTMLButtonElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const shown = dialog && shownOf(dialog);
  const step = shown?.step;
  const open = dialog !== undefined;
  // A held key repeats, and focus follows each main button as it comes up, so a held `⏎` would
  // press the next one too. While the dialog is open, only a key's first press acts.
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
  // The main button takes focus as the dialog moves on, so `⏎` does what it says. Two frames: the
  // button that had it may have just gone, and the dialog takes focus back for itself first.
  useEffect(() => {
    shownAt.current = stampNow();
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => button.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Another control with focus, such as Cancel, takes its own press.
    const target = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
    if (target !== null && target !== button.current) return;
    event.preventDefault();
    // Only a fresh press, once what it would press is on screen.
    if (event.repeat || event.timeStamp < shownAt.current) return;
    if (shown?.primary && !shown.primary.busy) confirmAct();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveAct();
      }}
      title={withoutBidi(shown?.title ?? 'Merge queue')}
      foot={
        shown && (
          <>
            <DialogSpacer />
            <Button onClick={leaveAct}>
              {shown.close}
              <Key keys={labels('esc')} decorative />
            </Button>
            {shown.primary && <PrimaryButton primary={shown.primary} button={button} />}
          </>
        )
      }
      initialFocus={button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="queue-confirm"
    >
      {shown?.body}
    </Dialog>
  );
}
