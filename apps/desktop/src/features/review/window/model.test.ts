import { expect, test } from 'vitest';

import type { DialogView } from '../contract.ts';
import {
  otherRevisionOf,
  plannedRefusal,
  refusalNote,
  subtitleOf,
  submittingNote,
  toastOf,
  verdictsOf,
} from './model.ts';

const R2 = '2'.repeat(40);
const R3 = '3'.repeat(40);

/** Revisions by their heads, as the comparison names them. */
const label = (head: string) => (head === R3 ? 'r3' : head === R2 ? 'r2' : head.slice(0, 7));

function dialog(overrides: Partial<DialogView> = {}): DialogView {
  return {
    login: 'rozed-bot',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 4821,
    own: false,
    on: R3,
    head: R3,
    pending: { kind: 'pending', id: 'PRR_1', commit: R3, comments: 3 },
    comments: [],
    summary: null,
    submitting: null,
    pausedUntil: null,
    ...overrides,
  };
}

test('every verdict is offered, but only Comment on your own pull request, which the subtitle says', () => {
  const theirs = dialog();
  expect(subtitleOf(theirs, label)).toBe('e2e #4821 · on r3, the revision on screen');
  expect(verdictsOf(theirs, label)).toEqual([
    {
      event: 'COMMENT',
      title: 'Comment',
      description: 'Sends your 3 pending comments without a verdict.',
    },
    { event: 'APPROVE', title: 'Approve', description: 'Approves the changes as they are on r3.' },
    {
      event: 'REQUEST_CHANGES',
      title: 'Request changes',
      description: 'Asks for changes to be made before it merges.',
    },
  ]);
  const mine = dialog({ own: true, pending: { kind: 'none' } });
  expect(subtitleOf(mine, label)).toBe('e2e #4821 · your PR, so GitHub takes comments only');
  expect(verdictsOf(mine, label)).toEqual([
    { event: 'COMMENT', title: 'Comment', description: 'Sends your summary without a verdict.' },
  ]);
});

test('a pending review on another revision goes only as a comment, offering Comment and to show it', () => {
  const view = dialog({ pending: { kind: 'pending', id: 'PRR_1', commit: R2, comments: 1 } });
  expect(plannedRefusal(view, 'COMMENT', '')).toBeUndefined();
  const refusal = plannedRefusal(view, 'APPROVE', 'Looks good');
  expect(refusal).toEqual({ kind: 'otherRevision', reviewOn: R2 });
  expect(refusalNote(refusal!, 'APPROVE', label)).toEqual({
    tone: 'warning',
    text: 'Your pending review is on r2. It can only go as a comment from here; show r2 to approve.',
    offers: [{ kind: 'comment' }, { kind: 'show', head: R2 }],
  });
  const gone = dialog({ pending: { kind: 'pending', id: 'PRR_1', commit: null, comments: 1 } });
  expect(
    refusalNote(plannedRefusal(gone, 'REQUEST_CHANGES', 'No')!, 'REQUEST_CHANGES', label),
  ).toMatchObject({ offers: [{ kind: 'comment' }] });
});

test('what can’t go is worded before it’s sent', () => {
  const empty = dialog({ pending: { kind: 'none' } });
  expect(plannedRefusal(empty, 'APPROVE', '')).toBeUndefined();
  const nothing = plannedRefusal(empty, 'REQUEST_CHANGES', '  ');
  expect(refusalNote(nothing!, 'REQUEST_CHANGES', label).text).toBe(
    'Write a summary to request changes: your review has no pending comments.',
  );
  const unknown = plannedRefusal(dialog({ pending: { kind: 'unknown' } }), 'COMMENT', 'Hi');
  expect(refusalNote(unknown!, 'COMMENT', label).text).toBe(
    'Lo couldn’t tell whether you have a pending review. Try again in a moment.',
  );
  const own = plannedRefusal(dialog({ own: true }), 'APPROVE', 'Mine');
  expect(refusalNote(own!, 'APPROVE', label)).toEqual({
    tone: 'warning',
    text: 'It’s your PR, so GitHub takes comments only.',
    offers: [{ kind: 'comment' }],
  });
  expect(refusalNote({ kind: 'signIn' }, 'COMMENT', label).text).toBe('Sign in to submit a review');
  expect(refusalNote({ kind: 'run' }, 'COMMENT', label).text).toBe('Submit a review in a layer');
  expect(
    refusalNote(
      { kind: 'github', message: 'It was submitted or deleted elsewhere since Lo last looked.' },
      'COMMENT',
      label,
    ),
  ).toMatchObject({ tone: 'danger' });
});

test('a lost answer says Lo is checking, and once it can’t tell, offers to submit anyway', () => {
  expect(submittingNote('sending')).toBeUndefined();
  expect(submittingNote('checking')?.text).toBe(
    'GitHub’s answer was lost. Lo is checking whether your review was submitted.',
  );
  expect(submittingNote('notSubmitted')?.text).toBe('It wasn’t submitted. Submit it again.');
  expect(submittingNote('unknown')?.offers).toEqual([{ kind: 'anyway' }]);
});

test('the toast names the verdict and the pull request', () => {
  expect(toastOf('APPROVE', 4821)).toBe('Approved #4821');
  expect(toastOf('COMMENT', 4821)).toBe('Commented on #4821');
  expect(toastOf('REQUEST_CHANGES', 4821)).toBe('Requested changes on #4821');
  expect(toastOf(null, 4821)).toBe('Submitted your review of #4821');
});

test('the banner shows while your pending review is on another revision than the one on screen', () => {
  const pending = { kind: 'pending' as const, id: 'PRR_1', commit: R2, comments: 1 };
  expect(otherRevisionOf(pending, R3, label)).toEqual({
    key: `PRR_1|${R2}|${R3}`,
    title: 'Your pending review is on r2, not r3.',
    detail: 'It can only go as a comment from here; show r2 to approve or request changes.',
    show: R2,
  });
  expect(otherRevisionOf(pending, R2.toUpperCase(), label)).toBeUndefined();
  expect(otherRevisionOf({ kind: 'none' }, R3, label)).toBeUndefined();
  expect(otherRevisionOf({ ...pending, commit: null }, R3, label)).toMatchObject({
    show: undefined,
  });
});
