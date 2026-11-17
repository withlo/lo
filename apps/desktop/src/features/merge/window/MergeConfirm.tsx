// The merge's dialog, in the tab feature's `tab.dialogs` slot, in the merge panel's place: the plan
// to confirm, with the account, the method, the branch and the revision it merges, then the merge
// as it goes, and why it didn't, when it didn't. `⏎` confirms and `Esc` goes back to the panel. A
// held key confirms nothing, and nor does the press that opened it: only a fresh press of `⏎` once
// the plan shows. Auto-merge's says what GitHub waits for before it merges; a merge past the rules
// lists what it skips, and goes only with the pull request's number typed, in a field that empties
// each time Lo asks again.

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
  TypeToConfirm,
  type FactItem,
} from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { usePull, withoutBidi } from '../../tab/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import type { JobView, MergePlan, MergeState, Refusal } from '../contract.ts';
import {
  askAgain,
  confirmMerge,
  jobsByKey,
  leaveDialog,
  newerLabel,
  newerOf,
  seeNewer,
  typeNumber,
} from './merging.ts';
import { merging, panels, statuses, type MergeDialog } from './store.ts';
import {
  confirmLabel,
  confirmTitle,
  methodLabel,
  onceLine,
  outcomeDetail,
  outcomeTitle,
  pendingLine,
  pushWarning,
  queueLine,
  skipsOf,
  troubleLine,
} from './words.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** What the dialog shows now. */
interface Shown {
  readonly title: string;
  /** A line under the title. */
  readonly description?: string;
  readonly body: ReactNode;
  /**
   * Its main button, `⏎`, if it has one now: `danger` for one that skips rules, `off` until what
   * it asks for is typed.
   */
  readonly primary:
    | {
        readonly label: string;
        readonly run: () => void;
        readonly busy?: boolean;
        readonly danger?: boolean;
        readonly off?: boolean;
      }
    | undefined;
  /** Whether focus goes to the field to type in, not the main button. */
  readonly typing?: boolean;
  /** What `Esc` says it does. */
  readonly close: string;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** "r5 of #4821, the one on screen", or the commit's short ID when Lo has no revision for it. */
function revisionOf(plan: MergePlan): string {
  const label = revisionLabel(revisionsOf(plan.id), plan.head) ?? plan.head.slice(0, 7);
  return `${label} of #${plan.number}, the one on screen`;
}

/** The squash commit's title: as typed, else GitHub's own, when Lo read it. */
function commitTitle(plan: MergePlan): string | undefined {
  if (plan.title !== '') return plan.title;
  const squash = panels.get(plan.id).squash;
  return squash.kind === 'read' ? squash.title : undefined;
}

/** Whether `plan` sends the squash commit's title and message typed: a merge's write does. */
function sendsText(plan: MergePlan): boolean {
  return (plan.kind === 'merge' || plan.kind === 'override') && plan.method === 'SQUASH';
}

/** What the plan will do, as facts: who, how, into what, and which revision. */
function factsOf(plan: MergePlan): FactItem[] {
  const items: FactItem[] = [{ label: 'As', value: <FactPerson login={plan.login} /> }];
  // A queue's settings choose its method.
  if (plan.kind !== 'enqueue' && plan.kind !== 'whenReady' && plan.method !== null) {
    items.push({ label: 'Method', value: methodLabel(plan.method) });
  }
  items.push(
    { label: 'Into', value: <Branch name={withoutBidi(plan.base)} base /> },
    { label: 'Revision', value: revisionOf(plan) },
  );
  const title = sendsText(plan) ? commitTitle(plan) : undefined;
  if (title !== undefined) {
    items.push({
      label: 'Commit',
      value: <span className="min-w-0 truncate">{withoutBidi(title)}</span>,
    });
  }
  return items;
}

/** Why it didn't go, in the core's words, each rule GitHub named on a line of its own. */
function RefusalCallout({ refusal, title }: { refusal: Refusal; title?: string | undefined }) {
  return (
    <Callout tone="danger" role="alert">
      {title !== undefined && <strong className="block font-semibold">{title}</strong>}
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

/** "See r5 → r6", for a refusal that names a newer push, else nothing. */
function newerPrimary(plan: MergePlan, refusal: Refusal): Shown['primary'] {
  const newer = newerOf(plan.id, refusal, plan.head);
  if (newer === undefined) return undefined;
  return { label: newerLabel(plan.id, newer), run: () => seeNewer(plan.id, newer) };
}

/**
 * Asks GitHub again how the last merge of `plan`'s pull request ended, which Lo couldn't tell, and
 * goes back to the panel: once that read is answered, it may merge again.
 */
function askAgainBack(plan: MergePlan): void {
  askAgain(plan.key);
  leaveDialog();
}

/** What Lo last read of `plan`'s pull request, if it's of the revision the plan merges. */
function stateOf(plan: MergePlan): MergeState | undefined {
  const status = statuses.getState().views.get(plan.id);
  return status?.kind === 'known' && status.state.head === plan.head ? status.state : undefined;
}

/** What turning auto-merge on waits for, and what a push before then would do. */
function AutoLines({ plan }: { plan: MergePlan }) {
  const state = stateOf(plan);
  const warning = state && pushWarning(state);
  const panel = panels.get(plan.id);
  return (
    <>
      <p className="m-0 text-fg text-small">{withoutBidi(onceLine(plan, state))}</p>
      {plan.kind === 'whenReady' && (
        <p className="m-0 text-fg-muted text-small">{queueLine(plan.method)}</p>
      )}
      {plan.kind === 'autoMerge' && (panel.title !== '' || panel.message !== '') && (
        <p className="m-0 text-fg-muted text-small">
          Auto-merge uses GitHub’s own commit message, not the one typed.
        </p>
      )}
      {warning !== undefined && (
        <Callout tone="warning" role="status">
          {withoutBidi(warning)}
        </Callout>
      )}
    </>
  );
}

/** What a merge past the rules skips, a line each. */
function Skips({ plan }: { plan: MergePlan }) {
  const state = stateOf(plan);
  const skips = state ? skipsOf(state) : [];
  return (
    <Callout tone="danger">
      <strong className="block font-semibold">This skips:</strong>
      {skips.length > 0 ? (
        <ul className="m-0 mt-6 ps-16">
          {skips.map((skip) => (
            <li key={skip}>{withoutBidi(skip)}</li>
          ))}
        </ul>
      ) : (
        <span>{withoutBidi(`What ${plan.base}’s rules block it for.`)}</span>
      )}
    </Callout>
  );
}

function confirmShown(
  dialog: Extract<MergeDialog, { kind: 'confirm' }>,
  field: RefObject<HTMLInputElement | null>,
): Shown {
  const { plan } = dialog;
  const override = plan.kind === 'override';
  const auto = plan.kind === 'autoMerge' || plan.kind === 'whenReady';
  const typed = dialog.typed ?? '';
  const number = String(plan.number);
  return {
    title: confirmTitle(plan),
    ...(override && {
      description: withoutBidi(
        `You can bypass ${plan.base}’s rules in ${plan.owner}/${plan.repo}.`,
      ),
    }),
    step: `confirm ${plan.key}`,
    close: 'Cancel',
    primary: {
      label: confirmLabel(plan),
      run: confirmMerge,
      busy: dialog.sending,
      ...(override && { danger: true, off: typed !== number }),
    },
    typing: override,
    body: (
      <>
        {override && <Skips plan={plan} />}
        <Facts items={factsOf(plan)} />
        {plan.kind === 'enqueue' && (
          <p className="m-0 text-fg-muted text-small">{queueLine(plan.method)}</p>
        )}
        {auto && <AutoLines plan={plan} />}
        {override && (
          <TypeToConfirm
            word={number}
            value={typed}
            onChange={typeNumber}
            onConfirm={confirmMerge}
            inputRef={field}
          />
        )}
        {dialog.note !== undefined && (
          <Callout tone="warning" role="status">
            {withoutBidi(dialog.note)}
          </Callout>
        )}
        {dialog.sending && (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Checking #{plan.number} with GitHub before it’s sent. Cancel stops it.
          </div>
        )}
        <Callout tone="info">Lo deletes no branches; the repo’s own setting applies.</Callout>
      </>
    ),
  };
}

function sentShown(plan: MergePlan, job: JobView | undefined): Shown {
  const title = confirmTitle(plan);
  const state = job?.state;
  switch (state?.kind) {
    case undefined:
    case 'sending':
      return {
        title,
        step: 'sending',
        close: 'Close',
        primary: undefined,
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Sending
          </div>
        ),
      };
    case 'pending':
      return {
        title,
        step: 'pending',
        close: 'Close',
        primary: undefined,
        body: (
          <>
            <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
              <Spinner />
              {pendingLine(plan)}
            </div>
            {state.trouble !== null && (
              <p className="m-0 text-fg-muted text-small">
                {withoutBidi(troubleLine(state.trouble))}
              </p>
            )}
          </>
        ),
      };
    case 'refused':
      return {
        title,
        step: `refused ${plan.key}`,
        close: 'Close',
        primary: newerPrimary(plan, state.refusal),
        body: <RefusalCallout refusal={state.refusal} title={job && outcomeTitle(job)} />,
      };
    case 'unknown':
      return {
        title,
        step: `unknown ${plan.key} ${state.shows ?? ''}`,
        close: 'Close',
        primary: { label: 'Ask GitHub again', run: () => askAgain(plan.key) },
        body: (
          <Callout tone="warning" role="alert">
            <strong className="block font-semibold">{job && outcomeTitle(job)}</strong>
            <span>{job && withoutBidi(outcomeDetail(job))}</span>
          </Callout>
        ),
      };
    case 'merged':
    case 'enqueued':
    case 'autoMergeOn':
    case 'autoMergeOff':
      return { title, step: 'done', close: 'Close', primary: undefined, body: undefined };
    default:
      state satisfies never;
      return { title, step: 'done', close: 'Close', primary: undefined, body: undefined };
  }
}

function shownOf(
  dialog: MergeDialog,
  jobs: (key: string) => JobView | undefined,
  field: RefObject<HTMLInputElement | null>,
): Shown {
  switch (dialog.kind) {
    case 'planning':
      return {
        title: dialog.title ?? `Merge #${dialog.number}`,
        step: 'planning',
        close: 'Cancel',
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        primary: { label: dialog.label, run: () => undefined, busy: true },
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Checking #{dialog.number} with GitHub
          </div>
        ),
      };
    case 'confirm':
      return confirmShown(dialog, field);
    case 'sent':
      return sentShown(dialog.plan, jobs(dialog.plan.key));
    case 'refused':
      return {
        title: confirmTitle(dialog.plan),
        step: `refused ${dialog.plan.key}`,
        close: 'Back',
        primary:
          dialog.refusal.kind === 'unsettled'
            ? { label: 'Ask GitHub again', run: () => askAgainBack(dialog.plan) }
            : newerPrimary(dialog.plan, dialog.refusal),
        body: <RefusalCallout refusal={dialog.refusal} />,
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
      variant={primary.danger ? 'danger' : 'primary'}
      aria-disabled={primary.busy || primary.off || undefined}
      onClick={(event) => {
        // Not a double click's second, which would press what came up in its place unseen.
        if (event.detail <= 1 && !primary.busy && !primary.off) primary.run();
      }}
    >
      {primary.label}
      <Key
        keys={labels('enter')}
        decorative
        className={primary.danger ? undefined : 'text-on-accent'}
      />
    </Button>
  );
}

/** What takes `⏎` for itself: a button, a link or a field. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"]';

/** When a key that has just gone down would have gone down, on the clock events are stamped by. */
function stampNow(): number {
  return new Event('lo-now').timeStamp;
}

/** The dialog, open while the store says. */
export function MergeConfirm() {
  const dialog = useStore(merging, (state) => state.dialog);
  // Read for their changes: the dialog follows the merge it sent, and a newer push read since.
  useStore(merging, (state) => state.jobs);
  useStore(statuses);
  usePull(dialog && dialog.kind !== 'planning' ? dialog.plan.id : '');
  const button = useRef<HTMLButtonElement>(null);
  // Where a merge past the rules asks for its number.
  const field = useRef<HTMLInputElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const shown = dialog && shownOf(dialog, jobsByKey, field);
  const step = shown?.step;
  const typing = shown?.typing === true;
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
      frame = requestAnimationFrame(() => (typing ? field.current : button.current)?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [step, typing]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A field inside it, such as a number to type, may have handled the press already.
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Another control with focus, such as Cancel, takes its own press.
    const target = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
    if (target !== null && target !== button.current) return;
    event.preventDefault();
    // Only a fresh press, once what it would press is on screen.
    if (event.repeat || event.timeStamp < shownAt.current) return;
    if (shown?.primary && !shown.primary.busy && !shown.primary.off) shown.primary.run();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveDialog();
      }}
      title={withoutBidi(shown?.title ?? 'Merge')}
      description={shown?.description}
      foot={
        shown && (
          <>
            <DialogSpacer />
            <Button onClick={leaveDialog}>
              {shown.close}
              <Key keys={labels('esc')} decorative />
            </Button>
            {shown.primary && <PrimaryButton primary={shown.primary} button={button} />}
          </>
        )
      }
      initialFocus={typing ? field : button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="merge-confirm"
    >
      {shown?.body}
    </Dialog>
  );
}
