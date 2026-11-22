// The merge queue's dialog, in the tab feature's `tab.dialogs` slot: the change `x` or `J` asks for,
// under one title and one body from the moment it opens until it's done: the account, the queue,
// the entry and its place, and what else the change does. Only the line above the foot and the
// foot change. The main button is busy while main checks the change and while it's sent, and after
// a failure reads "Try again", or what the reason offers, with the failure above the foot and
// GitHub's own words behind Details; when GitHub's answer was lost it reads "Check again", which
// only looks. The foot is the shared dialog foot: Cancel stops the change until it's sent; once it's
// sent nothing leaves it until GitHub answers; Close leaves after a failure. The dialog closes once
// the change went, and a toast says so. `⏎` presses the main button and `Esc` leaves. A held
// key presses nothing, and nor does the press that opened it: only a fresh press of `⏎` once what
// it would press shows.

import {
  Branch,
  Dialog,
  FactPerson,
  Facts,
  Problem,
  type DialogState,
  type FactItem,
} from '@lo/ui';
import { ariaShortcut, keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type { ActPlan } from '../contract.ts';
import {
  acting,
  checkAgain,
  confirmAct,
  confirmLabel,
  confirmTitle,
  effectsOf,
  leaveAct,
  nextLabel,
  ordinal,
  tryAgain,
  workingWord,
  type Failure,
  type QueueDialog,
  type Sketch,
} from './acting.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** A key written in Lo's notation as `aria-keyshortcuts` says it, for a screen reader. */
function shortcut(keys: string): string | undefined {
  return ariaShortcut(systemStrokes(parseKeys(keys), registry().system));
}

/** What the main button says while the change is checked, before it's sent. */
const CHECKING = 'Checking…';

/** What the dialog shows now, besides its title and its body, which stay. */
interface Shown {
  /** The line above the foot: what changed, why the question no longer stands, or what failed. */
  readonly line: ReactNode;
  /**
   * Its main button, `⏎`, if it has one now: busy while what it was pressed for runs, saying
   * `working`, and that's all that says so.
   */
  readonly primary:
    | {
        readonly label: string;
        readonly run: () => void;
        readonly busy: boolean;
        readonly working?: string;
      }
    | undefined;
  /**
   * Where it has got to, as the foot shows it: `ask` until the change is sent, when Cancel stops
   * it; `working` while it's sent, when nothing leaves it; `failed` once it didn't go, or isn't
   * known to have, or the question no longer stands, when Close leaves.
   */
  readonly state: DialogState;
  /** What focus follows: the main button moves to it when this changes. */
  readonly step: string;
}

/** What the change names, as facts: who, in which queue, and which entry, where it stands. */
function factsOf(
  named: Pick<Sketch, 'login' | 'branch' | 'number' | 'title' | 'position'>,
): FactItem[] {
  return [
    { label: 'As', value: <FactPerson login={named.login} /> },
    { label: 'Queue', value: <Branch name={withoutBidi(named.branch)} base /> },
    {
      label: 'Pull request',
      value: (
        <span className="min-w-0 truncate">
          #{named.number} {withoutBidi(named.title)}
        </span>
      ),
    },
    ...(named.position > 0 ? [{ label: 'Place', value: ordinal(named.position) }] : []),
  ];
}

/** The plan the dialog shows, once main has made one. */
function planOf(dialog: QueueDialog): ActPlan | undefined {
  const { step } = dialog;
  return step.kind === 'planning' ? step.again : step.plan;
}

/**
 * What the change will do: the same from the check to the end, so nothing in it moves as its
 * button is pressed. What leaves with an entry shows once main has planned it.
 */
function bodyOf(dialog: QueueDialog): ReactNode {
  const { sketch } = dialog;
  const plan = planOf(dialog);
  const effects = effectsOf({ kind: sketch.kind, above: plan?.above ?? [] });
  return (
    <>
      <Facts items={factsOf(plan ?? sketch)} />
      {effects.map((line) => (
        <p key={line} className="m-0 text-fg text-small">
          {withoutBidi(line)}
        </p>
      ))}
    </>
  );
}

/** A line above the foot that needs no answer. */
function Line({ children }: { children: string }) {
  return (
    <p role="status" className="m-0 text-fg text-small">
      {withoutBidi(children)}
    </p>
  );
}

/** What went wrong, above the foot: what failed, why, and GitHub's own words behind Details. */
function FailureLine({ failure }: { failure: Failure }) {
  return (
    <Problem
      title={withoutBidi(failure.title)}
      reason={failure.why === '' ? undefined : withoutBidi(failure.why)}
      details={failure.details}
    />
  );
}

function shownOf(dialog: QueueDialog): Shown {
  const { sketch, step } = dialog;
  const label = confirmLabel(sketch.kind);
  switch (step.kind) {
    case 'planning':
      return {
        step: 'planning',
        state: 'ask',
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        primary: { label, run: () => undefined, busy: true, working: CHECKING },
        line: step.note !== undefined && <Line>{step.note}</Line>,
      };
    case 'ask':
      return {
        step: `ask ${step.plan.key}`,
        state: 'ask',
        primary: { label, run: confirmAct, busy: false, working: CHECKING },
        line: step.note !== undefined && <Line>{step.note}</Line>,
      };
    case 'checking':
      return {
        step: `ask ${step.plan.key}`,
        // Main checks it again before it's sent: Cancel still stops it.
        state: 'ask',
        primary: { label, run: () => undefined, busy: true, working: CHECKING },
        line: undefined,
      };
    case 'sent':
      return {
        step: `ask ${step.plan.key}`,
        state: 'working',
        primary: { label, run: () => undefined, busy: true, working: workingWord(sketch.kind) },
        line: undefined,
      };
    case 'gone':
      return { step: 'gone', state: 'failed', primary: undefined, line: <Line>{step.why}</Line> };
    case 'failed': {
      const again = nextLabel(step.failure.next);
      return {
        step: `failed ${step.failure.title}`,
        state: 'failed',
        primary: again === undefined ? undefined : { label: again, run: tryAgain, busy: false },
        line: <FailureLine failure={step.failure} />,
      };
    }
    case 'unknown':
      return {
        step: 'unknown',
        state: 'failed',
        primary: { label: 'Check again', run: checkAgain, busy: step.looking, working: CHECKING },
        line: <FailureLine failure={step.failure} />,
      };
    default:
      step satisfies never;
      throw new Error(`a step Lo doesn't know: ${JSON.stringify(step)}`);
  }
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
    // Another control with focus, such as Cancel or Details, takes its own press.
    const target = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
    if (target !== null && target !== button.current) return;
    event.preventDefault();
    // Only a fresh press, once what it would press is on screen.
    if (event.repeat || event.timeStamp < shownAt.current) return;
    if (shown?.primary && !shown.primary.busy) shown.primary.run();
  };
  const working = dialog === undefined ? CHECKING : workingWord(dialog.sketch.kind);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveAct();
      }}
      title={dialog && withoutBidi(confirmTitle(dialog.sketch))}
      size="sm"
      state={shown?.state}
      action={
        shown && {
          label: shown.primary?.label ?? confirmLabel(dialog.sketch.kind),
          working: shown.primary?.working,
          onRun: () => shown.primary?.run(),
          busy: shown.primary?.busy === true,
          // After a failure, what it does then, if anything: else Close alone.
          again: shown.state === 'failed' ? (shown.primary?.label ?? null) : undefined,
          keys: labels('enter'),
          shortcut: shortcut('enter'),
          // As wide while it works as at rest.
          widest: working.length > CHECKING.length ? working : CHECKING,
        }
      }
      leaveKeys={labels('esc')}
      mainRef={button}
      initialFocus={button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="queue-confirm"
    >
      {dialog && bodyOf(dialog)}
      {shown?.line}
    </Dialog>
  );
}
