// Approve and ship's dialog, in the tab feature's `tab.dialogs` slot: the steps it will take, the
// revision it approves named first, to confirm in one press; then each step as it goes, and where
// it stopped and why, when it did, saying whether it approved. `⏎` confirms and `Esc` cancels. A
// held key confirms nothing, and nor does the press that opened it: only a fresh press of `⏎` once
// the plan shows. Stopped after approving, `m` opens the merge panel.

import { Button, Callout, Dialog, DialogSpacer, Key, Spinner, Steps } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { useRevisions } from '../../revisions/window/shared.ts';
import { usePull, withoutBidi } from '../../tab/window/shared.ts';
import type { Refusal } from '../contract.ts';
import { askAgain, jobsByKey, newerLabel, newerOf } from './merging.ts';
import { confirmShip, labelsOf, leaveShip, panelFromShip, seeShipNewer } from './shipping.ts';
import {
  newerShown,
  plannedSteps,
  revision,
  runningOf,
  shipLabel,
  shipTitle,
  shipWarning,
  type End,
  type Pushes,
  type StepWords,
} from './shipWords.ts';
import { merging, shipping, statuses, type ShipDialog as Shown } from './store.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** A button of the dialog's foot, with its key. */
interface Action {
  readonly label: string;
  readonly run: () => void;
  readonly busy?: boolean;
}

/** What the dialog shows now. */
interface Showing {
  readonly title: string;
  readonly description?: string | undefined;
  readonly body: ReactNode;
  /** Its main button, `⏎`, if it has one now. */
  readonly primary: Action | undefined;
  /** "Merge panel", `m`, after a stop after approving. */
  readonly panel: Action | undefined;
  /** What `Esc` says it does, on a button of its own, unless the main button says it. */
  readonly close: string | undefined;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** The steps, as a list. */
function StepList({ steps }: { steps: readonly StepWords[] }) {
  return (
    <Steps
      label="Approve and ship"
      steps={steps.map((step) => ({
        ...step,
        title: withoutBidi(step.title),
        detail: step.detail === undefined ? undefined : withoutBidi(step.detail),
      }))}
    />
  );
}

/** Why it didn't start, in the core's words, each rule GitHub named on a line of its own. */
function RefusalCallout({ refusal }: { refusal: Refusal }) {
  return (
    <Callout tone="danger" role="alert">
      <span>{withoutBidi(refusal.text)}</span>
      {refusal.rules.length > 0 && (
        <ul className="m-0 mt-6 ps-16">
          {refusal.rules.map((rule) => (
            <li key={rule}>{withoutBidi(rule)}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}

/** "See r2 → r3", for a refusal that names a newer push. */
function newerAction(id: string, refusal: Refusal, head: string): Action | undefined {
  const newer = newerOf(id, refusal, head);
  if (newer === undefined) return undefined;
  return { label: newerLabel(id, newer), run: () => seeShipNewer(id, refusal, head) };
}

/** The buttons for how a run ended, `end`. */
function endActions(
  end: End,
  id: string,
  number: number,
): Pick<Showing, 'primary' | 'panel' | 'close'> {
  switch (end.kind) {
    case 'running':
      return { primary: undefined, panel: undefined, close: 'Close' };
    case 'done':
      return { primary: undefined, panel: undefined, close: 'Close' };
    case 'stopped':
      return {
        primary: { label: 'Done', run: leaveShip },
        panel: end.panel
          ? { label: 'Merge panel', run: () => panelFromShip(id, number) }
          : undefined,
        close: undefined,
      };
    case 'newer':
      return {
        primary: newerAction(id, end.refusal, end.head),
        panel: undefined,
        close: 'Close',
      };
    case 'unsure':
      return {
        primary: { label: 'Ask GitHub again', run: () => askAgain(end.job.key) },
        panel: undefined,
        close: 'Close',
      };
    default:
      end satisfies never;
      return { primary: undefined, panel: undefined, close: 'Close' };
  }
}

function showingOf(dialog: Shown, pushes: (id: string) => Pushes, title: string): Showing {
  switch (dialog.kind) {
    case 'planning':
      return {
        title: `Approve and ship #${dialog.number}`,
        step: 'planning',
        close: 'Cancel',
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        primary: { label: 'Approve and ship', run: () => undefined, busy: true },
        panel: undefined,
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Checking #{dialog.number} with GitHub
          </div>
        ),
      };
    case 'confirm': {
      const { plan } = dialog;
      const at = revision(pushes(plan.id).label, plan.head);
      const warning = shipWarning(plan);
      return {
        title: shipTitle(plan.number),
        description: title === '' ? at : `${title} · ${at}`,
        step: `confirm ${plan.key}`,
        close: 'Cancel',
        primary: { label: shipLabel(plan.approval), run: confirmShip, busy: dialog.sending },
        panel: undefined,
        body: (
          <>
            <StepList steps={plannedSteps(plan, pushes(plan.id).label)} />
            {warning !== undefined && (
              <Callout tone="warning" role="status">
                {withoutBidi(warning)}
              </Callout>
            )}
            {dialog.note !== undefined && (
              <Callout tone="warning" role="status">
                {withoutBidi(dialog.note)}
              </Callout>
            )}
            {dialog.sending && (
              <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
                <Spinner />
                Checking #{plan.number} with GitHub before anything is sent. Cancel stops it.
              </div>
            )}
          </>
        ),
      };
    }
    case 'refused': {
      const { refusal } = dialog;
      const head = dialog.plan?.head ?? refusal.newer?.from;
      if (refusal.newer !== null && head !== undefined) {
        const shown = newerShown(
          { repo: dialog.plan?.repo ?? '', number: dialog.number },
          refusal,
          head,
          pushes(dialog.id),
        );
        return {
          title: shown.title,
          description: shown.description,
          step: `refused ${dialog.plan?.key ?? dialog.id}`,
          ...endActions(shown.end, dialog.id, dialog.number),
          body: <StepList steps={shown.steps} />,
        };
      }
      return {
        title: shipTitle(dialog.number),
        description: 'Nothing was approved or merged.',
        step: `refused ${dialog.plan?.key ?? dialog.id}`,
        close: 'Close',
        primary: undefined,
        panel: undefined,
        body: <RefusalCallout refusal={refusal} />,
      };
    }
    case 'running': {
      const { plan } = dialog;
      const view = shipping.getState().runs.get(plan.key);
      const phase = view?.phase;
      const job = phase?.kind === 'sending' ? jobsByKey(phase.job) : undefined;
      const shown = runningOf(plan, view, job, pushes(plan.id));
      return {
        title: shown.title,
        description: shown.description,
        step: `running ${plan.key} ${phase?.kind ?? ''} ${shown.end.kind}`,
        ...endActions(shown.end, plan.id, plan.number),
        body: (
          <>
            <StepList steps={shown.steps} />
            {shown.end.kind === 'running' && (
              <p className="m-0 text-fg-muted text-small">
                You can close this; a toast says how it ends.
              </p>
            )}
          </>
        ),
      };
    }
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
  primary: Action;
  button: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Button
      ref={button}
      variant="primary"
      aria-disabled={primary.busy || undefined}
      onClick={(event) => {
        // Not a double click's second, which would press what came up in its place unseen.
        if (event.detail <= 1 && !primary.busy) primary.run();
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

/** The view a dialog is about. */
function idOf(dialog: Shown | undefined): string {
  if (!dialog) return '';
  return dialog.kind === 'planning' || dialog.kind === 'refused' ? dialog.id : dialog.plan.id;
}

/** The dialog, open while the store says. */
export function ShipDialog() {
  const dialog = useStore(shipping, (state) => state.dialog);
  // Read for their changes: the run, the merge it sent, and a newer push read since.
  useStore(shipping, (state) => state.runs);
  useStore(merging, (state) => state.jobs);
  useStore(statuses);
  const id = idOf(dialog);
  const pull = usePull(id);
  const revisions = useRevisions(id);
  const button = useRef<HTMLButtonElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const pushes = (view: string): Pushes => ({
    label: labelsOf(view),
    revisions: view === id ? revisions?.revisions : undefined,
    now: Date.now(),
  });
  const shown = dialog && showingOf(dialog, pushes, pull?.header?.title ?? '');
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
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Only a fresh press, once what it would press is on screen.
    const fresh = !event.repeat && event.timeStamp >= shownAt.current;
    if (event.key === 'm' && shown?.panel) {
      event.preventDefault();
      if (fresh) shown.panel.run();
      return;
    }
    if (event.key !== 'Enter') return;
    // Another control with focus, such as Cancel, takes its own press.
    const target = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
    if (target !== null && target !== button.current) return;
    event.preventDefault();
    if (fresh && shown?.primary && !shown.primary.busy) shown.primary.run();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveShip();
      }}
      title={withoutBidi(shown?.title ?? 'Approve and ship')}
      description={shown?.description === undefined ? undefined : withoutBidi(shown.description)}
      foot={
        shown && (
          <>
            <DialogSpacer />
            {shown.panel && (
              <Button onClick={shown.panel.run}>
                {shown.panel.label}
                <Key keys={labels('m')} decorative />
              </Button>
            )}
            {shown.close !== undefined && (
              <Button onClick={leaveShip}>
                {shown.close}
                <Key keys={labels('esc')} decorative />
              </Button>
            )}
            {shown.primary && <PrimaryButton primary={shown.primary} button={button} />}
          </>
        )
      }
      initialFocus={button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="ship-confirm"
    >
      {shown?.body}
    </Dialog>
  );
}
