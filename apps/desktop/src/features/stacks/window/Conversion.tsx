// The dialog for making a chain a GitHub stack, in the tab feature's `tab.dialogs` slot: the plan to
// confirm, every change as main sends it, and, when it stops partway, what changed, GitHub's reason
// and how to put the base branches back.

import {
  Avatar,
  Button,
  Callout,
  Dialog,
  DialogSpacer,
  Key,
  Spinner,
  Steps,
  type StepItem,
  type StepState,
} from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type {
  Change,
  ChangeRow,
  ChangeStatus,
  ConversionNote,
  ConversionView,
  Plan,
} from '../contract.ts';
import { confirm, dismiss, putBack, tryAgain, TITLE } from './actions.ts';
import { stacksStore, type Dialog as Open } from './store.ts';

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

/** A branch's name, in code type: GitHub's text, which may be long, so it breaks anywhere. */
function Branch({ name }: { name: string }) {
  return <span className="break-all code-small">{withoutBidi(name)}</span>;
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

/** What a change is, as a step names it. */
function changeTitle(change: Change): ReactNode {
  switch (change.kind) {
    case 'retarget':
      return (
        <>
          #{change.pr}’s base: <Branch name={change.from} /> → <Branch name={change.to} />
        </>
      );
    case 'create':
      return (
        <>
          <strong className="font-semibold">Create the stack</strong>,{' '}
          {change.prs.map((pr) => `#${pr}`).join(' → ')}
        </>
      );
    case 'add':
      return (
        <>
          <strong className="font-semibold">Add {numbers(change.prs)}</strong> to GitHub stack #
          {change.stack}
        </>
      );
    case 'unstack':
      return <strong className="font-semibold">Unstack GitHub stack #{change.stack}</strong>;
    default:
      throw new Error(`a change Lo doesn't know: ${JSON.stringify(change satisfies never)}`);
  }
}

/** What's said under a change: what GitHub said of it, or what came of it. */
function changeDetail(row: ChangeRow): ReactNode {
  switch (row.status) {
    case 'unchanged':
      return 'It was so already, so nothing was sent.';
    case 'failed':
      return row.detail ?? undefined;
    case 'unknown':
      return `${row.detail ?? ''} It may have gone through.`.trim();
    case 'left':
      return (
        <>
          Its base is now <Branch name={row.detail ?? ''} />. Lo left it.
        </>
      );
    case 'skipped':
      return 'Not sent.';
    case 'todo':
    case 'now':
    case 'done':
      return undefined;
    default:
      throw new Error(`a state Lo doesn't know: ${JSON.stringify(row.status satisfies never)}`);
  }
}

function stepsOf(rows: readonly ChangeRow[], which: string): StepItem[] {
  return rows.map((row, index) => ({
    key: `${which}${index}`,
    state: STEP[row.status],
    title: changeTitle(row.change),
    detail: changeDetail(row),
  }));
}

/** What the dialog shows now. */
interface Shown {
  readonly title: string;
  readonly description?: ReactNode;
  readonly body: ReactNode;
  readonly foot: ReactNode;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** A button that closes the dialog, or stops what's being sent, with `Esc`. */
function escButton(label: string, disabled = false) {
  return (
    <Button onClick={dismiss} disabled={disabled}>
      {label}
      <Key keys={labels('esc')} decorative />
    </Button>
  );
}

/** The dialog's main button, with `⏎`. */
function enterButton(
  label: string,
  run: () => void,
  primary: RefObject<HTMLButtonElement | null>,
  busy = false,
) {
  return (
    <Button ref={primary} variant="primary" onClick={run} aria-disabled={busy || undefined}>
      {label}
      <Key keys={labels('enter')} decorative className="text-on-accent" />
    </Button>
  );
}

/** Each pull request the plan changes, with its base branch and the one it gets. */
function Bases({ plan }: { plan: Plan }) {
  return (
    <table className="w-full border-collapse text-small">
      <tbody>
        {plan.rows.map((row) => (
          <tr key={row.number} className={row.to === null ? '' : 'bg-accent-soft'}>
            <td
              className={`border-t border-border-subtle py-6 ps-8 pe-8 align-top whitespace-nowrap tabular-nums ${row.to === null ? 'text-fg-muted' : 'text-fg'}`}
            >
              #{row.number}
            </td>
            <td className="w-full border-t border-border-subtle py-6 pe-8 align-top text-fg">
              {withoutBidi(row.title)}
            </td>
            <td className="border-t border-border-subtle py-6 pe-8 align-top">
              <Branch name={row.base} />
              {row.to !== null && (
                <>
                  {' → '}
                  <Branch name={row.to} />
                </>
              )}
            </td>
            <td className="border-t border-border-subtle py-6 pe-8 align-top whitespace-nowrap text-fg-muted">
              {row.to === null ? 'no change' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What Lo left, each with GitHub's page for it. */
function Notes({ notes }: { notes: readonly ConversionNote[] }) {
  return notes.map((note) => (
    <Callout key={note.text} tone="warning">
      <span>{note.text}</span>
      {note.link !== null && (
        <span className="mt-6 block">
          <Button
            size="sm"
            onClick={() => {
              const url = note.link;
              if (url !== null) {
                client(tabs)
                  .openExternal({ url })
                  .catch((error: unknown) => console.error('stacks:', error));
              }
            }}
          >
            Open on GitHub
          </Button>
        </span>
      )}
    </Callout>
  ));
}

/** "Waiting for GitHub until 14:05", while GitHub has asked Lo to hold off. */
function waiting(until: number): string {
  const time = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Waiting for GitHub until ${time}. Lo sends the next change then.`;
}

function confirmShown(
  open: Extract<Open, { kind: 'confirm' }>,
  primary: RefObject<HTMLButtonElement | null>,
): Shown {
  const { plan } = open;
  return {
    title: plan.title,
    description: plan.description,
    step: `confirm ${plan.key}`,
    body: (
      <>
        <section aria-label="Base branches" className="flex flex-col gap-6">
          <h3 className="m-0 text-small-medium text-fg-muted">{plan.heading}</h3>
          <Bases plan={plan} />
        </section>
        <section aria-label="The stack" className="flex flex-col gap-6">
          <h3 className="m-0 text-small-medium text-fg-muted">2 · Then the stack, bottom to top</h3>
          <p className="m-0 text-small">{plan.stack}</p>
        </section>
        {plan.warning !== null && <Callout tone="warning">{plan.warning}</Callout>}
        {open.problem !== undefined && (
          <Callout tone="danger" role="alert">
            {open.problem}
          </Callout>
        )}
      </>
    ),
    foot: (
      <>
        <span className="flex items-center gap-6">
          <Avatar login={plan.login} size="sm" />
          <span>
            as <span className="text-fg">{plan.login}</span>
          </span>
        </span>
        <DialogSpacer />
        {escButton('Cancel', open.sending)}
        {enterButton(plan.confirm, confirm, primary, open.sending)}
      </>
    ),
  };
}

function conversionShown(
  view: ConversionView | undefined,
  primary: RefObject<HTMLButtonElement | null>,
): Shown {
  if (!view) {
    return {
      title: TITLE,
      step: 'sending',
      body: (
        <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
          <Spinner />
          Sending the first change…
        </div>
      ),
      foot: (
        <>
          <DialogSpacer />
          {escButton('Cancel')}
        </>
      ),
    };
  }
  const { phase } = view;
  const steps = (
    <>
      <Steps steps={stepsOf(view.changes, 'c')} label="Changes" />
      {view.putBack.length > 0 && (
        <section aria-label="Putting back" className="flex flex-col gap-8">
          <h3 className="m-0 text-small-medium text-fg-muted">
            Putting back, the last change first
          </h3>
          <Steps steps={stepsOf(view.putBack, 'p')} label="Putting back" />
        </section>
      )}
      <Notes notes={view.notes} />
    </>
  );
  const description =
    view.waitingUntil === null ? view.description || undefined : waiting(view.waitingUntil);
  switch (phase) {
    case 'running':
    case 'puttingBack':
    case 'done':
      return {
        title: view.title,
        description,
        step: phase,
        body: steps,
        foot: (
          <>
            <DialogSpacer />
            {escButton(view.stopping ? 'Stopping after this change…' : 'Cancel', view.stopping)}
          </>
        ),
      };
    case 'failed':
    case 'stopped':
    case 'putBack': {
      const label = view.putBackLabel;
      return {
        title: view.title,
        description,
        step: `${phase} ${label ?? ''}`,
        body: steps,
        foot: (
          <>
            <DialogSpacer />
            {label === null ? (
              <>
                {escButton('Close')}
                {phase === 'putBack'
                  ? enterButton('Done', dismiss, primary)
                  : enterButton('Try again', tryAgain, primary)}
              </>
            ) : (
              <>
                {phase === 'putBack' ? null : <Button onClick={tryAgain}>Try again</Button>}
                {escButton('Close')}
                {enterButton(label, putBack, primary)}
              </>
            )}
          </>
        ),
      };
    }
    default:
      throw new Error(`a phase Lo doesn't know: ${JSON.stringify(phase satisfies never)}`);
  }
}

function shownOf(
  open: Open,
  views: ReadonlyMap<string, ConversionView>,
  primary: RefObject<HTMLButtonElement | null>,
): Shown {
  switch (open.kind) {
    case 'planning':
      return {
        title: TITLE,
        step: 'planning',
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Asking GitHub about #{open.number}’s stack…
          </div>
        ),
        foot: (
          <>
            <DialogSpacer />
            {escButton('Cancel')}
          </>
        ),
      };
    case 'confirm':
      return confirmShown(open, primary);
    case 'conversion':
      return conversionShown(views.get(open.key), primary);
    default:
      throw new Error(`a dialog Lo doesn't know: ${JSON.stringify(open satisfies never)}`);
  }
}

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"]';

/** The dialog, open while the store says. */
export function ConversionDialog() {
  const open = useStore(stacksStore, (state) => state.dialog);
  const views = useStore(stacksStore, (state) => state.conversions);
  const primary = useRef<HTMLButtonElement>(null);
  const shown = open && shownOf(open, views, primary);
  const step = shown?.step;
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
    if (event.key !== 'Enter' || event.defaultPrevented) return;
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
      title={shown?.title ?? TITLE}
      description={shown?.description}
      foot={shown?.foot}
      initialFocus={primary}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="make-stack"
    >
      <span role="status" className="sr-only">
        {shown?.title}
      </span>
      {shown?.body}
    </Dialog>
  );
}
