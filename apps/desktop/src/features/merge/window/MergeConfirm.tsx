// The merge's dialog, in the tab feature's `tab.dialogs` slot, in the merge panel's place: the plan
// to confirm, with the account, the method, the branch and the revision it merges, then the merge
// as it goes, and why it didn't, when it didn't. `⏎` confirms and `Esc` goes back to the panel. A
// held key confirms nothing, and nor does the press that opened it: only a fresh press of `⏎` once
// the plan shows.

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
import { usePull, withoutBidi } from '../../tab/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import type { JobView, MergePlan, Refusal } from '../contract.ts';
import {
  askAgain,
  confirmMerge,
  jobsByKey,
  leaveDialog,
  newerLabel,
  newerOf,
  seeNewer,
} from './merging.ts';
import { merging, panels, statuses, type MergeDialog } from './store.ts';
import {
  confirmLabel,
  confirmTitle,
  methodLabel,
  outcomeDetail,
  outcomeTitle,
  pendingLine,
  queueLine,
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
  readonly body: ReactNode;
  /** Its main button, `⏎`, if it has one now. */
  readonly primary:
    { readonly label: string; readonly run: () => void; readonly busy?: boolean } | undefined;
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

/** What the plan will do, as facts: who, how, into what, and which revision. */
function factsOf(plan: MergePlan): FactItem[] {
  const items: FactItem[] = [{ label: 'As', value: <FactPerson login={plan.login} /> }];
  if (plan.kind === 'merge' && plan.method !== null) {
    items.push({ label: 'Method', value: methodLabel(plan.method) });
  }
  items.push(
    { label: 'Into', value: <Branch name={withoutBidi(plan.base)} base /> },
    { label: 'Revision', value: revisionOf(plan) },
  );
  const title = plan.kind === 'merge' && plan.method === 'SQUASH' ? commitTitle(plan) : undefined;
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

function confirmShown(dialog: Extract<MergeDialog, { kind: 'confirm' }>): Shown {
  const { plan } = dialog;
  return {
    title: confirmTitle(plan),
    step: `confirm ${plan.key}`,
    close: 'Cancel',
    primary: { label: confirmLabel(plan), run: confirmMerge, busy: dialog.sending },
    body: (
      <>
        <Facts items={factsOf(plan)} />
        {plan.kind === 'enqueue' && (
          <p className="m-0 text-fg-muted text-small">{queueLine(plan.method)}</p>
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
      return { title, step: 'done', close: 'Close', primary: undefined, body: undefined };
    default:
      state satisfies never;
      return { title, step: 'done', close: 'Close', primary: undefined, body: undefined };
  }
}

function shownOf(dialog: MergeDialog, jobs: (key: string) => JobView | undefined): Shown {
  switch (dialog.kind) {
    case 'planning':
      return {
        title: `Merge #${dialog.number}`,
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
      return confirmShown(dialog);
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

/** The dialog, open while the store says. */
export function MergeConfirm() {
  const dialog = useStore(merging, (state) => state.dialog);
  // Read for their changes: the dialog follows the merge it sent, and a newer push read since.
  useStore(merging, (state) => state.jobs);
  useStore(statuses);
  usePull(dialog && dialog.kind !== 'planning' ? dialog.plan.id : '');
  const button = useRef<HTMLButtonElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const shown = dialog && shownOf(dialog, jobsByKey);
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
    // A field inside it, such as a number to type, may have handled the press already.
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Another control with focus, such as Cancel, takes its own press.
    const target = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
    if (target !== null && target !== button.current) return;
    event.preventDefault();
    // Only a fresh press, once what it would press is on screen.
    if (event.repeat || event.timeStamp < shownAt.current) return;
    if (shown?.primary && !shown.primary.busy) shown.primary.run();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveDialog();
      }}
      title={withoutBidi(shown?.title ?? 'Merge')}
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
      initialFocus={button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="merge-confirm"
    >
      {shown?.body}
    </Dialog>
  );
}
