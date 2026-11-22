// The merge's dialog, in the tab feature's `tab.dialogs` slot, in the merge panel's place: the plan
// to confirm, with the account, the method, the branch and the revision it merges, under one title
// from the moment it opens, then the merge as it goes, and why it didn't, when it didn't. A GitHub stack's merge lists every layer that
// merges, with where each stands, and then how far GitHub got with each; a chain's, each base
// branch Lo moves, in order. `⏎` confirms and `Esc` goes back to the panel. A held key confirms
// nothing, and nor does the press that opened it: only a fresh press of `⏎` once the plan shows.
// Auto-merge's says what GitHub waits for before it merges; a merge past the rules lists what it
// skips, and goes only with the pull request's number typed, in a field that empties each time Lo
// asks again.

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
  Steps,
  TypeToConfirm,
  type FactItem,
  type LayerRow,
  type StepItem,
  type StepState,
} from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { pullOf, usePull, withoutBidi } from '../../tab/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import type { JobView, MergePlan, MoveStatus, Progress, Refusal, Together } from '../contract.ts';
import {
  askAgain,
  confirmMerge,
  jobsByKey,
  leaveDialog,
  newerLabel,
  newerOf,
  openPull,
  seeNewer,
  staysShown,
  typeNumber,
} from './merging.ts';
import { merging, panels, statuses, type MergeDialog, type Sketch } from './store.ts';
import {
  chainSteps,
  confirmLabel,
  confirmWorking,
  confirmTitle,
  doneLine,
  layerLine,
  methodLabel,
  numbers,
  onceLine,
  outcomeDetail,
  outcomeTitle,
  pushWarning,
  queueLine,
  saidOf,
  secondsAgo,
  skipsOf,
  stackLine,
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
   * it asks for is typed. While what it was pressed for runs it's `busy` and says `working`, and
   * that's all that says so: no line in the body waits beside it.
   */
  readonly primary:
    | {
        readonly label: string;
        readonly run: () => void;
        readonly busy?: boolean;
        /** What it says while busy, the verb of its label: "Merging…". */
        readonly working?: string;
        readonly danger?: boolean;
        readonly off?: boolean;
      }
    | undefined;
  /** Whether focus goes to the field to type in, not the main button. */
  readonly typing?: boolean;
  /** What `Esc` says it does, on the other button. None once "Done" is all that's left to press. */
  readonly close: string | undefined;
  /** What focus follows: its main button moves to it when this changes. */
  readonly step: string;
}

/** What `plan` names, as the dialog states it. */
function sketchOf(plan: MergePlan): Sketch {
  const { id, number, login, kind, method, base, head, title } = plan;
  const stack = plan.together?.kind === 'stack';
  return { id, number, login, kind, method, base, head, title, stack };
}

/** "r5 of #4821, the one on screen", or the commit's short ID when Lo has no revision for it. */
function revisionOf(plan: Pick<Sketch, 'id' | 'number' | 'head'>): string {
  const label = revisionLabel(revisionsOf(plan.id), plan.head) ?? plan.head.slice(0, 7);
  return `${label} of #${plan.number}, the one on screen`;
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
      value: stack && plan.method === 'SQUASH' ? `${method}, one commit per layer` : method,
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

/** Why it didn't go, in the core's words, each rule GitHub named on a line of its own. */
function RefusalCallout({
  refusal,
  title,
}: {
  refusal: Pick<Refusal, 'text' | 'rules'>;
  title?: string | undefined;
}) {
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
    { number: plan.number, title: titleOf(plan), state: 'now', detail: 'The one on screen' },
  ];
}

/** What a stack's merge says of the layers above it: "#4824 stays open and moves onto main." */
function aboveLine(above: readonly number[], base: string): string | undefined {
  if (above.length === 0) return undefined;
  return above.length === 1
    ? `${numbers(above)}, above it, stays open and moves onto ${base}.`
    : `${numbers(above)}, above it, stay open and move onto ${base}.`;
}

/** What it takes with it, in the confirmation: a stack's layers, or a chain's moves, in order. */
function togetherShown(plan: MergePlan): ReactNode {
  const { together } = plan;
  switch (together?.kind) {
    case undefined:
      return undefined;
    case 'stack': {
      const above = aboveLine(together.above, plan.base);
      return (
        <>
          <LayerList label="Layers that merge" layers={stackLayers(plan, together)} />
          {above !== undefined && (
            <p className="m-0 text-fg-muted text-small">{withoutBidi(above)}</p>
          )}
        </>
      );
    }
    case 'chain':
      return (
        <>
          <Steps
            label="What Lo does"
            steps={chainSteps(plan, together).map((step) => ({
              key: step.key,
              state: 'todo',
              title: withoutBidi(step.title),
              detail: withoutBidi(step.detail),
            }))}
          />
          <p className="m-0 text-fg-muted text-small">
            Lo moves the layers above once it has merged, while Lo is open.
          </p>
        </>
      );
    default:
      together satisfies never;
      return undefined;
  }
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
    title: `Merge #${plan.number} into ${withoutBidi(plan.base)}`,
    ...mergeStep(job, progress),
  };
  const moves = progress.moves.map((move) => ({
    key: move.before ? 'before' : `after-${move.move.pr}`,
    state: stepOf(move.status),
    title: withoutBidi(`Move #${move.move.pr} onto ${move.move.to}`),
    detail: withoutBidi(
      move.detail ?? detailOf(move.before ? 'before' : `after-${move.move.pr}`) ?? '',
    ),
  }));
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
      return progress.phase === 'before'
        ? { state: 'todo', detail: 'Once its base branch has moved' }
        : { state: 'now', detail: 'Sending' };
    case 'pending':
      return { state: 'now', detail: 'GitHub is merging it' };
    case 'merged':
      return { state: 'done', detail: 'Merged' };
    case 'enqueued':
      return progress.phase === 'waiting'
        ? { state: 'now', detail: 'In the merge queue' }
        : { state: 'done', detail: 'Merged from the queue' };
    case 'refused':
      return { state: 'stopped', detail: 'Didn’t merge' };
    case 'unknown':
      return progress.phase === 'waiting'
        ? { state: 'now', detail: 'Lo is reading whether it merged' }
        : { state: 'stopped', detail: 'Lo can’t tell whether it merged' };
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
            ? { number: layer.number, title, state: 'now', detail: 'Checking rules', working: true }
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

/** The time now, again each second while `ticking`, for how long ago GitHub took a merge. */
function useSeconds(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * What turning auto-merge on waits for, and what a push before then would do, as main planned it:
 * what the press checks again.
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

/** What a merge past the rules skips, a line each, as main planned it: what the press checks again. */
function Skips({ plan }: { plan: MergePlan }) {
  const said = saidOf(plan);
  const skips = said ? skipsOf(said) : [];
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

/**
 * What the plan will do. It's the dialog's body from the question until the merge is done, so
 * nothing in it moves as its button is pressed, and what was confirmed stays in view while it's
 * done. A merge past the rules has its number typed in `field`; once sent, the field keeps the
 * number, and typing in it changes nothing.
 */
function planBody(
  plan: MergePlan,
  field?: {
    readonly typed: string;
    readonly onChange: (value: string) => void;
    readonly onConfirm: () => void;
    readonly inputRef: RefObject<HTMLInputElement | null>;
    readonly note: string | undefined;
  },
): ReactNode {
  const override = plan.kind === 'override';
  const auto = plan.kind === 'autoMerge' || plan.kind === 'whenReady';
  return (
    <>
      {override && <Skips plan={plan} />}
      {plan.together?.kind === 'stack' && (
        <p className="m-0 text-fg-muted text-small">A GitHub stack merges as one.</p>
      )}
      <Facts items={factsOf(sketchOf(plan))} />
      {plan.kind === 'enqueue' && (
        <p className="m-0 text-fg-muted text-small">{queueLine(plan.method)}</p>
      )}
      {togetherShown(plan)}
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
      {field?.note !== undefined && (
        <Callout tone="warning" role="status">
          {withoutBidi(field.note)}
        </Callout>
      )}
    </>
  );
}

function confirmShown(
  dialog: Extract<MergeDialog, { kind: 'confirm' }>,
  field: RefObject<HTMLInputElement | null>,
): Shown {
  const { plan } = dialog;
  const override = plan.kind === 'override';
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
      working: confirmWorking(plan),
      ...(override && { danger: true, off: typed !== number }),
    },
    typing: override,
    body: planBody(plan, {
      typed,
      onChange: typeNumber,
      onConfirm: confirmMerge,
      inputRef: field,
      note: dialog.note,
    }),
  };
}

/** A stack's merge as it goes: its layers, and how long ago GitHub took it. */
function stackShown(
  plan: MergePlan,
  job: JobView,
  progress: Extract<Progress, { kind: 'stack' }>,
  now: number,
): Shown | undefined {
  const { state } = job;
  const layers = <LayerList label="Layers merging" layers={stackProgress(job, progress)} />;
  if (state.kind === 'sending' || state.kind === 'pending') {
    const taken =
      progress.takenAt === null
        ? 'Sending to GitHub’s async merge.'
        : `Submitted to GitHub’s async merge ${secondsAgo(progress.takenAt, now)}. Branch rules are checked as it runs.`;
    return {
      title: stackLine(job, progress),
      step: state.kind,
      close: 'Close',
      primary: undefined,
      body: (
        <>
          <p role="status" className="m-0 text-fg-muted text-small">
            {taken}
          </p>
          {layers}
          {state.kind === 'pending' && state.trouble !== null && (
            <p className="m-0 text-fg-muted text-small">
              {withoutBidi(troubleLine(state.trouble))}
            </p>
          )}
          <p className="m-0 text-fg-muted text-small">
            You can close this; the tab shows the result.
          </p>
        </>
      ),
    };
  }
  if (staysShown(job)) {
    const [next] = progress.above;
    const merged = progress.layers.map((layer) => layer.number);
    const sits =
      progress.above.length === 1
        ? `${numbers(progress.above)} now sits on ${plan.base}.`
        : `${numbers(progress.above)} now sit on ${plan.base}.`;
    return {
      title: doneLine(job) ?? stackLine(job, progress),
      step: `merged ${plan.key}`,
      close: 'Close',
      primary:
        next === undefined ? undefined : { label: `Open #${next}`, run: () => openPull(job, next) },
      body: <p className="m-0 text-fg text-ui">{withoutBidi(`${numbers(merged)}. ${sits}`)}</p>,
    };
  }
  if (state.kind === 'refused') {
    return {
      title: confirmTitle(plan),
      step: `refused ${plan.key}`,
      close: 'Close',
      primary: newerPrimary(plan, state.refusal),
      body: (
        <>
          <RefusalCallout
            refusal={{ text: outcomeDetail(job), rules: state.refusal.rules }}
            title={outcomeTitle(job)}
          />
          {layers}
        </>
      ),
    };
  }
  return undefined;
}

/** A chain's merge as it goes, from its bottom layer: each move and the merge, in order. */
function chainShown(
  plan: MergePlan,
  job: JobView,
  progress: Extract<Progress, { kind: 'chain' }>,
): Shown | undefined {
  // Done, the toast says so; Lo can't tell, the dialog asks GitHub again, as for a merge alone.
  if (progress.phase === 'done') return undefined;
  if (job.state.kind === 'unknown' && progress.phase === 'stopped') return undefined;
  const steps = <Steps label="What Lo does" steps={chainProgress(plan, job, progress)} />;
  const outcome = outcomeTitle(job);
  if (progress.phase === 'stopped') {
    const rules = job.state.kind === 'refused' ? job.state.refusal.rules : [];
    return {
      title: confirmTitle(plan),
      step: `stopped ${plan.key}`,
      close: 'Close',
      primary: job.state.kind === 'refused' ? newerPrimary(plan, job.state.refusal) : undefined,
      body: (
        <>
          <RefusalCallout refusal={{ text: outcomeDetail(job), rules }} title={outcome} />
          {steps}
        </>
      ),
    };
  }
  return {
    title: confirmTitle(plan),
    step: `${progress.phase} ${job.state.kind}`,
    close: 'Close',
    primary: undefined,
    body: (
      <>
        {steps}
        {progress.text !== null && (
          <p role="status" className="m-0 text-fg-muted text-small">
            {withoutBidi(progress.text)}
          </p>
        )}
        <p className="m-0 text-fg-muted text-small">
          You can close this; the tab shows how it ends.
        </p>
      </>
    ),
  };
}

/** What the main button says while the merge is worked out, before it can be named. */
const CHECKING = 'Checking…';

/**
 * The main button while the merge it sent runs: still there, busy, saying what it's doing, with its
 * fill, its width and focus as they were. Nothing else in the dialog says the merge is running.
 */
function atWork(plan: MergePlan): Shown['primary'] {
  return {
    label: confirmLabel(plan),
    run: () => undefined,
    busy: true,
    working: confirmWorking(plan),
  };
}

/**
 * The merge is done: what was confirmed stays, and the button that did it is "Done", with focus,
 * so `⏎` closes the dialog.
 */
function done(plan: MergePlan): Shown {
  return {
    title: confirmTitle(plan),
    step: 'done',
    close: undefined,
    primary: { label: 'Done', run: leaveDialog },
    body: planBody(plan),
  };
}

function sentShown(plan: MergePlan, job: JobView | undefined, now: number): Shown {
  const title = confirmTitle(plan);
  const state = job?.state;
  const together = job?.together;
  if (job && together?.kind === 'stack') {
    const shown = stackShown(plan, job, together, now);
    if (shown) return shown;
  }
  if (job && together?.kind === 'chain') {
    const shown = chainShown(plan, job, together);
    if (shown) return shown;
  }
  switch (state?.kind) {
    case undefined:
    case 'sending':
      return {
        title,
        step: 'sending',
        close: 'Close',
        primary: atWork(plan),
        body: planBody(plan),
      };
    case 'pending':
      return {
        title,
        step: 'pending',
        close: 'Close',
        primary: atWork(plan),
        body: (
          <>
            {planBody(plan)}
            {state.trouble !== null && (
              <p role="status" className="m-0 text-fg-muted text-small">
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
      return done(plan);
    default:
      state satisfies never;
      return done(plan);
  }
}

function shownOf(
  dialog: MergeDialog,
  jobs: (key: string) => JobView | undefined,
  field: RefObject<HTMLInputElement | null>,
  now: number,
): Shown {
  switch (dialog.kind) {
    case 'planning':
      return {
        title: dialog.title,
        step: 'planning',
        close: 'Cancel',
        // There from the start, so focus is on it, not on Cancel, when the plan comes.
        primary: { label: dialog.label, run: () => undefined, busy: true, working: CHECKING },
        // Only the button waits on the check: what the merge names is known already.
        body: dialog.sketch && <Facts items={factsOf(dialog.sketch)} />,
      };
    case 'confirm':
      return confirmShown(dialog, field);
    case 'sent':
      return sentShown(dialog.plan, jobs(dialog.plan.key), now);
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

/**
 * The dialog's main button, with `⏎`. It keeps one width from checking to sent: as wide as its
 * label, what it says at work, or "Checking…", whichever is widest.
 */
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
      busy={primary.busy === true}
      working={primary.working}
      // The room "Checking…" takes with its ring, kept once the plan has come too, so the button is
      // as wide while it asks as it was while it checked.
      widest={CHECKING}
      aria-disabled={primary.off || undefined}
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
  usePull(dialog ? (dialog.kind === 'planning' ? dialog.id : dialog.plan.id) : '');
  const button = useRef<HTMLButtonElement>(null);
  // Where a merge past the rules asks for its number.
  const field = useRef<HTMLInputElement>(null);
  /** When what the dialog shows now came up: a press before then isn't one for it. */
  const shownAt = useRef(Number.POSITIVE_INFINITY);
  const sentJob = dialog?.kind === 'sent' ? jobsByKey(dialog.plan.key) : undefined;
  const now = useSeconds(
    sentJob?.together?.kind === 'stack' &&
      (sentJob.state.kind === 'sending' || sentJob.state.kind === 'pending'),
  );
  const shown = dialog && shownOf(dialog, jobsByKey, field, now);
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
            {shown.close !== undefined && (
              <Button onClick={leaveDialog}>
                {shown.close}
                <Key keys={labels('esc')} decorative />
              </Button>
            )}
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
