// What the submit dialog, the status bar's item and the banner say, worked out from what main sent:
// the verdicts and their lines, why a review can't go before it's sent, where the dialog has got to
// with its main button and what went wrong, and the result once it's done. Pure functions, so
// they're tested without a window.

import { REVIEW_EVENTS, YourReview, type ReviewRefusal } from '@lo/review';
import type { DialogState } from '@lo/ui';
import type { System } from '@lo/ui/commands';

import { clockOf } from '../../../window/time.ts';
import type { PendingReviewRow } from '../../comments/contract.ts';
import type { ComparisonView } from '../../revisions/contract.ts';
import {
  IN_A_LAYER,
  SIGN_IN,
  type DialogView,
  type ReviewEventRow,
  type SubmitRefusal,
  type Submitting,
} from '../contract.ts';

/** Why the main button is off while the dialog reads what it shows. */
export const READING = 'Reading pending review…';

/** What failed, once Lo knows the review didn't go. */
export const COULDNT = 'Couldn’t submit the review';

/** Why a review isn't confirmed, or didn't go, when GitHub's answer never came. */
export const NO_ANSWER = 'GitHub didn’t respond.';

/** Why a review GitHub refused didn't go: what GitHub said is behind Details. */
export const GITHUB_FAILED = 'GitHub returned an error.';

/** A revision's label, `r3`, or its head cut short for a commit that's no revision Lo knows. */
export function revisionLabel(view: ComparisonView | undefined, head: string): string {
  const number = view?.revisions.find((each) => each.head === head.toLowerCase())?.number;
  return number === undefined || number === null ? head.slice(0, 7) : `r${number}`;
}

/** The head the newer column shows, as main last said: the revision on screen. */
export function headOnScreen(view: ComparisonView | undefined): string | undefined {
  return view?.comparison?.to ?? view?.shown ?? undefined;
}

/** `count` and a noun, made plural past one: "1 pending comment", "3 pending comments". */
export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The dialog's line under its title: the pull request, and the revision it reviews. */
export function subtitleOf(view: DialogView, label: (head: string) => string): string {
  return `${view.repo} #${view.number} · ${label(view.on)}`;
}

/** How long ago `at` was, in its largest whole unit: "just now", "12 min ago", "2 h ago". */
export function agoOf(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} d ago`;
  const when = new Date(at);
  const year = when.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  return when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year });
}

/** The line over the summary's foot for a summary kept from before: "Draft from 12 min ago". */
export function draftLine(savedAt: number, now: number): string {
  return `Draft from ${agoOf(savedAt, now)}`;
}

/** The comments your pending review holds, as the dialog counts them. */
export function pendingCount(pending: PendingReviewRow): number {
  return pending.kind === 'pending' ? pending.comments : 0;
}

/** What the palette says after "Submit review…" of your pending review: "3 pending", or nothing. */
export function pendingDetail(pending: PendingReviewRow | undefined): string | undefined {
  const count = pending ? pendingCount(pending) : 0;
  return count > 0 ? `${count} pending` : undefined;
}

/** A verdict's name, as its choice says it. */
export const verdictNames: Readonly<Record<ReviewEventRow, string>> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

/**
 * A verdict the dialog offers, with the line that explains it, or, for one that can't be chosen,
 * why (`off`), which its line says in its place.
 */
export interface Verdict {
  readonly event: ReviewEventRow;
  readonly title: string;
  readonly description: string;
  readonly off: string | undefined;
}

/**
 * Why verdict `event` can't be chosen from `view`, whatever the summary says: Approve and Request
 * changes on your own pull request, which GitHub takes only comments on from its author, or while
 * your pending review is on another revision than the one on screen.
 */
export function verdictRefusal(
  view: DialogView,
  event: ReviewEventRow,
  label: (head: string) => string,
): string | undefined {
  // Any summary, so a blank one says nothing here: that's the main button's to say.
  const refusal = plannedRefusal(view, event, 'summary');
  if (refusal?.kind !== 'ownPullRequest' && refusal?.kind !== 'otherRevision') return undefined;
  // Each verdict says what it is its author can't do.
  if (refusal.kind === 'ownPullRequest' && event === 'REQUEST_CHANGES') return OWN_CHANGES;
  return reasonOf(refusal, label);
}

/** Why Request changes is dimmed on your own pull request. */
const OWN_CHANGES = 'Its author can’t request changes';

/**
 * The verdicts the dialog offers, in `@lo/review`'s order, each dimmed with why where it can't be
 * chosen.
 */
export function verdictsOf(view: DialogView, label: (head: string) => string): Verdict[] {
  const lines: Readonly<Record<ReviewEventRow, string>> = {
    COMMENT: 'Feedback without a verdict.',
    APPROVE: `Approves the changes at ${label(view.on)}.`,
    REQUEST_CHANGES: 'Asks for changes before it merges.',
  };
  return REVIEW_EVENTS.map((event) => {
    const off = verdictRefusal(view, event, label);
    return { event, title: verdictNames[event], description: off ?? lines[event], off };
  });
}

/**
 * The revision your pending review is on, when it's one GitHub still has other than the one on
 * screen and showing it is what lets Approve and Request changes go: for "Show r3" under them.
 */
export function showFor(view: DialogView): string | undefined {
  const { pending } = view;
  if (view.own || pending.kind !== 'pending' || pending.commit === null) return undefined;
  return pending.commit.toLowerCase() === view.on.toLowerCase() ? undefined : pending.commit;
}

/** Your review as the dialog plans it, from what main read as it opened. */
function reviewOf(view: DialogView): YourReview {
  const { pending } = view;
  switch (pending.kind) {
    case 'unknown':
    case 'loading':
      return YourReview.unknown('');
    case 'none':
      return new YourReview('');
    case 'pending':
      return new YourReview('', {
        id: pending.id,
        commit: pending.commit ?? undefined,
        comments: pending.comments,
      });
    default:
      pending satisfies never;
      return YourReview.unknown('');
  }
}

/**
 * Why `event` with the summary `body` can't go, as `@lo/review` plans it, before anything's sent:
 * nothing when it can.
 */
export function plannedRefusal(
  view: DialogView,
  event: ReviewEventRow,
  body: string,
): SubmitRefusal | undefined {
  const planned = reviewOf(view).submit(event, body, view.own, view.on, view.head);
  if (!('refusal' in planned)) return undefined;
  return refusalFrom(planned);
}

function refusalFrom(refusal: ReviewRefusal): SubmitRefusal {
  switch (refusal.refusal) {
    case 'otherRevision':
      return { kind: 'otherRevision', reviewOn: refusal.reviewOn ?? null };
    case 'nothingToSubmit':
      return { kind: 'nothingToSubmit' };
    case 'pendingUnknown':
      return { kind: 'pendingUnknown' };
    case 'ownPullRequest':
      return { kind: 'ownPullRequest' };
    case 'blank':
      return { kind: 'github', message: 'The review is blank.' };
    case 'notLatest':
      return { kind: 'github', message: 'The revision isn’t the latest.' };
    default:
      refusal satisfies never;
      return { kind: 'github', message: 'The review can’t be planned.' };
  }
}

/**
 * Why `refusal` keeps the review from going, as the dimmed control it's on says it, in a few words:
 * nothing for one that's a failure (`problemOf`) or that how submitting stands says already.
 */
export function reasonOf(
  refusal: SubmitRefusal,
  label: (head: string) => string,
  now = Date.now(),
): string | undefined {
  switch (refusal.kind) {
    case 'otherRevision':
      return refusal.reviewOn === null
        ? 'Its revision is no longer on GitHub'
        : `Your pending review is on ${label(refusal.reviewOn)}`;
    case 'nothingToSubmit':
      return 'Write a summary or a comment first';
    case 'ownPullRequest':
      return 'Authors can’t approve their own pull request';
    case 'paused':
      return refusal.until > now ? pausedReason(refusal.until) : undefined;
    case 'signIn':
      return SIGN_IN;
    case 'run':
      return IN_A_LAYER;
    case 'pendingUnknown':
    case 'busy':
    case 'github':
      return undefined;
    default:
      refusal satisfies never;
      return undefined;
  }
}

/** Why nothing goes while GitHub asked Lo to hold off writing, until `until`. */
export function pausedReason(until: number): string {
  return `GitHub’s rate limit resets at ${clockOf(until)}`;
}

/** What went wrong, as the line above the dialog's buttons says it. */
export interface Problem {
  readonly title: string;
  readonly reason?: string | undefined;
  /** What GitHub, or the error, said, behind Details. */
  readonly details?: string | undefined;
}

/** What failed when what the dialog shows couldn't be read. */
export const UNREAD = 'Couldn’t read the pending review';

/** What went wrong when GitHub refused the review, or Lo couldn't plan it, if `refusal` says so. */
export function problemOf(refusal: SubmitRefusal): Problem | undefined {
  if (refusal.kind === 'pendingUnknown') return { title: COULDNT, reason: NO_ANSWER };
  if (refusal.kind === 'github') {
    return { title: COULDNT, reason: GITHUB_FAILED, details: refusal.message };
  }
  return undefined;
}

/** What a review that may be on GitHub is titled, by the verdict it was sent with. */
export function notConfirmed(event: ReviewEventRow): string {
  return event === 'APPROVE' ? 'Approval not confirmed' : 'Review not confirmed';
}

/**
 * What the dialog's main button does: submit, look again for a review sent, read again what the
 * dialog shows, or close it.
 */
export type Does = 'submit' | 'check' | 'read' | 'close';

/**
 * Where the dialog has got to, from the moment it opens until the review is done: its state, its
 * main button, the button that leaves it, what went wrong, above the buttons, and the result, for
 * an approval, which the dialog stays open to show.
 */
export interface Step {
  readonly state: DialogState;
  readonly primary: {
    readonly label: string;
    /** What it says while it's at work. */
    readonly working: string;
    readonly busy: boolean;
    readonly does: Does;
    /** Why it can't be pressed now, which dims it. */
    readonly off: string | undefined;
  };
  readonly problem: Problem | undefined;
  /** What was done: "Approved #264". */
  readonly result: string | undefined;
}

/** What the dialog is worked out from: what it holds, and how submitting stands. */
export interface StepInput {
  /** What main read as the dialog opened, once it has. */
  readonly read: DialogView | undefined;
  /** The pull request's number. */
  readonly number: number;
  /** The verdict chosen. */
  readonly event: ReviewEventRow;
  /** The verdict sent last from this dialog, while its result isn't known. */
  readonly sent: ReviewEventRow | undefined;
  readonly text: string;
  /** Main is being asked to submit it. */
  readonly busy: boolean;
  /** The reader asked to look again for the review sent. */
  readonly checking: boolean;
  /** Why the last submit didn't go. */
  readonly refusal: SubmitRefusal | undefined;
  /** The verdict submitted, for a review the dialog stays open to show done. */
  readonly done: ReviewEventRow | undefined;
  /** How submitting stands, as main last said. */
  readonly state: Submitting | null;
  /** Why nothing can be sent now: offline, signed out, a pause, a file uploading. */
  readonly blocked: string | undefined;
  /** What went wrong reading what the dialog shows, if it couldn't be read. */
  readonly unread?: string | undefined;
}

const SUBMIT = 'Submit review';
const SUBMITTING = 'Submitting…';
const CHECK = 'Check again';
const CHECKING = 'Checking…';

/**
 * Where the dialog has got to, and what it shows for it. `label` names a revision by its head. Its
 * state is the foot's: `working` while the review is sent, when nothing leaves it; `failed` while
 * what went wrong, or what isn't known, shows above the foot, with what to do; `done` once an
 * approval is.
 */
export function stepOf(input: StepInput, label: (head: string) => string, now = Date.now()): Step {
  const { read, event, state } = input;
  const step = (
    at: DialogState,
    primary: Partial<Step['primary']> & { label: string; does: Does },
    rest: Partial<Omit<Step, 'state' | 'primary'>> = {},
  ): Step => ({
    state: at,
    primary: { working: SUBMITTING, busy: false, off: undefined, ...primary },
    problem: undefined,
    result: undefined,
    ...rest,
  });
  if (input.done !== undefined) {
    return step(
      'done',
      { label: 'Done', does: 'close' },
      { result: toastOf(input.done, input.number) },
    );
  }
  if (input.busy || state === 'sending') {
    return step('working', { label: SUBMIT, does: 'submit', busy: true });
  }
  const unconfirmed: Problem = { title: notConfirmed(input.sent ?? event), reason: NO_ANSWER };
  // Its answer lost, Lo looks for it, by itself or as the reader asked: "Not confirmed" stays above
  // the button, at work, until the look says. Only a read is at work, so the dialog can be left.
  if (state === 'checking' || (input.checking && state === 'unknown')) {
    return step(
      'failed',
      { label: CHECK, working: CHECKING, does: 'check', busy: true },
      { problem: unconfirmed },
    );
  }
  if (state === 'unknown') {
    return step(
      'failed',
      { label: CHECK, working: CHECKING, does: 'check' },
      { problem: unconfirmed },
    );
  }
  if (state === 'notSubmitted') {
    return step(
      'failed',
      { label: 'Try again', does: 'submit', off: input.blocked },
      { problem: { title: COULDNT, reason: NO_ANSWER } },
    );
  }
  const failed = input.refusal && problemOf(input.refusal);
  if (failed) {
    return step(
      'failed',
      { label: 'Try again', does: 'submit', off: input.blocked },
      { problem: failed },
    );
  }
  if (read === undefined && input.unread !== undefined) {
    return step(
      'failed',
      { label: 'Try again', does: 'read' },
      { problem: { title: UNREAD, details: input.unread } },
    );
  }
  const refused = input.refusal && reasonOf(input.refusal, label, now);
  // What `@lo/review` plans says why before anything's sent; a pending review that couldn't be read
  // says nothing here, since main reads it again as it's sent.
  const planned = read && plannedRefusal(read, event, input.text);
  const off =
    read === undefined
      ? READING
      : (input.blocked ?? refused ?? (planned && reasonOf(planned, label, now)));
  return step('ask', { label: SUBMIT, does: 'submit', off });
}

/** Until when GitHub asked Lo to hold off writing, as the dialog read it, if that's still to come. */
export function pausedUntil(view: DialogView, now: number): number | undefined {
  const until = view.pausedUntil;
  return until !== null && until > now ? until : undefined;
}

/** What the dialog hears of a key: its name, whether it's held, and its modifiers. */
export interface DialogKey {
  readonly key: string;
  readonly repeat: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * What the dialog does with a key, before what has focus hears it: `submit` for `⌘⏎` (`Ctrl+⏎` on
 * Linux); `drop` for a held `⏎` where it would confirm, `⌘⏎` anywhere or `⏎` outside the summary's
 * editor, so a held key submits nothing more; nothing for any other, a held `⏎` in the editor among
 * them, which goes on making lines.
 */
export function dialogKey(
  key: DialogKey,
  system: System,
  inEditor: boolean,
): 'submit' | 'drop' | undefined {
  if (key.key !== 'Enter') return undefined;
  const command = system === 'mac' ? key.metaKey : key.ctrlKey;
  const other = system === 'mac' ? key.ctrlKey : key.metaKey;
  const submits = command && !other && !key.altKey && !key.shiftKey;
  if (key.repeat) return submits || !inEditor ? 'drop' : undefined;
  return submits ? 'submit' : undefined;
}

/** Whether a review can't be sent now, as submitting stands: it's sent, or may be on GitHub. */
export function held(state: Submitting | null): boolean {
  return state === 'sending' || state === 'checking' || state === 'unknown';
}

/** What a review submitted did, as its toast, or an approval's dialog, says it: "Approved #4821". */
export function toastOf(event: ReviewEventRow | null, number: number): string {
  switch (event) {
    case 'APPROVE':
      return `Approved #${number}`;
    case 'COMMENT':
      return `Commented on #${number}`;
    case 'REQUEST_CHANGES':
      return `Requested changes on #${number}`;
    case null:
      return `Submitted review of #${number}`;
    default:
      event satisfies never;
      return `Submitted review of #${number}`;
  }
}

/**
 * The banner's words when your pending review sits on another revision than the one on screen,
 * `on`, and the revision "Show r3" shows, when GitHub still has it: none when it doesn't, or when
 * there's no pending review.
 */
export function otherRevisionOf(
  pending: PendingReviewRow | undefined,
  on: string | undefined,
  label: (head: string) => string,
): { key: string; title: string; show: string | undefined } | undefined {
  if (pending?.kind !== 'pending' || on === undefined) return undefined;
  const { commit } = pending;
  if (commit !== null && commit.toLowerCase() === on.toLowerCase()) return undefined;
  const key = `${pending.id}|${commit ?? ''}|${on.toLowerCase()}`;
  if (commit === null) {
    return { key, title: 'Your pending review’s revision is no longer on GitHub', show: undefined };
  }
  return { key, title: `Your pending review is on ${label(commit)}`, show: commit };
}
