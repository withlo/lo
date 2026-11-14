// What the submit dialog, the status bar's item and the banner say, worked out from what main sent:
// the verdicts and their lines, why a review can't go before it's sent, how sending stands, and the
// toast once it's done. Pure functions, so they're tested without a window.

import { reviewChoices, YourReview, type ReviewRefusal } from '@lo/review';
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

/** Why submitting is off while GitHub can't be reached. */
export const OFFLINE = 'Offline. Lo keeps your summary as a draft until you submit it.';

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
  const pull = `${view.repo} #${view.number}`;
  if (view.own) return `${pull} · your PR, so GitHub takes comments only`;
  return `${pull} · on ${label(view.on)}, the revision on screen`;
}

/** The comments your pending review holds, as the dialog counts them. */
export function pendingCount(pending: PendingReviewRow): number {
  return pending.kind === 'pending' ? pending.comments : 0;
}

/** What the palette says after "Submit review" of your pending review: "3 pending", or nothing. */
export function pendingDetail(pending: PendingReviewRow | undefined): string | undefined {
  const count = pending ? pendingCount(pending) : 0;
  return count > 0 ? `${count} pending` : undefined;
}

/** A verdict's name, as its choice and the dialog's main button say it. */
export const verdictNames: Readonly<Record<ReviewEventRow, string>> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

/** A verdict as a sentence's verb says it: "to approve". */
const verbs: Readonly<Record<ReviewEventRow, string>> = {
  COMMENT: 'comment',
  APPROVE: 'approve',
  REQUEST_CHANGES: 'request changes',
};

/** A verdict the dialog offers, with the line that explains it. */
export interface Verdict {
  readonly event: ReviewEventRow;
  readonly title: string;
  readonly description: string;
}

/**
 * The verdicts the dialog offers, in `@lo/review`'s order: only Comment on your own pull request,
 * since GitHub takes nothing else from its author.
 */
export function verdictsOf(view: DialogView, label: (head: string) => string): Verdict[] {
  const count = pendingCount(view.pending);
  const lines: Readonly<Record<ReviewEventRow, string>> = {
    COMMENT:
      count > 0
        ? `Sends your ${counted(count, 'pending comment')} without a verdict.`
        : 'Sends your summary without a verdict.',
    APPROVE: `Approves the changes as they are on ${label(view.on)}.`,
    REQUEST_CHANGES: 'Asks for changes to be made before it merges.',
  };
  return reviewChoices(view.own).map((event) => ({
    event,
    title: verdictNames[event],
    description: lines[event],
  }));
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
    case 'notLatest':
      return { kind: 'github', message: 'Lo can’t submit that.' };
    default:
      refusal satisfies never;
      return { kind: 'github', message: 'Lo can’t submit that.' };
  }
}

/** What a note offers to do: choose Comment, show the pending review's revision, or send anyway. */
export type Offer = { kind: 'comment' } | { kind: 'show'; head: string } | { kind: 'anyway' };

/** A note in the dialog, before it's drawn. */
export interface Note {
  readonly tone: 'info' | 'warning' | 'danger';
  readonly text: string;
  readonly offers: readonly Offer[];
}

/**
 * What the dialog says of why `event` wasn't, or can't be, submitted, and what it offers to do.
 * `label` names a revision by its head.
 */
export function refusalNote(
  refusal: SubmitRefusal,
  event: ReviewEventRow,
  label: (head: string) => string,
): Note {
  const note = (text: string, offers: readonly Offer[] = [], tone: Note['tone'] = 'warning') => ({
    tone,
    text,
    offers,
  });
  switch (refusal.kind) {
    case 'otherRevision': {
      const on = refusal.reviewOn;
      if (on === null) {
        return note(
          'Your pending review is on a revision GitHub no longer has, so it can only go as a comment.',
          [{ kind: 'comment' }],
        );
      }
      const revision = label(on);
      return note(
        `Your pending review is on ${revision}. It can only go as a comment from here; show ${revision} to ${verbs[event]}.`,
        [{ kind: 'comment' }, { kind: 'show', head: on }],
      );
    }
    case 'nothingToSubmit':
      return note(
        `Write a summary to ${verbs[event]}: your review has no pending comments.`,
        [],
        'info',
      );
    case 'pendingUnknown':
      return note('Lo couldn’t tell whether you have a pending review. Try again in a moment.');
    case 'ownPullRequest':
      return note('It’s your PR, so GitHub takes comments only.', [{ kind: 'comment' }]);
    case 'paused':
      return note(`GitHub asked Lo to hold off until ${clockOf(refusal.until)}. Submit it then.`);
    case 'busy':
      return submittingNote(refusal.why) ?? note('It’s being submitted already.', [], 'info');
    case 'signIn':
      return note(SIGN_IN);
    case 'run':
      return note(IN_A_LAYER);
    case 'github':
      return note(refusal.message, [], 'danger');
    default:
      refusal satisfies never;
      return note('GitHub didn’t take it.', [], 'danger');
  }
}

/** What the dialog says of how submitting stands, if anything. */
export function submittingNote(state: Submitting | null): Note | undefined {
  switch (state) {
    case null:
    case 'sending':
      return undefined;
    case 'checking':
      return {
        tone: 'info',
        text: 'GitHub’s answer was lost. Lo is checking whether your review was submitted.',
        offers: [],
      };
    case 'notSubmitted':
      return { tone: 'warning', text: 'It wasn’t submitted. Submit it again.', offers: [] };
    case 'unknown':
      return {
        tone: 'warning',
        text: 'Lo can’t tell whether your review was submitted. Check on GitHub, or submit it anyway.',
        offers: [{ kind: 'anyway' }],
      };
    default:
      state satisfies never;
      return undefined;
  }
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

/** The toast once a review is submitted: "Approved #4821". */
export function toastOf(event: ReviewEventRow | null, number: number): string {
  switch (event) {
    case 'APPROVE':
      return `Approved #${number}`;
    case 'COMMENT':
      return `Commented on #${number}`;
    case 'REQUEST_CHANGES':
      return `Requested changes on #${number}`;
    case null:
      return `Submitted your review of #${number}`;
    default:
      event satisfies never;
      return `Submitted your review of #${number}`;
  }
}

/**
 * The banner's words when your pending review sits on another revision than the one on screen,
 * `on`: none when it doesn't, or when there's no pending review.
 */
export function otherRevisionOf(
  pending: PendingReviewRow | undefined,
  on: string | undefined,
  label: (head: string) => string,
): { key: string; title: string; detail: string; show: string | undefined } | undefined {
  if (pending?.kind !== 'pending' || on === undefined) return undefined;
  const { commit } = pending;
  if (commit !== null && commit.toLowerCase() === on.toLowerCase()) return undefined;
  const key = `${pending.id}|${commit ?? ''}|${on.toLowerCase()}`;
  if (commit === null) {
    return {
      key,
      title: 'Your pending review is on a revision GitHub no longer has.',
      detail: 'It can only go as a comment.',
      show: undefined,
    };
  }
  return {
    key,
    title: `Your pending review is on ${label(commit)}, not ${label(on)}.`,
    detail: `It can only go as a comment from here; show ${label(commit)} to approve or request changes.`,
    show: commit,
  };
}
