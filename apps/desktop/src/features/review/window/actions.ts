// What the review's key, the status bar's item and the dialog do: open the dialog on the pull
// request on screen, read what it shows, keep its summary as it's typed, with the files attached
// to it, and submit. Held keys and a second press while one is sent submit nothing more, and
// nothing goes while GitHub can't be reached, a file attached to the summary is on its way in or
// its text holds a placeholder whose upload isn't, or Lo waits to know whether a review whose
// answer was lost was submitted. Once it's submitted, the summary's files go with it.

import type { Composer } from '@lo/ui/code';

import { IpcError } from '../../../ipc/contract.ts';
import { announce, notify } from '../../../window/commands/notices.tsx';
import { type Attachable, endUploads, uploadsHold } from '../../comments/window/shared.ts';
import { pullOf, runOf, activeTab, type PullTab } from '../../tab/window/shared.ts';
import { IN_A_LAYER, SIGN_IN, type ReviewEventRow, type Submission } from '../contract.ts';
import { main, revisions as revisionsClient, tabs } from './main.ts';
import { held, OFFLINE, pausedUntil, plannedRefusal, toastOf } from './model.ts';
import { changeDialog, reviewStore, submitting, takeSubmission } from './store.ts';

/** How long after the last key the summary is saved, in milliseconds. */
export const SAVE_AFTER = 300;

/** What the command, the dialog and the notes call submitting. */
export const TITLE = 'Submit review';

/** Why the dialog's main button is off while a file attached to the summary uploads. */
export const UPLOADING = 'Uploading. Submit the review once the files are in.';

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
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  const can = canSubmit(tab.id);
  return can === true ? tab : can;
}

function messageOf(error: unknown): string {
  return error instanceof IpcError || error instanceof Error ? error.message : String(error);
}

/** Opens the submit dialog on view `tab`, as `⌘⏎` or the status bar's item does. */
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
      notify(TITLE, messageOf(error));
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

/** Why the dialog's main button is off now, if it is. */
export function whyNot(): string | undefined {
  const { dialog } = reviewStore.getState();
  if (!dialog?.read) return 'Lo is reading your pending review.';
  const can = canSubmit(dialog.view);
  if (can !== true) return can;
  if (offline(dialog.view)) return OFFLINE;
  const hold = uploadsHold(summaryBox(dialog.view));
  if (hold) return hold.kind === 'running' ? UPLOADING : hold.text;
  return undefined;
}

/**
 * Submits the review the dialog shows, as its main button or `⌘⏎` does, or, `anyway`, though Lo
 * couldn't tell whether the last was submitted.
 */
export async function submit(anyway = false): Promise<void> {
  const { dialog } = reviewStore.getState();
  if (!dialog?.read || dialog.busy || whyNot() !== undefined) return;
  const { view, read, event, text } = dialog;
  // While GitHub asked Lo to hold off, the dialog says until when, and nothing goes.
  if (pausedUntil(read, Date.now()) !== undefined) return;
  const state = submitting.get(view);
  if (state === 'unknown' ? !anyway : held(state)) return;
  if (plannedRefusal(read, event, text) !== undefined) return;
  // What waits to be saved goes with it: main keeps it as the summary until GitHub takes it.
  if (saving?.view === view) {
    clearTimeout(saving.timer);
    saving = undefined;
  }
  changeDialog(view, { busy: true, refusal: undefined });
  try {
    const outcome = await main().submit({ id: view, event, body: text, anyway });
    switch (outcome.kind) {
      case 'submitted':
        // The toast comes with what main says of it, for every view of the pull request.
        if (reviewStore.getState().dialog?.view === view)
          reviewStore.setState({ dialog: undefined });
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

/** Takes what main says of submitting from a view: a review submitted closes its dialog, with a toast. */
export function heard(submission: Submission): void {
  takeSubmission(submission);
  if (!submission.submitted) return;
  // The summary went with it, and its files.
  endUploads(summaryBox(submission.id));
  const { dialog } = reviewStore.getState();
  if (dialog?.view === submission.id) reviewStore.setState({ dialog: undefined });
  announce(toastOf(submission.submitted.event, submission.number));
}

/** Shows revision `head` of view `view`'s pull request, whole, as "Show r3" does. */
export function showRevision(view: string, head: string): void {
  closeDialog();
  const pull = pullOf(view);
  const asked =
    pull?.newer?.toLowerCase() === head.toLowerCase()
      ? tabs().reload({ id: view })
      : revisionsClient().compare({ id: view, from: null, to: head });
  asked.catch((error: unknown) => notify('Show the revision', messageOf(error)));
}
