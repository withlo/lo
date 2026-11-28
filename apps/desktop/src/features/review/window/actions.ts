// What the review's key, the header's button, the status bar's item and the dialog do: open the
// dialog on the pull request on screen, read what it shows, keep its summary as it's typed, with the
// files attached to it, and submit. Held keys and a second press while one is sent submit nothing
// more, and nothing goes while GitHub can't be reached, a file attached to the summary is on its way
// in or its text holds a placeholder whose upload isn't, or Lo waits to know whether a review whose
// answer was lost was submitted, which "Check again" only looks for. Once it's submitted, the
// summary's files go with it, and an approval's dialog shows it done; any other review's closes,
// and a toast says what it did.

import type { Composer } from '@lo/ui/code';

import { IpcError } from '../../../ipc/contract.ts';
import { Answers } from '../../../window/answers.ts';
import { announce, refuse } from '../../../window/commands/notices.tsx';
import { offlineLabel } from '../../../window/explain.ts';
import { type Attachable, endUploads, uploadsHold } from '../../comments/window/shared.ts';
import { shipShowing } from '../../merge/window/shared.ts';
import { pullOf, runOf, activeTab, tabState, type PullTab } from '../../tab/window/shared.ts';
import {
  IN_A_LAYER,
  refusedAtOnce,
  SIGN_IN,
  type ReviewEventRow,
  type Submission,
  type SubmitOutcome,
  type Submitting,
} from '../contract.ts';
import { main, revisions as revisionsClient, tabs } from './main.ts';
import {
  pausedReason,
  pausedUntil,
  READING,
  stepOf,
  revisionLabel,
  toastOf,
  type Step,
} from './model.ts';
import { changeDialog, reviewStore, revisions, submitting, takeSubmission } from './store.ts';

/** How long after the last key the summary is saved, in milliseconds. */
export const SAVE_AFTER = 300;

/** What the dialog is titled: its command's name. */
export const TITLE = 'Submit review';

/** Why the dialog's main button is off while a file attached to the summary uploads. */
export const UPLOADING = 'A file is still uploading';

/**
 * A view's summary as a comment box files are attached to: it outlives the dialog, so a file still
 * uploading as the dialog closes takes its place in the summary kept.
 */
class SummaryBox implements Attachable {
  readonly id: string;
  readonly view: string;
  /** The summary's editor, while the dialog shows it. */
  composer: Composer | undefined;
  #text = '';

  constructor(view: string) {
    this.view = view;
    this.id = `lo-summary-${view}`;
  }

  get state(): { readonly text: string } {
    return { text: this.composer?.text ?? this.#text };
  }

  /** The summary's text, as it was typed or the dialog opened with it. */
  heard(text: string): void {
    this.#text = text;
  }

  rewrite(text: string): void {
    this.#text = text;
    const { dialog } = reviewStore.getState();
    if (dialog?.view === this.view) typed(text);
    else save(this.view, text);
  }
}

const summaries = new Map<string, SummaryBox>();

/** View `view`'s summary, as a comment box files are attached to. */
export function summaryBox(view: string): SummaryBox {
  let box = summaries.get(view);
  if (!box) {
    box = new SummaryBox(view);
    summaries.set(view, box);
  }
  return box;
}

/** Why view `view` can't submit a review at all, or `true`. */
export function canSubmit(view: string): true | string {
  if (pullOf(view)?.acting?.kind !== 'account') return SIGN_IN;
  if (runOf(view)) return IN_A_LAYER;
  return true;
}

/**
 * Why nothing is submitted for view `view` while GitHub gives it no answer, as the header's chip
 * calls why ("Offline", "No response"), or nothing while GitHub answers.
 */
export function offline(view: string): string | undefined {
  const connection = pullOf(view)?.connection;
  return connection?.kind === 'offline' ? offlineLabel(connection.cause) : undefined;
}

/** The pull request's tab on screen, if a review can be submitted from it, or why not. */
export function pullOnScreen(): PullTab | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  const can = canSubmit(tab.id);
  return can === true ? tab : can;
}

function messageOf(error: unknown): string {
  return error instanceof IpcError || error instanceof Error ? error.message : String(error);
}

/** Opens the submit dialog on view `tab`, as `⌘⏎`, the header's button and the status item do. */
export function openDialog(tab: PullTab): void {
  const { dialog } = reviewStore.getState();
  if (dialog) return;
  const view = tab.id;
  reviewStore.setState({
    dialog: {
      view,
      number: tab.number,
      read: undefined,
      event: 'COMMENT',
      text: '',
      busy: false,
      refusal: undefined,
    },
  });
  readDialog(view);
}

/** How long the dialog waits to ask again for what it shows while its pull request is read. */
const READ_AGAIN = 1_000;

/**
 * Asks main for what the dialog on view `view` shows. While the pull request is still being read,
 * it asks again in a moment; what can't be read is said in the dialog, with "Try again".
 */
function readDialog(view: string): void {
  const open = () => reviewStore.getState().dialog?.view === view;
  main()
    .dialog({ id: view })
    .then((read) => {
      if (!open()) return;
      takeSubmission({
        id: view,
        repo: `${read.owner}/${read.repo}`,
        number: read.number,
        state: read.submitting,
        submitted: null,
      });
      changeDialog(view, { read, text: read.summary?.text ?? '', unread: undefined });
    })
    .catch((error: unknown) => {
      if (!open()) return;
      if (error instanceof IpcError && error.code === 'reading') {
        setTimeout(() => {
          if (open()) readDialog(view);
        }, READ_AGAIN);
        return;
      }
      // Why this view can't submit at all: the reason alone, as its control would say it.
      if (error instanceof IpcError && error.code === 'refused') {
        closeDialog();
        refuse(error.message);
        return;
      }
      changeDialog(view, { unread: messageOf(error) });
    });
}

/** "Try again" in the dialog, once what it shows couldn't be read: reads it again. */
export function readAgain(): void {
  const { dialog } = reviewStore.getState();
  if (!dialog || dialog.read || dialog.unread === undefined) return;
  changeDialog(dialog.view, { unread: undefined });
  readDialog(dialog.view);
}

let saving: { view: string; timer: ReturnType<typeof setTimeout> } | undefined;

/** Saves the summary on view `view` now. */
function save(view: string, text: string): void {
  main()
    .draft({ id: view, text })
    .catch((error: unknown) => console.error("Lo couldn't save the review's summary:", error));
}

/** The summary was typed in: it's saved once typing stops. */
export function typed(text: string): void {
  const { dialog } = reviewStore.getState();
  if (!dialog) return;
  const { view } = dialog;
  summaryBox(view).heard(text);
  changeDialog(view, { text, refusal: undefined });
  if (saving) clearTimeout(saving.timer);
  saving = {
    view,
    timer: setTimeout(() => {
      saving = undefined;
      save(view, text);
    }, SAVE_AFTER),
  };
}

/** Saves the summary now, if it's waiting to be saved: as the dialog closes or the window goes. */
export function saveNow(): void {
  if (!saving) return;
  clearTimeout(saving.timer);
  const { view } = saving;
  saving = undefined;
  const { dialog } = reviewStore.getState();
  if (dialog?.view === view) save(view, dialog.text);
}

/** Closes the dialog, keeping its summary. */
export function closeDialog(): void {
  // While the review is sent nothing leaves the dialog, `Esc` in the summary included.
  if (stepNow()?.state === 'working') return;
  saveNow();
  reviewStore.setState({ dialog: undefined });
}

/** Chooses verdict `event`. */
export function choose(event: ReviewEventRow): void {
  const { dialog } = reviewStore.getState();
  if (dialog) changeDialog(dialog.view, { event, refusal: undefined });
}

/**
 * Why nothing can be sent from the dialog now, if it can't: it's still reading, the view can't
 * submit, it's offline, a file attached to the summary is on its way in, or GitHub asked Lo to
 * hold off writing until a time still to come.
 */
export function whyNot(now = Date.now()): string | undefined {
  const { dialog } = reviewStore.getState();
  if (!dialog?.read) return READING;
  const can = canSubmit(dialog.view);
  if (can !== true) return can;
  const away = offline(dialog.view);
  if (away !== undefined) return away;
  if (uploadsHold(summaryBox(dialog.view))) return UPLOADING;
  const until = pausedUntil(dialog.read, now);
  return until === undefined ? undefined : pausedReason(until);
}

/** Where the open dialog has got to, as it shows it, or nothing while none is open. */
export function stepNow(now = Date.now()): Step | undefined {
  const { dialog } = reviewStore.getState();
  if (!dialog) return undefined;
  const { view } = dialog;
  const comparison = revisions.get(view);
  return stepOf(
    {
      read: dialog.read,
      number: dialog.number,
      event: dialog.event,
      sent: dialog.sent,
      text: dialog.text,
      busy: dialog.busy,
      checking: dialog.checking === true,
      refusal: dialog.refusal,
      done: dialog.done,
      state: submitting.get(view),
      blocked: whyNot(now),
      unread: dialog.unread,
    },
    (head) => revisionLabel(comparison, head),
    now,
  );
}

/**
 * What main says on `submitted` of the reviews each view submits, against its answers: main says a
 * review is on its way (`sending`), then how it stands, before it answers, but what it says can
 * come after the answer, and then changes nothing of what the answer said.
 */
const submits = tabState(() => new Answers());

/**
 * How submitting stands once main gave `outcome`, as main said with it: nothing for a refusal it
 * gave at once, before it said anything.
 */
function saidWith(outcome: SubmitOutcome): { state: Submitting | null } | undefined {
  switch (outcome.kind) {
    case 'submitted':
      return { state: null };
    case 'refused':
      return refusedAtOnce(outcome.refusal) ? undefined : { state: null };
    case 'lost':
      return { state: 'checking' };
    default:
      outcome satisfies never;
      return undefined;
  }
}

/**
 * Submits the review the dialog shows, as its main button or `⌘⏎` does: only while that button
 * submits and can be pressed.
 */
export async function submit(): Promise<void> {
  const { dialog } = reviewStore.getState();
  const step = stepNow();
  if (!dialog?.read || !step) return;
  const { primary } = step;
  if (primary.does !== 'submit' || primary.busy || primary.off !== undefined) return;
  const { view, event, text } = dialog;
  // What waits to be saved goes with it: main keeps it as the summary until GitHub takes it.
  if (saving?.view === view) {
    clearTimeout(saving.timer);
    saving = undefined;
  }
  changeDialog(view, { busy: true, sent: event, checking: false, refusal: undefined });
  const answers = submits.get(view);
  const asked = answers.ask(view);
  let answeredYet = false;
  try {
    const outcome = await main().submit({ id: view, event, body: text });
    answeredYet = true;
    // What main said of it before its answer, coming after, changes nothing: from the answer on,
    // it stands as main said with it, which may come later.
    const said = saidWith(outcome);
    if (answers.answered(asked, said !== undefined) && said) submitting.set(view, said.state);
    switch (outcome.kind) {
      case 'submitted':
        // The toast, where there is one, comes with what main says of it, for every view of the
        // pull request.
        reached(view, outcome.event);
        endUploads(summaryBox(view));
        break;
      case 'refused':
        changeDialog(view, { refusal: outcome.refusal });
        break;
      case 'lost':
        break;
      default:
        outcome satisfies never;
    }
  } catch (error) {
    if (!answeredYet) answers.answered(asked, false);
    changeDialog(view, { refusal: { kind: 'github', message: messageOf(error) } });
  } finally {
    changeDialog(view, { busy: false });
  }
}

/**
 * Looks again whether the review sent from the dialog, whose answer was lost, was submitted, as
 * its "Check again" does once Lo couldn't tell: nothing is sent, and the button is at work until
 * main says what the look found.
 */
export function checkAgain(): void {
  const { dialog } = reviewStore.getState();
  if (!dialog || submitting.get(dialog.view) !== 'unknown') return;
  const { view } = dialog;
  changeDialog(view, { checking: true });
  // Main looks only while it can't tell. One it makes it says on `submitted`, which can come after
  // its answer, so the button is at work until main says what the look found; with none, the
  // button is its own again.
  const stop = () => changeDialog(view, { checking: false });
  main()
    .check({ id: view })
    .then(
      (looks) => {
        if (!looks) stop();
      },
      (error: unknown) => {
        console.error("Lo couldn't ask to look for a review again:", error);
        stop();
      },
    );
}

/** Does what the dialog's main button says, as a click or `⌘⏎` does. */
export function runPrimary(): void {
  const step = stepNow();
  // At work, it's pressed already: a held or second `⌘⏎` does nothing more.
  if (step === undefined || step.primary.busy) return;
  const does = step.primary.does;
  if (does === 'submit') void submit();
  else if (does === 'check') checkAgain();
  else if (does === 'read') readAgain();
  else if (does === 'close') closeDialog();
}

/**
 * A review submitted from view `view` with verdict `event` ends in its dialog, if it's open there:
 * an approval stays to show it's done, and any other closes it. Whether the dialog shows it.
 */
function reached(view: string, event: ReviewEventRow | null): boolean {
  const { dialog } = reviewStore.getState();
  if (dialog?.view !== view) return false;
  if (dialog.done !== undefined) return true;
  if (event === 'APPROVE') {
    changeDialog(view, { done: event, busy: false, checking: false, refusal: undefined });
    return true;
  }
  reviewStore.setState({ dialog: undefined });
  return false;
}

/**
 * Takes what main says of submitting from a view. A review submitted ends in its dialog, if it's
 * open: an approval shows it's done there, with no toast. Any other closes it, and a toast says what
 * it did, as it does once the dialog was closed before the end.
 */
export function heard(submission: Submission): void {
  const { id } = submission;
  // What main said before its answer to a review submitted from here, coming after the answer,
  // changes nothing.
  const older = submits.get(id).take(() => submission.state === 'sending');
  if (older.has(id)) return;
  takeSubmission(submission);
  if (submission.state !== 'checking') changeDialog(id, { checking: false });
  if (!submission.submitted) return;
  // The summary went with it, and its files.
  endUploads(summaryBox(id));
  const { event } = submission.submitted;
  if (reached(id, event)) return;
  // Another view of the pull request shows the approval done already: the same pull request, by
  // its repository too, since another repository's may have its number.
  const { dialog } = reviewStore.getState();
  const read = dialog?.read;
  if (
    dialog?.done !== undefined &&
    read !== undefined &&
    dialog.number === submission.number &&
    `${read.owner}/${read.repo}`.toLowerCase() === submission.repo.toLowerCase()
  ) {
    return;
  }
  // Approve and ship's dialog says what it approved, and nothing else says it again.
  if (shipShowing(id)) return;
  announce(toastOf(event, submission.number));
}

/**
 * Shows revision `head` of view `view`'s pull request, whole, as "Show r3" does. The dialog stays
 * until it's shown, and says so if it can't be.
 */
export function showRevision(view: string, head: string): void {
  changeDialog(view, { unshown: undefined });
  const pull = pullOf(view);
  const asked =
    pull?.newer?.toLowerCase() === head.toLowerCase()
      ? tabs().reload({ id: view })
      : revisionsClient().compare({ id: view, from: null, to: head });
  asked.then(
    () => closeDialog(),
    (error: unknown) => changeDialog(view, { unshown: { head, details: messageOf(error) } }),
  );
}
