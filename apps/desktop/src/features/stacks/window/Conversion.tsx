// The dialog for converting a chain to a GitHub stack, in the tab feature's `tab.dialogs` slot. One
// title and one body from the check to the end: the account it acts as and the steps it sends, each
// marked as main sends it, with the steps that undo them below once asked for. Only the buttons
// and the line above them change: what GitHub will show, then that it's done, stopped or undone, or
// what went wrong.

import {
  Button,
  clock,
  Dialog,
  DialogSpacer,
  FactPerson,
  Facts,
  Key,
  Problem,
  Steps,
  type StepItem,
  type StepState,
} from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type { Change, ChangeRow, ChangeStatus, ConversionView } from '../contract.ts';
import {
  confirm,
  CONVERT,
  CONVERTED,
  dismiss,
  openOnGithub,
  putBack,
  TITLE,
  tryAgain,
} from './actions.ts';
import { stacksStore, type Dialog as Open, type Failure } from './store.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop();
  if (last === undefined) return '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/** A branch's name, in code type: GitHub's text, which may be long, so it breaks if it must. */
function Branch({ name }: { name: string }) {
  return <span className="break-words code-small">{withoutBidi(name)}</span>;
}

/** How each change's state shows as a step. */
const STEP: Readonly<Record<ChangeStatus, StepState>> = {
  todo: 'todo',
  now: 'now',
  done: 'done',
  unchanged: 'done',
  failed: 'stopped',
  unknown: 'stopped',
  left: 'skipped',
  skipped: 'skipped',
};

/** What a change is, as its step says it. */
function changeTitle(change: Change): ReactNode {
  switch (change.kind) {
    case 'retarget':
      return (
        <>
          Move #{change.pr} onto <Branch name={change.to} />.
        </>
      );
    case 'create':
      return `Create the GitHub stack from ${numbers(change.prs)}.`;
    case 'add':
      return `Add ${numbers(change.prs)} to the GitHub stack.`;
    case 'unstack':
      return 'Unstack the GitHub stack.';
    default:
      throw new Error(`a change Lo doesn’t know: ${JSON.stringify(change satisfies never)}`);
  }
}

/** "GitHub’s rate limit resets at 14:05.", while GitHub has asked Lo to hold off. */
function waiting(until: number): string {
  return `GitHub’s rate limit resets at ${clock(until)}.`;
}

/**
 * The line under a step: where a base branch moves from, that it was so already, that its answer
 * was lost, what it was left as, or, on the step being sent, when GitHub lets it go.
 */
function changeDetail(row: ChangeRow, waitingUntil: number | null): ReactNode {
  const { change, status } = row;
  if (status === 'now' && waitingUntil !== null) return waiting(waitingUntil);
  switch (status) {
    case 'unchanged':
      return change.kind === 'retarget' ? (
        <>
          Already on <Branch name={change.to} />.
        </>
      ) : undefined;
    case 'unknown':
      return 'Not confirmed';
    case 'left':
      // A base branch changed elsewhere names the branch; a stack that changed says how.
      return change.kind === 'retarget' ? (
        <>
          Its base branch is now <Branch name={row.detail ?? ''} />.
        </>
      ) : (
        withoutBidi(row.detail ?? '')
      );
    case 'skipped':
      // A stack step undoing found wasn't made says so.
      if (change.kind !== 'retarget' && row.detail !== null) return withoutBidi(row.detail);
      return change.kind === 'retarget' ? (
        <>
          From <Branch name={change.from} />.
        </>
      ) : undefined;
    case 'todo':
    case 'now':
    case 'done':
    case 'failed':
      return change.kind === 'retarget' ? (
        <>
          From <Branch name={change.from} />.
        </>
      ) : undefined;
    default:
      throw new Error(`a state Lo doesn’t know: ${JSON.stringify(status satisfies never)}`);
  }
}

function stepsOf(rows: readonly ChangeRow[], which: string, waitingUntil: number | null) {
  return rows.map((row, index): StepItem => ({
    key: `${which}${index}`,
    state: STEP[row.status],
    title: changeTitle(row.change),
    detail: changeDetail(row, waitingUntil),
  }));
}

/** A button in the foot: what it says, what it runs, and what it says while it runs. */
interface FootButton {
  readonly label: string;
  readonly run: () => void;
  readonly busy?: boolean;
  /** What it says while busy, the verb of its label: "Converting…". */
  readonly working?: string;
  /** Whether `Esc` presses it too: the button that leaves, or stops what's being sent. */
  readonly leaves?: boolean;
}

/** What went wrong, above the buttons. */
interface Said {
  readonly title: string;
  readonly reason: string | null;
  readonly details: string | null;
}

/** What the dialog shows now. */
interface Shown {
  readonly description?: string | undefined;
  /** Who it acts as, once the plan says. */
  readonly login?: string | undefined;
  readonly steps: readonly StepItem[];
  /** The steps that undo the conversion, once asked for. */
  readonly undo: readonly StepItem[];
  /** The line above the buttons, while nothing went wrong. */
  readonly line?: string | null | undefined;
  readonly problem?: Said | undefined;
  /**
   * Whether the problem is that Lo can't tell if it went, which GitHub's page says: nothing is known
   * to have failed, so it's in the warn tone.
   */
  readonly unsure?: boolean;
  /** Its main button, `⏎`. */
  readonly primary: FootButton;
  /** The others, before it. */
  readonly others: readonly FootButton[];
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

const LEAVE_CANCEL: FootButton = { label: 'Cancel', run: dismiss, leaves: true };
const LEAVE_CLOSE: FootButton = { label: 'Close', run: dismiss, leaves: true };

/** What a failure to ask main says, under `title`. */
function said(title: string, failure: Failure | undefined): Said | undefined {
  return failure && { title, reason: failure.reason, details: failure.details };
}

/** The steps a plan sends, none sent yet. */
function planned(changes: readonly Change[]): StepItem[] {
  return stepsOf(
    changes.map((change) => ({ change, status: 'todo', detail: null })),
    'c',
    null,
  );
}

function planningShown(open: Extract<Open, { kind: 'planning' }>): Shown {
  const problem = said('Couldn’t check the stack', open.problem);
  return {
    steps: [],
    undo: [],
    problem,
    primary: problem
      ? { label: 'Try again', run: tryAgain, busy: false }
      : { label: CONVERT, run: () => undefined, busy: true, working: 'Checking…' },
    others: [problem ? LEAVE_CLOSE : LEAVE_CANCEL],
    step: problem ? 'unchecked' : 'planning',
  };
}

function confirmShown(open: Extract<Open, { kind: 'confirm' }>): Shown {
  const { plan } = open;
  const problem = said('Couldn’t convert to GitHub stack', open.problem);
  return {
    description: plan.description,
    login: plan.login,
    steps: planned(plan.changes),
    undo: [],
    line: problem ? undefined : plan.warning,
    problem,
    primary: problem
      ? { label: 'Try again', run: tryAgain, busy: false }
      : { label: CONVERT, run: confirm, busy: open.sending, working: 'Converting…' },
    others: [problem ? LEAVE_CLOSE : LEAVE_CANCEL],
    step: `confirm ${plan.key} ${problem ? 'failed' : ''}`,
  };
}

/** The button that undoes a conversion's changes, busy while it does. */
function undoButton(working: boolean): FootButton {
  return { label: 'Undo changes', run: putBack, busy: working, working: 'Undoing…' };
}

function conversionShown(
  open: Extract<Open, { kind: 'conversion' }>,
  view: ConversionView | undefined,
): Shown {
  const { plan } = open;
  const base = {
    description: plan.description,
    login: plan.login,
    steps: view
      ? stepsOf(view.changes, 'c', view.putBack.length > 0 ? null : view.waitingUntil)
      : planned(plan.changes),
    undo: view ? stepsOf(view.putBack, 'u', view.waitingUntil) : [],
  };
  // Undoing couldn't be asked for.
  const refused = said('Couldn’t undo the changes', open.problem);
  const stop: FootButton = {
    label: 'Cancel',
    run: dismiss,
    leaves: true,
    busy: view?.stopping === true,
    working: 'Stopping…',
  };
  const phase = view?.phase ?? 'running';
  switch (phase) {
    case 'running':
      return {
        ...base,
        primary: { label: CONVERT, run: () => undefined, busy: true, working: 'Converting…' },
        others: [stop],
        step: 'running',
      };
    case 'puttingBack':
      return { ...base, primary: undoButton(true), others: [stop], step: 'puttingBack' };
    case 'done':
      return {
        ...base,
        line: view?.line ?? CONVERTED,
        primary: { label: 'Done', run: dismiss },
        others: [],
        step: 'done',
      };
    case 'failed':
    case 'stopped':
    case 'putBack': {
      if (open.asking) {
        return { ...base, primary: undoButton(true), others: [LEAVE_CLOSE], step: 'asking' };
      }
      const problem = refused ?? view?.problem ?? undefined;
      const undo = view?.undo === true;
      const link = view?.problem?.link ?? null;
      const step = `${phase} ${String(undo)} ${link ?? ''} ${refused ? 'refused' : ''}`;
      // Undone, or left as it was: nothing more to do but close.
      if (phase === 'putBack' && !undo) {
        return {
          ...base,
          line: view?.line,
          problem,
          primary: { label: 'Close', run: dismiss },
          others: [],
          step,
        };
      }
      // Undoing went wrong, or stopped, and what's left can be undone again.
      if (phase === 'putBack' || refused) {
        return {
          ...base,
          line: view?.line,
          problem,
          primary: { label: 'Try again', run: putBack, busy: false },
          others: [LEAVE_CLOSE],
          step,
        };
      }
      const again: FootButton =
        link === null
          ? { label: 'Try again', run: tryAgain, busy: false }
          : // Not confirmed: GitHub's page shows whether it went.
            { label: 'Open on GitHub', run: () => openOnGithub(link) };
      return {
        ...base,
        line: view?.line,
        problem,
        unsure: link !== null,
        primary: again,
        others: [LEAVE_CLOSE, ...(undo ? [undoButton(false)] : [])],
        step,
      };
    }
    default:
      throw new Error(`a phase Lo doesn’t know: ${JSON.stringify(phase satisfies never)}`);
  }
}

function shownOf(open: Open, views: ReadonlyMap<string, ConversionView>): Shown {
  switch (open.kind) {
    case 'planning':
      return planningShown(open);
    case 'confirm':
      return confirmShown(open);
    case 'conversion':
      return conversionShown(open, views.get(open.key));
    default:
      throw new Error(`a dialog Lo doesn’t know: ${JSON.stringify(open satisfies never)}`);
  }
}

/** What the dialog says: who it acts as, the steps, and the line above its buttons. */
function Body({ shown }: { shown: Shown }) {
  const { problem, line, unsure } = shown;
  return (
    <>
      {shown.login !== undefined && (
        <Facts items={[{ label: 'As', value: <FactPerson login={shown.login} /> }]} />
      )}
      {shown.steps.length > 0 && <Steps label="Steps" steps={shown.steps} />}
      {shown.undo.length > 0 && (
        <div className="flex flex-col gap-8">
          <h3 className="m-0 text-small-medium text-fg-muted">Undo</h3>
          <Steps label="Undo" steps={shown.undo} />
        </div>
      )}
      {problem === undefined && line !== undefined && line !== null && (
        <p role="status" className="m-0 text-fg text-small">
          {withoutBidi(line)}
        </p>
      )}
      {problem !== undefined && (
        <Problem
          layout="inline"
          tone={unsure === true ? 'warn' : 'danger'}
          title={problem.title}
          // A reason may name a branch: GitHub's text.
          reason={problem.reason === null ? undefined : withoutBidi(problem.reason)}
          details={problem.details === null ? undefined : withoutBidi(problem.details)}
        />
      )}
    </>
  );
}

/** A button of the foot. The main one takes `⏎` and focus; the one that leaves shows `Esc`. */
function FootAction({
  button,
  primary = false,
  buttonRef,
}: {
  button: FootButton;
  primary?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const keys = primary ? labels('enter') : button.leaves ? labels('esc') : undefined;
  const busy = button.busy === true;
  return (
    <Button
      ref={buttonRef}
      variant={primary ? 'primary' : 'secondary'}
      busy={button.working === undefined ? undefined : busy}
      working={button.working}
      onClick={(event) => {
        // Not a double click's second, which would press what came up in its place unseen.
        if (event.detail <= 1 && !busy) button.run();
      }}
    >
      {button.label}
      {keys && <Key keys={keys} decorative />}
    </Button>
  );
}

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"]';

/** The dialog, open while the store says. */
export function ConversionDialog() {
  const open = useStore(stacksStore, (state) => state.dialog);
  const views = useStore(stacksStore, (state) => state.conversions);
  const primary = useRef<HTMLButtonElement>(null);
  const shown = open && shownOf(open, views);
  const step = shown?.step;
  const isOpen = open !== undefined;
  // A held key repeats, and focus follows each main button as it comes up, so a held `⏎` would
  // press the next one too, such as "Convert to GitHub stack" after "Try again". While the dialog
  // is open, only a key's first press acts: a repeat is stopped before a button, or anything else,
  // sees it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const held = (event: globalThis.KeyboardEvent) => {
      if (!event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', held, true);
    return () => document.removeEventListener('keydown', held, true);
  }, [isOpen]);
  // The main button takes focus as the dialog moves on, so `⏎` does what it says. Two frames: the
  // button that had it may have just gone, and the dialog takes focus back for itself first.
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => primary.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);
  // `⏎` on the dialog itself, where a click leaves focus, presses its main button.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest(CONTROLS) !== null) return;
    event.preventDefault();
    primary.current?.click();
  };
  return (
    <Dialog
      open={open !== undefined && (open.kind !== 'planning' || open.shown)}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
      size="md"
      title={TITLE}
      description={shown?.description}
      foot={
        shown && (
          <>
            <DialogSpacer />
            {shown.others.map((button) => (
              <FootAction key={button.label} button={button} />
            ))}
            <FootAction button={shown.primary} primary buttonRef={primary} />
          </>
        )
      }
      initialFocus={primary}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="make-stack"
    >
      {shown && <Body shown={shown} />}
    </Dialog>
  );
}
