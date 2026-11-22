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
import { announce, refuse } from '../../../window/commands/notices.tsx';
import { type Attachable, endUploads, uploadsHold } from '../../comments/window/shared.ts';
import { pullOf, runOf, activeTab, type PullTab } from '../../tab/window/shared.ts';
import { IN_A_LAYER, SIGN_IN, type ReviewEventRow, type Submission } from '../contract.ts';
import { main, revisions as revisionsClient, tabs } from './main.ts';
import {
  OFFLINE,
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

/** Whether GitHub can't be reached for view `view`, so nothing is submitted. */
export function offline(view: string): boolean {
  return pullOf(view)?.connection.kind === 'offline';
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
  main()
    .dialog({ id: view })
    .then((read) => {
      takeSubmission({ id: view, number: tab.number, state: read.submitting, submitted: null });
      changeDialog(view, { read, text: read.summary?.text ?? '' });
    })
    .catch((error: unknown) => {
      closeDialog();
      refuse(messageOf(error));
    });
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
  if (offline(dialog.view)) return OFFLINE;
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
    },
    (head) => revisionLabel(comparison, head),
    now,
  );
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
  try {
    const outcome = await main().submit({ id: view, event, body: text });
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
  const stop = () => {
    // Main looks only while it can't tell; if it didn't, the button is its own again.
    if (submitting.get(view) === 'unknown') changeDialog(view, { checking: false });
  };
  main()
    .check({ id: view })
    .then(stop, (error: unknown) => {
      console.error("Lo couldn't ask to look for a review again:", error);
      stop();
    });
}

/** Does what the dialog's main button says, as a click or `⌘⏎` does. */
export function runPrimary(): void {
  const does = stepNow()?.primary.does;
  if (does === 'submit') void submit();
  else if (does === 'check') checkAgain();
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
  takeSubmission(submission);
  const { id } = submission;
  if (submission.state !== 'checking') changeDialog(id, { checking: false });
  if (!submission.submitted) return;
  // The summary went with it, and its files.
  endUploads(summaryBox(id));
  const { event } = submission.submitted;
  if (reached(id, event)) return;
  // Another view of the pull request shows the approval done already.
  const { dialog } = reviewStore.getState();
  if (dialog?.done !== undefined && dialog.number === submission.number) return;
  announce(toastOf(event, submission.number));
}

/** Shows revision `head` of view `view`'s pull request, whole, as "Show r3" does. */
export function showRevision(view: string, head: string): void {
  closeDialog();
  const pull = pullOf(view);
  const asked =
    pull?.newer?.toLowerCase() === head.toLowerCase()
      ? tabs().reload({ id: view })
      : revisionsClient().compare({ id: view, from: null, to: head });
  asked.catch((error: unknown) => refuse(messageOf(error)));
}
