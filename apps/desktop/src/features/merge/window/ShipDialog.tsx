// Approve and ship's dialog, in the tab feature's `tab.dialogs` slot: its two steps, the approval
// then what follows it, under one title and over the revision it approves, from the moment it opens
// until it's done. Only the steps' marks, the foot `Dialog` draws and the line above it change: the
// main button is busy while Lo checks and while each step runs, saying which, and nothing leaves the
// dialog from the press until it has run; a stop is a problem above the foot, with "Try again" or
// what its reason asks, and once it's done the line above the foot says so, with "Done" the one
// button, beside the mark's kiss where it merged. `⏎` presses the main button and `Esc` leaves. A
// held key confirms nothing, and nor does the press that opened it: only a fresh press of `⏎` once
// the plan shows.

import { Callout, Dialog, LogoMotion, Problem, Steps, type DialogState } from '@lo/ui';
import { ariaShortcut, keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { usePull, useTabState, withoutBidi } from '../../tab/window/shared.ts';
import type { ShipPlan } from '../contract.ts';
import { withBranch } from './chips.tsx';
import { askAgain, checking, jobsByKey, newerLabel, newerOf } from './merging.ts';
import { shapes } from './placing.ts';
import {
  checkApproval,
  confirmShip,
  labelsOf,
  leaveShip,
  panelFromShip,
  seeShipNewer,
  shipAgain,
  stillFinding,
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
import { confirmLabel, detailsOf, refusalText } from './words.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** A key written in Lo's notation as `aria-keyshortcuts` says it, for a screen reader. */
function shortcut(keys: string): string | undefined {
  return ariaShortcut(systemStrokes(parseKeys(keys), registry().system));
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
  /** A line under them, above the foot: what changed since the last plan, or how far a check is. */
  readonly line?: ReactNode;
  /** What went wrong, above the foot. */
  readonly problem?: Trouble | undefined;
  /** What it did, once it's done, above the foot, and whether it merged: the kiss marks that. */
  readonly done?: { readonly line: string; readonly landed: boolean } | undefined;
  /** Where it has got to, which the foot follows: nothing leaves it while it's `working`. */
  readonly state: DialogState;
  /** Its main button, `⏎`: busy while it works, "Done" once it has. */
  readonly primary: Primary;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** What the main button says while main checks the plan, before and as it's confirmed. */
const CHECKING = 'Checking…';

/**
 * The steps, as a list, and what it warns of a push after your approval. The branch it merges into
 * is drawn as a branch wherever a step names it.
 */
function StepList({ steps, plan }: { steps: readonly StepWords[]; plan: ShipPlan }) {
  const warning = shipWarning(plan);
  return (
    <>
      <Steps
        label="Steps"
        steps={steps.map((step) => ({
          ...step,
          title: withBranch(step.title, plan.base),
          detail: step.detail === undefined ? undefined : withBranch(step.detail, plan.base),
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

/**
 * The main button where it stopped, as `again` says, for view `id`'s pull request `number`;
 * `looking` while "Check again" looks for an approval whose answer was lost.
 */
function againOf(again: Again, id: string, number: number, looking: boolean): Primary {
  switch (again.kind) {
    case 'try':
      return { label: 'Try again', run: shipAgain, busy: false };
    case 'look':
      return { label: 'Check again', run: checkApproval, busy: looking, working: CHECKING };
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

/**
 * The foot and the line above it for how a run stands, `end`; `merged` once what it sent merged,
 * which the kiss marks, and `looking` while "Check again" looks for a lost approval.
 */
function endShown(
  end: End,
  id: string,
  number: number,
  label: string,
  merged = false,
  looking = false,
): Pick<Shown, 'primary' | 'state' | 'problem' | 'done'> {
  switch (end.kind) {
    case 'running':
      return {
        state: 'working',
        primary: { label, run: () => undefined, busy: true, working: end.working },
      };
    case 'done':
      return {
        state: 'done',
        primary: { label: 'Done', run: leaveShip, busy: false },
        done: { line: end.line, landed: merged },
      };
    case 'failed':
      return {
        state: 'failed',
        primary: againOf(end.again, id, number, looking),
        problem: { title: end.title, reason: end.reason, details: end.details },
      };
    default:
      end satisfies never;
      return { state: 'done', primary: { label: 'Done', run: leaveShip, busy: false } };
  }
}

function shownOf(dialog: Dialogue): Shown {
  switch (dialog.kind) {
    case 'planning':
      return {
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        step: 'planning',
        state: 'ask',
        primary: { label: shipLabel(), run: () => undefined, busy: true, working: CHECKING },
        body: undefined,
      };
    case 'confirm': {
      const { plan } = dialog;
      return {
        step: `confirm ${plan.key}`,
        // Pressed, main checks it again before anything is sent, and runs it: nothing leaves it.
        state: dialog.sending ? 'working' : 'ask',
        primary: {
          label: shipLabel(plan),
          run: confirmShip,
          busy: dialog.sending,
          working: CHECKING,
        },
        body: <StepList steps={plannedSteps(plan)} plan={plan} />,
        line: noteLine(dialog.note),
      };
    }
    case 'refused': {
      const { plan, refusal } = dialog;
      const body = plan && <StepList steps={plannedSteps(plan)} plan={plan} />;
      const head = plan?.head ?? refusal.newer?.from;
      const details = detailsOf(refusal);
      const said = refusalText(refusal);
      const step = `refused ${plan?.key ?? dialog.id}`;
      // Lo is still finding out where its merge would go: that's progress, not a failure, and the
      // dialog asks again as it goes.
      if (stillFinding(dialog)) {
        return {
          step: 'planning',
          state: 'ask',
          primary: { label: shipLabel(), run: () => undefined, busy: true, working: CHECKING },
          body,
          line: said === '' ? undefined : noteLine(said),
        };
      }
      if (refusal.newer !== null && head !== undefined) {
        const end = newerEnd(dialog.number, refusal, head);
        return {
          step,
          body,
          ...endShown(
            end.kind === 'failed' ? { ...end, details } : end,
            dialog.id,
            dialog.number,
            shipLabel(plan),
          ),
        };
      }
      return {
        step,
        body,
        state: 'failed',
        primary: { label: 'Try again', run: shipAgain, busy: false },
        problem: {
          // Asked before anything was sent: main couldn't plan it, or checking it again stopped it.
          title: plan ? `Couldn’t approve #${dialog.number}` : `Couldn’t check #${dialog.number}`,
          reason: said === '' ? undefined : said,
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
        ...endShown(
          shown.end,
          plan.id,
          plan.number,
          shipLabel(plan),
          job?.state.kind === 'merged',
          dialog.looking === true,
        ),
      };
    }
    default:
      dialog satisfies never;
      throw new Error(`a dialog Lo doesn’t know: ${JSON.stringify(dialog)}`);
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
  // On your own pull request, what follows the approval it skips.
  confirmLabel({ kind: 'enqueue', number: 0 }),
  confirmLabel({ kind: 'autoMerge', number: 0 }),
  CHECKING,
  'Approving…',
  'Merging…',
  'Adding…',
  'Turning on…',
  'Try again',
  'Check again',
  'Merge panel',
];

/** What's done, beside the mark's kiss where it merged, which plays once. */
function DoneRow({ line, landed }: { line: string; landed: boolean }) {
  return (
    <div className="flex items-center gap-12">
      {landed && <LogoMotion play="kiss" className="size-40" decorative />}
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
  useReplan(dialog, id);
  const button = useRef<HTMLButtonElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const shown = dialog && shownOf(dialog);
  const step = shown?.step;
  const open = dialog !== undefined;
  const head = headOf(dialog, id);
  const plan = dialog && dialog.kind !== 'planning' ? dialog.plan : undefined;
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
    if (shown && shown.state !== 'working' && !shown.primary.busy) shown.primary.run();
  };
  const primary = shown?.primary;
  const failed = shown?.state === 'failed';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveShip();
      }}
      title={open ? shipTitle(number, plan) : shipLabel()}
      description={description === '' ? undefined : withoutBidi(description)}
      size="md"
      state={shown?.state}
      action={{
        label: failed ? shipLabel(plan) : (primary?.label ?? shipLabel(plan)),
        again: failed ? (primary?.label ?? null) : undefined,
        onRun: () => primary?.run(),
        busy: primary?.busy === true,
        working: primary?.working,
        widest: widestOf([...WORDS, primary?.label]),
        keys: labels('enter'),
        shortcut: shortcut('enter'),
      }}
      leaveKeys={labels('esc')}
      mainRef={button}
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
      {shown?.done !== undefined && <DoneRow line={shown.done.line} landed={shown.done.landed} />}
    </Dialog>
  );
}

/** How long the dialog waits before it asks main again for a plan it's still finding out. */
const REPLAN_AFTER = 30_000;

/**
 * While main is still finding out where the merge after approving in `dialog` would go, as while
 * it looks up a stack's branches, asks it again whenever view `id`'s stack changes, and after a
 * while if it doesn't.
 */
function useReplan(dialog: Dialogue | undefined, id: string): void {
  const waiting = stillFinding(dialog);
  const shape = useTabState(shapes, id);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(shipAgain, REPLAN_AFTER);
    return () => clearTimeout(timer);
  }, [waiting, dialog]);
  const last = useRef(shape);
  useEffect(() => {
    if (waiting && last.current !== shape) shipAgain();
    last.current = shape;
  }, [waiting, shape]);
}
