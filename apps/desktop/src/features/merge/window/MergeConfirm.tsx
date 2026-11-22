// The merge's dialog, in the tab feature's `tab.dialogs` slot, in the merge panel's place: the plan
// to confirm, with the account, the method, the branch and the revision it merges, under one title
// and in one body from the moment it opens until it's done. Only the foot and the line above it
// change: the main button is busy while Lo checks and while the merge runs, "Cancel" turns to
// "Close" the moment it's sent, a failure is a problem above the foot, with "Try again" or what its
// reason asks, a merge whose end isn't known offers "Check again", which only looks, and once it's
// done the line above the foot says so beside the mark's kiss, with "Done" the one button.
//
// A GitHub stack's merge lists every layer that merges, with where each stands, then how far GitHub
// got with each; a chain's, each base branch Lo moves, in order, then how each went. `⏎` confirms
// and `Esc` goes back to the panel. A held key confirms nothing, and nor does the press that opened
// it: only a fresh press of `⏎` once the plan shows. Auto-merge's says what GitHub waits for before
// it merges; a merge past the rules lists what it bypasses, and goes only with the pull request's
// number typed, in a field that empties each time Lo asks again.

import {
  Branch,
  Button,
  Callout,
  Dialog,
  DialogSpacer,
  FactPerson,
  Facts,
  Key,
  LayerList,
  LogoMotion,
  Problem,
  Steps,
  TypeToConfirm,
  type FactItem,
  type LayerRow,
  type StepItem,
  type StepState,
} from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { pullOf, usePull, withoutBidi } from '../../tab/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import type { JobView, MergePlan, MoveStatus, Progress, Refusal, Together } from '../contract.ts';
import {
  askAgain,
  askAgainBack,
  checking,
  confirmMerge,
  jobsByKey,
  leaveDialog,
  newerLabel,
  newerOf,
  openPull,
  planAgain,
  seeNewer,
  typeNumber,
} from './merging.ts';
import { merging, panels, statuses, type MergeDialog, type Sketch } from './store.ts';
import {
  chainSteps,
  confirmLabel,
  confirmTitle,
  confirmWorking,
  doneLine,
  layerLine,
  layersOf,
  methodLabel,
  numbers,
  onceLine,
  outcomeDetail,
  outcomeTitle,
  pushWarning,
  queueLine,
  saidOf,
  skipsOf,
  troubleLine,
} from './words.ts';

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
  /** What it says while busy, the verb of its label: "Merging…". */
  readonly working?: string | undefined;
  /** Why it can't be pressed yet, as while a merge past the rules waits for its number. */
  readonly off?: boolean;
}

/** What went wrong, above the foot. */
interface Trouble {
  readonly title: string;
  readonly reason?: string | undefined;
  readonly details?: string | undefined;
}

/** What the dialog shows now. */
interface Shown {
  readonly title: string;
  /** What the plan will do, the same from the question until it's done. */
  readonly body: ReactNode;
  /** A line under it, above the foot: what changed since the last plan, or why it waits. */
  readonly line?: ReactNode;
  /** What went wrong, above the foot. */
  readonly problem?: Trouble | undefined;
  /** What it did, once it's done, above the foot. */
  readonly done?: string | undefined;
  /** Its main button, `⏎`, always there: busy while it works, "Done" once it has. */
  readonly primary: Primary;
  /** Another button, before the main one, for what comes next: "Open #265". */
  readonly next?: { readonly label: string; readonly run: () => void } | undefined;
  /** The button that leaves, `Esc`: "Cancel" before anything is sent, then "Close". */
  readonly close: 'Cancel' | 'Close' | undefined;
  /** Whether focus goes to the field to type in, not the main button. */
  readonly typing?: boolean;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** What `plan` names, as the dialog states it. */
function sketchOf(plan: MergePlan): Sketch {
  const { id, number, login, kind, method, base, head, title } = plan;
  const stack = plan.together?.kind === 'stack';
  return { id, number, login, kind, method, base, head, title, stack };
}

/** "r5", or the commit's short ID, as code, when Lo has no revision for it. */
function revisionOf(plan: Pick<Sketch, 'id' | 'head'>): ReactNode {
  const label = revisionLabel(revisionsOf(plan.id), plan.head);
  return label ?? <code className="code-small">{plan.head.slice(0, 7)}</code>;
}

/** The squash commit's title: as typed, else GitHub's own, when Lo read it. */
function commitTitle(plan: Pick<Sketch, 'id' | 'title'>): string | undefined {
  if (plan.title !== '') return plan.title;
  const squash = panels.get(plan.id).squash;
  return squash.kind === 'read' ? squash.title : undefined;
}

/** Whether `plan` sends the squash commit's title and message typed: a merge's write does. */
function sendsText(plan: Pick<Sketch, 'kind' | 'method'>): boolean {
  return (plan.kind === 'merge' || plan.kind === 'override') && plan.method === 'SQUASH';
}

/**
 * What the merge will do, as facts: who, how, into what, and which revision. The panel knows them
 * before main has planned anything, so they're the same rows from the check to done.
 */
function factsOf(plan: Sketch): FactItem[] {
  const items: FactItem[] = [{ label: 'As', value: <FactPerson login={plan.login} /> }];
  const { stack } = plan;
  // A queue's settings choose its method.
  if (plan.kind !== 'enqueue' && plan.kind !== 'whenReady' && plan.method !== null) {
    const method = methodLabel(plan.method);
    items.push({
      label: 'Method',
      value: stack && plan.method === 'SQUASH' ? `${method} · 1 commit per layer` : method,
    });
  }
  items.push(
    { label: 'Into', value: <Branch name={withoutBidi(plan.base)} base /> },
    { label: 'Revision', value: revisionOf(plan) },
  );
  // A stack's layers keep their own commits' words.
  const title = sendsText(plan) && !stack ? commitTitle(plan) : undefined;
  if (title !== undefined) {
    items.push({
      label: 'Commit',
      value: <span className="min-w-0 truncate">{withoutBidi(title)}</span>,
    });
  }
  return items;
}

/** The pull request's own title, as its tab has it: empty before it's read. */
function titleOf(plan: MergePlan): string {
  return pullOf(plan.id)?.header?.title ?? '';
}

/** A stack's layers that merge, as its confirmation lists them: those below, then this one. */
function stackLayers(plan: MergePlan, together: Extract<Together, { kind: 'stack' }>): LayerRow[] {
  return [
    ...together.below.map((layer) => ({
      number: layer.number,
      title: layer.title,
      state: 'todo' as const,
      detail: layerLine(layer),
    })),
    { number: plan.number, title: titleOf(plan), state: 'now' },
  ];
}

/**
 * What a stack's merge says of the layers above it: "#4824 stays open and moves onto main.", and
 * once it merged, "#4824 moved onto main."
 */
function aboveLine(above: readonly number[], base: string, moved: boolean): string | undefined {
  if (above.length === 0) return undefined;
  if (moved) return `${numbers(above)} moved onto ${base}.`;
  return above.length === 1
    ? `${numbers(above)} stays open and moves onto ${base}.`
    : `${numbers(above)} stay open and move onto ${base}.`;
}

/** How a move stands, as a step's ball shows it. */
function stepOf(status: MoveStatus): StepState {
  switch (status) {
    case 'todo':
      return 'todo';
    case 'now':
      return 'now';
    case 'done':
    case 'unchanged':
      return 'done';
    case 'failed':
    case 'unknown':
      return 'stopped';
    case 'skipped':
      return 'skipped';
    default:
      status satisfies never;
      return 'todo';
  }
}

/** A chain's merge as it goes: its moves and the merge, each as it stands. */
function chainProgress(
  plan: MergePlan,
  job: JobView,
  progress: Extract<Progress, { kind: 'chain' }>,
): StepItem[] {
  const words = plan.together?.kind === 'chain' ? chainSteps(plan, plan.together) : [];
  const detailOf = (key: string) => words.find((step) => step.key === key)?.detail;
  const merge: StepItem = {
    key: 'merge',
    title: withoutBidi(`Merge #${plan.number} into ${plan.base}.`),
    ...mergeStep(job, progress),
  };
  const moves = progress.moves.map((move) => {
    const key = move.before ? 'before' : `after-${move.move.pr}`;
    const detail = move.detail ?? detailOf(key);
    return {
      key,
      state: stepOf(move.status),
      title: withoutBidi(`Move #${move.move.pr} onto ${move.move.to}.`),
      detail: detail === undefined ? undefined : withoutBidi(detail),
    };
  });
  return [
    ...moves.filter((move) => move.key === 'before'),
    merge,
    ...moves.filter((move) => move.key !== 'before'),
  ];
}

/** How the merge of a chain's bottom layer stands, as its step says it. */
function mergeStep(
  job: JobView,
  progress: Extract<Progress, { kind: 'chain' }>,
): Pick<StepItem, 'state' | 'detail'> {
  switch (job.state.kind) {
    case 'sending':
      return { state: progress.phase === 'before' ? 'todo' : 'now' };
    case 'pending':
      return { state: 'now', detail: 'Merging…' };
    case 'merged':
      return { state: 'done', detail: 'Merged' };
    case 'enqueued':
      return progress.phase === 'waiting'
        ? { state: 'now', detail: 'In the merge queue' }
        : { state: 'done', detail: 'Merged' };
    case 'refused':
      return { state: 'stopped', detail: 'Not merged' };
    case 'unknown':
      return progress.phase === 'waiting'
        ? { state: 'now', detail: 'Checking…' }
        : { state: 'stopped', detail: 'Not confirmed' };
    // Auto-merge's writes: a chain's merge is never one.
    case 'autoMergeOn':
    case 'autoMergeOff':
      return { state: 'todo' };
    default:
      job.state satisfies never;
      return { state: 'todo' };
  }
}

/** A stack's layers as its merge goes, as GitHub's Stacks API last said. */
function stackProgress(job: JobView, progress: Extract<Progress, { kind: 'stack' }>): LayerRow[] {
  const going = job.state.kind === 'sending' || job.state.kind === 'pending';
  const first = progress.layers.find((layer) => layer.state !== 'merged');
  return progress.layers.map((layer) => {
    const { title } = layer;
    switch (layer.state) {
      case 'merged':
        return { number: layer.number, title, state: 'done', detail: 'Merged' };
      case 'closed':
        return { number: layer.number, title, state: 'stopped', detail: 'Closed' };
      case 'open':
      case null:
        if (going) {
          return layer === first
            ? { number: layer.number, title, state: 'now', detail: 'Merging…', working: true }
            : { number: layer.number, title, state: 'todo', detail: 'Waiting' };
        }
        if (job.state.kind === 'merged' || job.state.kind === 'enqueued') {
          return { number: layer.number, title, state: 'done', detail: 'Merged' };
        }
        return { number: layer.number, title, state: layer === first ? 'stopped' : 'skipped' };
      default:
        layer.state satisfies never;
        return { number: layer.number, title, state: 'todo' };
    }
  });
}

/** What a merge takes with it, a stack's layers or a chain's moves, as it stands: the plan's, then the merge's. */
function togetherShown(plan: MergePlan, job: JobView | undefined): ReactNode {
  const { together } = plan;
  const progress = job?.together;
  switch (together?.kind) {
    case undefined:
      return undefined;
    case 'stack': {
      const stack = progress?.kind === 'stack' ? progress : undefined;
      const moved = job?.state.kind === 'merged';
      const above = aboveLine(stack?.above ?? together.above, plan.base, moved);
      return (
        <>
          <LayerList
            label="Layers"
            layers={job && stack ? stackProgress(job, stack) : stackLayers(plan, together)}
          />
          {above !== undefined && (
            <p className="m-0 text-fg-muted text-small">{withoutBidi(above)}</p>
          )}
        </>
      );
    }
    case 'chain': {
      const chain = progress?.kind === 'chain' ? progress : undefined;
      const steps =
        job && chain
          ? chainProgress(plan, job, chain)
          : chainSteps(plan, together).map((step) => ({
              key: step.key,
              state: 'todo' as const,
              title: withoutBidi(step.title),
              detail: step.detail === undefined ? undefined : withoutBidi(step.detail),
            }));
      return (
        <>
          <Steps label="Steps" steps={steps} />
          <p className="m-0 text-fg-muted text-small">
            The layers above move once it has merged, while Lo is open.
          </p>
        </>
      );
    }
    default:
      together satisfies never;
      return undefined;
  }
}

/**
 * What turning auto-merge on waits for, and what a commit pushed before then would do, as main
 * planned it: what the press checks again.
 */
function AutoLines({ plan }: { plan: MergePlan }) {
  const said = saidOf(plan);
  const warning = said && pushWarning(said);
  return (
    <>
      <p className="m-0 text-fg text-small">{withoutBidi(onceLine(plan))}</p>
      {plan.kind === 'whenReady' && (
        <p className="m-0 text-fg-muted text-small">{queueLine(plan.method)}</p>
      )}
      {plan.kind === 'autoMerge' && (plan.title !== '' || plan.message !== '') && (
        <p className="m-0 text-fg-muted text-small">Auto-merge uses GitHub’s commit message.</p>
      )}
      {warning !== undefined && (
        <Callout tone="warning" role="status">
          {withoutBidi(warning)}
        </Callout>
      )}
    </>
  );
}

/** What a merge past the rules bypasses, a line each, as main planned it: what the press checks again. */
function Skips({ plan }: { plan: MergePlan }) {
  const said = saidOf(plan);
  const skips = said ? skipsOf(said) : [`The rules for ${plan.base}`];
  return (
    <Callout tone="danger">
      <strong className="block font-semibold">Bypassed rules</strong>
      <ul className="m-0 mt-6 ps-16">
        {skips.map((skip) => (
          <li key={skip}>{withoutBidi(skip)}</li>
        ))}
      </ul>
    </Callout>
  );
}

/** The number a merge past the rules is confirmed with, typed in its field. */
interface Field {
  readonly typed: string;
  readonly onChange: (value: string) => void;
  readonly onConfirm: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * What the plan will do. It's the dialog's body from the question until the merge is done, so
 * nothing in it moves as its button is pressed, and what was confirmed stays in view while it's
 * done; a stack's layers and a chain's steps show how they stand as the merge `job` goes. A merge
 * past the rules has its number typed in `field`; once sent, the field keeps the number, and typing
 * in it changes nothing.
 */
function planBody(plan: MergePlan, job: JobView | undefined, field?: Field): ReactNode {
  const override = plan.kind === 'override';
  const auto = plan.kind === 'autoMerge' || plan.kind === 'whenReady';
  return (
    <>
      {override && <Skips plan={plan} />}
      <Facts items={factsOf(sketchOf(plan))} />
      {plan.kind === 'enqueue' && (
        <p className="m-0 text-fg-muted text-small">{queueLine(plan.method)}</p>
      )}
      {togetherShown(plan, job)}
      {auto && <AutoLines plan={plan} />}
      {override && (
        <TypeToConfirm
          word={String(plan.number)}
          value={field?.typed ?? String(plan.number)}
          onChange={field?.onChange ?? (() => undefined)}
          onConfirm={field?.onConfirm}
          inputRef={field?.inputRef}
        />
      )}
    </>
  );
}

/** What changed since the plan before this one, as the line above the foot. */
function noteLine(note: string | undefined): ReactNode {
  return note === undefined ? undefined : (
    <p role="status" className="m-0 text-fg text-small">
      {withoutBidi(note)}
    </p>
  );
}

/** What the main button says while main works out what the merge is, before it can be named. */
const CHECKING = 'Checking…';

/** The failed title of `plan`'s merge: "Couldn’t merge #264". */
function failedTitle(plan: MergePlan): string {
  const layers = layersOf(plan.together);
  switch (plan.kind) {
    case 'merge':
    case 'override':
      return layers > 1 ? `Couldn’t merge ${layers} layers` : `Couldn’t merge #${plan.number}`;
    case 'enqueue':
      return `Couldn’t add #${plan.number} to the merge queue`;
    case 'autoMerge':
    case 'whenReady':
      return 'Couldn’t turn on auto-merge';
    default:
      plan.kind satisfies never;
      return `Couldn’t merge #${plan.number}`;
  }
}

/**
 * The main button after `refusal` of `plan`: "Show r6" for a newer revision, busy until Lo has read
 * it; else "Try again", which plans the merge afresh.
 */
function againAfter(plan: MergePlan, refusal: Refusal): Primary {
  const newer = newerOf(plan.id, refusal, plan.head);
  if (newer === undefined) return { label: 'Try again', run: planAgain, busy: false };
  return {
    label: newerLabel(plan.id, newer),
    run: () => seeNewer(plan.id, newer),
    busy: newer.to === undefined,
  };
}

/** "Check again" for the merge named `key`, busy while it looks: it only looks. */
function checkAgain(key: string, run: () => void): Primary {
  return { label: 'Check again', run, busy: checking(key), working: CHECKING };
}

/** The main button while what it sent runs: busy, saying what it's doing. */
function atWork(plan: MergePlan): Primary {
  return {
    label: confirmLabel(plan),
    run: () => undefined,
    busy: true,
    working: confirmWorking(plan),
  };
}

function confirmShown(
  dialog: Extract<MergeDialog, { kind: 'confirm' }>,
  field: RefObject<HTMLInputElement | null>,
): Shown {
  const { plan } = dialog;
  const override = plan.kind === 'override';
  const typed = dialog.typed ?? '';
  return {
    title: confirmTitle(plan),
    step: `confirm ${plan.key}`,
    close: 'Cancel',
    primary: {
      label: confirmLabel(plan),
      run: confirmMerge,
      // Pressed, main checks it again before anything is sent.
      busy: dialog.sending,
      working: CHECKING,
      off: override && typed !== String(plan.number),
    },
    typing: override,
    body: planBody(plan, undefined, {
      typed,
      onChange: typeNumber,
      onConfirm: confirmMerge,
      inputRef: field,
    }),
    line: noteLine(dialog.note),
  };
}

/** The merge from `plan`, sent, as `job` says it goes. */
function sentShown(plan: MergePlan, job: JobView | undefined, note: string | undefined): Shown {
  const title = confirmTitle(plan);
  const body = planBody(plan, job);
  const line = noteLine(note);
  const working: Shown = { title, body, line, step: 'sent', close: 'Close', primary: atWork(plan) };
  if (!job) return working;
  const done = doneLine(job);
  if (done !== undefined) {
    const progress = job.together;
    const [next] = progress?.kind === 'stack' && job.state.kind === 'merged' ? progress.above : [];
    return {
      title,
      body,
      line,
      step: `done ${plan.key}`,
      close: undefined,
      done,
      primary: { label: 'Done', run: leaveDialog, busy: false },
      next:
        next === undefined ? undefined : { label: `Open #${next}`, run: () => openPull(job, next) },
    };
  }
  const { state } = job;
  const chain = job.together?.kind === 'chain' ? job.together : undefined;
  const failed = (problem: Trouble, primary: Primary): Shown => ({
    title,
    body,
    step: `failed ${plan.key} ${state.kind} ${chain?.phase ?? ''}`,
    close: primary.label === 'Close' ? undefined : 'Close',
    problem,
    primary,
  });
  const reason = outcomeDetail(job) || undefined;
  // A chain's run that stopped after its merge went: nothing to send again.
  if (chain?.phase === 'stopped' && (state.kind === 'merged' || state.kind === 'enqueued')) {
    return failed(
      { title: outcomeTitle(job) ?? failedTitle(plan), reason },
      { label: 'Close', run: leaveDialog, busy: false },
    );
  }
  switch (state.kind) {
    case 'sending':
    case 'merged':
    case 'enqueued':
    case 'autoMergeOn':
    case 'autoMergeOff':
      return working;
    case 'pending':
      return {
        ...working,
        step: 'pending',
        line: (
          <>
            {line}
            {state.trouble !== null && (
              <p role="status" className="m-0 text-fg-muted text-small">
                {troubleLine()}
              </p>
            )}
          </>
        ),
      };
    case 'refused':
      return failed(
        {
          title: outcomeTitle(job) ?? failedTitle(plan),
          reason,
          details: state.refusal.rules.length > 0 ? state.refusal.rules.join('\n') : undefined,
        },
        againAfter(plan, state.refusal),
      );
    case 'unknown':
      // A chain waits to hear how its merge went.
      if (chain?.phase === 'waiting') return working;
      return failed(
        { title: outcomeTitle(job) ?? 'Merge not confirmed', reason },
        checkAgain(job.key, () => void askAgain(job.key)),
      );
    default:
      state satisfies never;
      return working;
  }
}

function shownOf(
  dialog: MergeDialog,
  jobs: (key: string) => JobView | undefined,
  field: RefObject<HTMLInputElement | null>,
): Shown {
  switch (dialog.kind) {
    case 'planning': {
      const { failed } = dialog;
      // Only the button waits on the check: what the merge names is known already, and asked
      // again, all the plan said.
      const body = dialog.last
        ? planBody(dialog.last, undefined)
        : dialog.sketch && <Facts items={factsOf(dialog.sketch)} />;
      if (failed !== undefined) {
        return {
          title: dialog.title,
          step: 'unplanned',
          close: 'Close',
          primary: { label: 'Try again', run: planAgain, busy: false },
          problem: {
            title: `Couldn’t check #${dialog.number}`,
            reason: failed.why === undefined ? undefined : withoutBidi(failed.why),
            details: failed.details,
          },
          body,
        };
      }
      return {
        title: dialog.title,
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        step: 'planning',
        close: 'Cancel',
        primary: { label: dialog.label, run: () => undefined, busy: true, working: CHECKING },
        body,
      };
    }
    case 'confirm':
      return confirmShown(dialog, field);
    case 'sent':
      return sentShown(dialog.plan, jobs(dialog.plan.key), dialog.note);
    case 'refused': {
      const { plan, refusal } = dialog;
      const unsettled = refusal.kind === 'unsettled';
      const auto = plan.kind === 'autoMerge' || plan.kind === 'whenReady';
      const unconfirmed = auto ? 'Auto-merge not confirmed' : 'Merge not confirmed';
      // Main names the state, which the title says: the reason is what's known of why.
      const said =
        refusal.text === '' || refusal.text.endsWith('not confirmed')
          ? unsettled
            ? troubleLine()
            : undefined
          : withoutBidi(refusal.text);
      const details =
        dialog.details ?? (refusal.rules.length > 0 ? refusal.rules.join('\n') : undefined);
      return {
        title: confirmTitle(plan),
        step: `refused ${plan.key}`,
        close: 'Close',
        primary: unsettled
          ? checkAgain(plan.key, () => askAgainBack(plan.key))
          : againAfter(plan, refusal),
        problem: {
          title: unsettled ? unconfirmed : failedTitle(plan),
          reason: said,
          details,
        },
        body: planBody(plan, undefined),
        line: noteLine(dialog.note),
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

/**
 * The dialog's main button, with `⏎`. It keeps one width and its fill from checking to done: as
 * wide as the widest of what it may say.
 */
function PrimaryButton({
  primary,
  danger,
  widest,
  button,
}: {
  primary: Primary;
  danger: boolean;
  widest: string;
  button: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Button
      ref={button}
      variant={danger ? 'danger' : 'primary'}
      busy={primary.busy}
      working={primary.working}
      widest={widest}
      aria-disabled={primary.off || undefined}
      onClick={(event) => {
        // Not a double click's second, which would press what came up in its place unseen.
        if (event.detail <= 1 && !primary.busy && !primary.off) primary.run();
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

/** The plan a dialog is about, once there's one. */
function planOf(dialog: MergeDialog | undefined): MergePlan | undefined {
  return dialog && dialog.kind !== 'planning' ? dialog.plan : undefined;
}

/** The dialog, open while the store says. */
export function MergeConfirm() {
  const dialog = useStore(merging, (state) => state.dialog);
  // Read for their changes: the dialog follows the merge it sent, what's being checked again, and
  // a newer push read since.
  useStore(merging, (state) => state.jobs);
  useStore(merging, (state) => state.checking);
  useStore(statuses);
  usePull(dialog ? (dialog.kind === 'planning' ? dialog.id : dialog.plan.id) : '');
  const button = useRef<HTMLButtonElement>(null);
  // Where a merge past the rules asks for its number.
  const field = useRef<HTMLInputElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const shown = dialog && shownOf(dialog, jobsByKey, field);
  const step = shown?.step;
  const typing = shown?.typing === true;
  const open = dialog !== undefined;
  const plan = planOf(dialog);
  const kind = plan?.kind ?? (dialog?.kind === 'planning' ? dialog.ask.asked : undefined);
  const danger = kind === 'override';
  const label = plan ? confirmLabel(plan) : dialog?.kind === 'planning' ? dialog.label : '';
  const widest = widestOf([
    label,
    CHECKING,
    plan && confirmWorking(plan),
    'Try again',
    'Check again',
    shown?.primary.label,
  ]);
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
    if (shown && !shown.primary.busy && !shown.primary.off) shown.primary.run();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leaveDialog();
      }}
      title={withoutBidi(shown?.title ?? 'Merge')}
      size="md"
      foot={
        shown && (
          <>
            <DialogSpacer />
            {shown.next && <Button onClick={shown.next.run}>{shown.next.label}</Button>}
            {shown.close !== undefined && (
              <Button onClick={leaveDialog}>
                {shown.close}
                <Key keys={labels('esc')} decorative />
              </Button>
            )}
            <PrimaryButton
              primary={shown.primary}
              danger={danger}
              widest={widest}
              button={button}
            />
          </>
        )
      }
      initialFocus={typing ? field : button}
      onKeyDown={onKeyDown}
      container={document.getElementById('root')}
      testId="merge-confirm"
    >
      {shown?.body}
      {shown?.line}
      {shown?.problem && (
        <Problem
          layout="inline"
          title={withoutBidi(shown.problem.title)}
          reason={shown.problem.reason}
          details={shown.problem.details}
        />
      )}
      {shown?.done !== undefined && <DoneRow line={shown.done} />}
    </Dialog>
  );
}
