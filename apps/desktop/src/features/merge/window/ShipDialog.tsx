// Approve and ship's dialog, in the tab feature's `tab.dialogs` slot: its two steps, the approval
// then what follows it, under one title and over the revision it approves, from the moment it opens
// until it's done. Only the steps' marks, the foot and the line above it change: the main button is
// busy while Lo checks and while each step runs, saying which, "Cancel" turns to "Close" the moment
// it's sent, a stop is a problem above the foot, with "Try again" or what its reason asks, and once
// it's done the line above the foot says so beside the mark's kiss, with "Done" the one button.
// `⏎` presses the main button and `Esc` leaves. A held key confirms nothing, and nor does the press
// that opened it: only a fresh press of `⏎` once the plan shows.

import { Button, Callout, Dialog, DialogSpacer, Key, LogoMotion, Problem, Steps } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { usePull, withoutBidi } from '../../tab/window/shared.ts';
import type { ShipPlan } from '../contract.ts';
import { askAgain, checking, jobsByKey, newerLabel, newerOf } from './merging.ts';
import {
  confirmShip,
  labelsOf,
  leaveShip,
  panelFromShip,
  seeShipNewer,
  shipAgain,
} from './shipping.ts';
import {
  newerEnd,
  plannedSteps,
  revision,
  runningOf,
  shipLabel,
  shipTitle,
  shipWarning,
  type Again,
  type End,
  type StepWords,
} from './shipWords.ts';
import { merging, shipping, statuses, type ShipDialog as Dialogue } from './store.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** The dialog's main button, as it is now. */
interface Primary {
  readonly label: string;
  readonly run: () => void;
  readonly busy: boolean;
  /** What it says while busy: "Approving…". */
  readonly working?: string | undefined;
}

/** What went wrong, above the foot. */
interface Trouble {
  readonly title: string;
  readonly reason?: string | undefined;
  readonly details?: string | undefined;
}

/** What the dialog shows now. */
interface Shown {
  /** The steps, the same from the question until it's done, but for their marks. */
  readonly body: ReactNode;
  /** A line under them, above the foot: what changed since the last plan. */
  readonly line?: ReactNode;
  /** What went wrong, above the foot. */
  readonly problem?: Trouble | undefined;
  /** What it did, once it's done, above the foot. */
  readonly done?: string | undefined;
  /** Its main button, `⏎`, always there: busy while it works, "Done" once it has. */
  readonly primary: Primary;
  /** The button that leaves, `Esc`: "Cancel" before anything is sent, then "Close". */
  readonly close: 'Cancel' | 'Close' | undefined;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** What the main button says while main checks the plan, before and as it's confirmed. */
const CHECKING = 'Checking…';

/** The steps, as a list, and what it warns of a push after your approval. */
function StepList({ steps, plan }: { steps: readonly StepWords[]; plan?: ShipPlan | undefined }) {
  const warning = plan && shipWarning(plan);
  return (
    <>
      <Steps
        label="Steps"
        steps={steps.map((step) => ({
          ...step,
          title: withoutBidi(step.title),
          detail: step.detail === undefined ? undefined : withoutBidi(step.detail),
        }))}
      />
      {warning !== undefined && (
        <Callout tone="warning" role="status">
          {withoutBidi(warning)}
        </Callout>
      )}
    </>
  );
}

/** What changed since the last plan, under the steps. */
function noteLine(note: string | undefined): ReactNode {
  return note === undefined ? undefined : (
    <p role="status" className="m-0 text-fg text-small">
      {withoutBidi(note)}
    </p>
  );
}

/** The main button where it stopped, as `again` says, for view `id`'s pull request `number`. */
function againOf(again: Again, id: string, number: number): Primary {
  switch (again.kind) {
    case 'try':
      return { label: 'Try again', run: shipAgain, busy: false };
    case 'look':
      return { label: 'Check again', run: shipAgain, busy: false, working: CHECKING };
    case 'panel':
      return { label: 'Merge panel', run: () => panelFromShip(id, number), busy: false };
    case 'check': {
      const { key } = again.job;
      return {
        label: 'Check again',
        run: () => void askAgain(key),
        busy: checking(key),
        working: CHECKING,
      };
    }
    case 'newer': {
      const newer = newerOf(id, again.refusal, again.head);
      if (newer === undefined) return { label: 'Try again', run: shipAgain, busy: false };
      return {
        label: newerLabel(id, newer),
        run: () => seeShipNewer(id, again.refusal, again.head),
        // Busy until Lo has read the newer revision.
        busy: newer.to === undefined,
      };
    }
    default:
      again satisfies never;
      return { label: 'Try again', run: shipAgain, busy: false };
  }
}

/** The foot and the line above it for how a run stands, `end`. */
function endShown(
  end: End,
  id: string,
  number: number,
): Pick<Shown, 'primary' | 'close' | 'problem' | 'done'> {
  switch (end.kind) {
    case 'running':
      return {
        primary: { label: shipLabel(), run: () => undefined, busy: true, working: end.working },
        close: 'Close',
      };
    case 'done':
      return {
        primary: { label: 'Done', run: leaveShip, busy: false },
        close: undefined,
        done: end.line,
      };
    case 'failed':
      return {
        primary: againOf(end.again, id, number),
        close: 'Close',
        problem: { title: end.title, reason: end.reason },
      };
    default:
      end satisfies never;
      return { primary: { label: 'Done', run: leaveShip, busy: false }, close: undefined };
  }
}

function shownOf(dialog: Dialogue): Shown {
  switch (dialog.kind) {
    case 'planning':
      return {
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        step: 'planning',
        close: 'Cancel',
        primary: { label: shipLabel(), run: () => undefined, busy: true, working: CHECKING },
        body: undefined,
      };
    case 'confirm': {
      const { plan } = dialog;
      return {
        step: `confirm ${plan.key}`,
        close: 'Cancel',
        // Pressed, main checks it again before anything is sent.
        primary: { label: shipLabel(), run: confirmShip, busy: dialog.sending, working: CHECKING },
        body: <StepList steps={plannedSteps(plan)} plan={plan} />,
        line: noteLine(dialog.note),
      };
    }
    case 'refused': {
      const { plan, refusal } = dialog;
      const body = plan && <StepList steps={plannedSteps(plan)} plan={plan} />;
      const head = plan?.head ?? refusal.newer?.from;
      const details = refusal.rules.length > 0 ? refusal.rules.join('\n') : undefined;
      const step = `refused ${plan?.key ?? dialog.id}`;
      if (refusal.newer !== null && head !== undefined) {
        return {
          step,
          body,
          ...endShown(newerEnd(dialog.number, refusal, head), dialog.id, dialog.number),
        };
      }
      return {
        step,
        body,
        close: 'Close',
        primary: { label: 'Try again', run: shipAgain, busy: false },
        problem: {
          // Asked before anything was sent: main couldn't plan it, or checking it again stopped it.
          title: plan ? `Couldn’t approve #${dialog.number}` : `Couldn’t check #${dialog.number}`,
          reason: refusal.text === '' ? undefined : refusal.text,
          details,
        },
      };
    }
    case 'running': {
      const { plan } = dialog;
      const view = shipping.getState().runs.get(plan.key);
      const phase = view?.phase;
      const job = phase?.kind === 'sending' ? jobsByKey(phase.job) : undefined;
      const shown = runningOf(plan, view, job);
      return {
        step: `running ${plan.key} ${phase?.kind ?? ''} ${shown.end.kind}`,
        body: <StepList steps={shown.steps} plan={plan} />,
        ...endShown(shown.end, plan.id, plan.number),
      };
    }
    default:
      dialog satisfies never;
      throw new Error(`a dialog Lo doesn't know: ${JSON.stringify(dialog)}`);
  }
}

/** The longest of `words`, which a button holds the room of from its first draw. */
function widestOf(words: readonly (string | undefined)[]): string {
  return words.reduce<string>(
    (wide, word) => (word && word.length > wide.length ? word : wide),
    '',
  );
}

/** What the main button may say, so it keeps one width from checking to done. */
const WORDS = [
  shipLabel(),
  CHECKING,
  'Approving…',
  'Merging…',
  'Adding…',
  'Turning on…',
  'Try again',
  'Check again',
  'Merge panel',
];

/** The dialog's main button, with `⏎`. It keeps one width and its fill from checking to done. */
function PrimaryButton({
  primary,
  button,
}: {
  primary: Primary;
  button: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Button
      ref={button}
      variant="primary"
      busy={primary.busy}
      working={primary.working}
      widest={widestOf([...WORDS, primary.label])}
      onClick={(event) => {
        // Not a double click's second, which would press what came up in its place unseen.
        if (event.detail <= 1 && !primary.busy) primary.run();
      }}
    >
      {primary.label}
      <Key keys={labels('enter')} decorative />
    </Button>
  );
}

/** What's done, beside the mark's kiss, which plays once. */
function DoneRow({ line }: { line: string }) {
  return (
    <div className="flex items-center gap-12">
      <LogoMotion play="kiss" className="size-40" decorative />
      <p role="status" className="m-0 text-fg text-ui">
        {withoutBidi(line)}
      </p>
    </div>
  );
}

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"]';

/** When a key that has just gone down would have gone down, on the clock events are stamped by. */
function stampNow(): number {
  return new Event('lo-now').timeStamp;
}

/** The view a dialog is about, and its pull request's number. */
function aboutOf(dialog: Dialogue | undefined): { id: string; number: number } {
  if (!dialog) return { id: '', number: 0 };
  return dialog.kind === 'planning' || dialog.kind === 'refused'
    ? { id: dialog.id, number: dialog.number }
    : { id: dialog.plan.id, number: dialog.plan.number };
}

/** The revision it approves, once the plan names it, else the head the merge status last read. */
function headOf(dialog: Dialogue | undefined, id: string): string | undefined {
  if (dialog && dialog.kind !== 'planning' && dialog.plan) return dialog.plan.head;
  const view = statuses.getState().views.get(id);
  return view?.kind === 'known' && view.state.head !== '' ? view.state.head : undefined;
}

/** The dialog, open while the store says. */
export function ShipDialog() {
  const dialog = useStore(shipping, (state) => state.dialog);
  // Read for their changes: the run, the merge it sent, what's being checked again, and a newer
  // push read since.
  useStore(shipping, (state) => state.runs);
  useStore(merging, (state) => state.jobs);
  useStore(merging, (state) => state.checking);
  useStore(statuses);
  const { id, number } = aboutOf(dialog);
  const pull = usePull(id);
  const button = useRef<HTMLButtonElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const shown = dialog && shownOf(dialog);
  const step = shown?.step;
  const open = dialog !== undefined;
  const head = headOf(dialog, id);
  // "Add a CLI flag · r3", the same in every state.
  const description = [pull?.header?.title ?? '', head ? revision(labelsOf(id), head) : '']
    .filter((part) => part !== '')
    .join(' · ');
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
    if (shown && !shown.primary.busy) shown.primary.run();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveShip();
      }}
      title={open ? shipTitle(number) : shipLabel()}
      description={description === '' ? undefined : withoutBidi(description)}
      size="md"
      foot={
        shown && (
          <>
            <DialogSpacer />
            {shown.close !== undefined && (
              <Button onClick={leaveShip}>
                {shown.close}
                <Key keys={labels('esc')} decorative />
              </Button>
            )}
            <PrimaryButton primary={shown.primary} button={button} />
          </>
        )
      }
      initialFocus={button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="ship-confirm"
    >
      {shown?.body}
      {shown?.line}
      {shown?.problem && (
        <Problem
          layout="inline"
          title={withoutBidi(shown.problem.title)}
          reason={
            shown.problem.reason === undefined ? undefined : withoutBidi(shown.problem.reason)
          }
          details={shown.problem.details}
        />
      )}
      {shown?.done !== undefined && <DoneRow line={shown.done} />}
    </Dialog>
  );
}
