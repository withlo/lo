import { expect, test } from 'vitest';

import { clockOf } from '../../../window/time.ts';
import type { DialogView } from '../contract.ts';
import {
  agoOf,
  dialogKey,
  otherRevisionOf,
  pausedUntil,
  pendingDetail,
  showFor,
  stepOf,
  subtitleOf,
  toastOf,
  verdictsOf,
  type StepInput,
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

/** The dialog as it asks, with a summary typed, unless it says otherwise. */
function input(overrides: Partial<StepInput> = {}): StepInput {
  return {
    read: dialog(),
    number: 4821,
    event: 'COMMENT',
    sent: undefined,
    text: 'Reads well.',
    busy: false,
    checking: false,
    refusal: undefined,
    done: undefined,
    state: null,
    blocked: undefined,
    ...overrides,
  };
}

test('every verdict is offered, and on your own pull request Approve and Request changes say why they can’t be chosen', () => {
  const theirs = dialog();
  expect(subtitleOf(theirs, label)).toBe('e2e #4821 · r3');
  expect(verdictsOf(theirs, label)).toEqual([
    {
      event: 'COMMENT',
      title: 'Comment',
      description: 'Feedback without a verdict.',
      off: undefined,
    },
    {
      event: 'APPROVE',
      title: 'Approve',
      description: 'Approves the changes at r3.',
      off: undefined,
    },
    {
      event: 'REQUEST_CHANGES',
      title: 'Request changes',
      description: 'Asks for changes before it merges.',
      off: undefined,
    },
  ]);
  const mine = dialog({ own: true, pending: { kind: 'none' } });
  expect(subtitleOf(mine, label)).toBe('e2e #4821 · r3');
  const own = 'Authors can’t approve their own pull request';
  expect(verdictsOf(mine, label).map(({ event, off }) => [event, off])).toEqual([
    ['COMMENT', undefined],
    ['APPROVE', own],
    ['REQUEST_CHANGES', 'Its author can’t request changes'],
  ]);
  expect(verdictsOf(mine, label)[1]?.description).toBe(own);
  expect(verdictsOf(mine, label)[2]?.description).toBe('Its author can’t request changes');
});

test('a pending review on another revision dims Approve and Request changes, with "Show r2" while GitHub has it', () => {
  const view = dialog({ pending: { kind: 'pending', id: 'PRR_1', commit: R2, comments: 1 } });
  expect(verdictsOf(view, label).map(({ off }) => off)).toEqual([
    undefined,
    'Your pending review is on r2',
    'Your pending review is on r2',
  ]);
  expect(showFor(view)).toBe(R2);
  const gone = dialog({ pending: { kind: 'pending', id: 'PRR_1', commit: null, comments: 1 } });
  expect(verdictsOf(gone, label)[1]?.off).toBe('Its revision is no longer on GitHub');
  expect(showFor(gone)).toBeUndefined();
  expect(showFor(dialog())).toBeUndefined();
});

test('the dialog asks with "Submit review", dimmed with why while what can’t go is known', () => {
  expect(stepOf(input(), label)).toEqual({
    state: 'ask',
    primary: {
      label: 'Submit review',
      working: 'Submitting…',
      busy: false,
      does: 'submit',
      off: undefined,
    },
    problem: undefined,
    result: undefined,
  });
  expect(stepOf(input({ read: undefined }), label).primary.off).toBe('Reading pending review…');
  const empty = dialog({ pending: { kind: 'none' } });
  expect(stepOf(input({ read: empty, text: '  ' }), label).primary.off).toBe(
    'Write a summary or a comment first',
  );
  // An approval needs no summary.
  expect(
    stepOf(input({ read: empty, text: '', event: 'APPROVE' }), label).primary.off,
  ).toBeUndefined();
  expect(stepOf(input({ blocked: 'Offline' }), label).primary.off).toBe('Offline');
  expect(stepOf(input({ refusal: { kind: 'signIn' } }), label).primary.off).toBe(
    'Sign in to submit a review',
  );
  expect(stepOf(input({ refusal: { kind: 'run' } }), label).primary.off).toBe(
    'Show a single layer to submit a review',
  );
  expect(
    stepOf(input({ refusal: { kind: 'paused', until: 5_000 } }), label, 1_000).primary.off,
  ).toBe(`GitHub’s rate limit resets at ${clockOf(5_000)}`);
  expect(
    stepOf(input({ refusal: { kind: 'paused', until: 5_000 } }), label, 5_000).primary.off,
  ).toBeUndefined();
  // Whether there's a pending review is main's to read again as it's sent.
  expect(
    stepOf(input({ read: dialog({ pending: { kind: 'unknown' } }) }), label).primary.off,
  ).toBeUndefined();
});

test('it says "Submitting…" while it goes, and nothing leaves it until GitHub answers', () => {
  for (const each of [input({ busy: true }), input({ state: 'sending' })]) {
    expect(stepOf(each, label)).toMatchObject({
      state: 'working',
      primary: { label: 'Submit review', working: 'Submitting…', busy: true },
      problem: undefined,
    });
  }
});

test('what the dialog shows that couldn’t be read says so, with "Try again", which reads it again', () => {
  expect(stepOf(input({ read: undefined, unread: 'GitHub returned 502' }), label)).toMatchObject({
    state: 'failed',
    primary: { label: 'Try again', does: 'read', busy: false },
    problem: { title: 'Couldn’t read the pending review', details: 'GitHub returned 502' },
  });
});

test('what went wrong shows above the buttons, with "Try again"', () => {
  expect(
    stepOf(input({ refusal: { kind: 'github', message: 'Can not approve your own PR' } }), label),
  ).toMatchObject({
    state: 'failed',
    primary: { label: 'Try again', does: 'submit', busy: false },
    problem: {
      title: 'Couldn’t submit the review',
      reason: 'GitHub returned an error.',
      details: 'Can not approve your own PR',
    },
  });
  expect(stepOf(input({ refusal: { kind: 'pendingUnknown' } }), label)).toMatchObject({
    state: 'failed',
    problem: { title: 'Couldn’t submit the review', reason: 'GitHub didn’t respond.' },
  });
  // Found not to have gone, it can go again.
  expect(stepOf(input({ state: 'notSubmitted', sent: 'COMMENT' }), label)).toMatchObject({
    state: 'failed',
    primary: { label: 'Try again', does: 'submit' },
    problem: { title: 'Couldn’t submit the review', reason: 'GitHub didn’t respond.' },
  });
});

test('a lost answer is "not confirmed" at once, looked for with "Checking…", and the dialog can be left', () => {
  expect(stepOf(input({ state: 'checking', sent: 'COMMENT' }), label)).toMatchObject({
    state: 'failed',
    primary: { label: 'Check again', working: 'Checking…', busy: true, does: 'check' },
    problem: { title: 'Review not confirmed', reason: 'GitHub didn’t respond.' },
  });
  const unknown = stepOf(input({ state: 'unknown', sent: 'COMMENT' }), label);
  expect(unknown).toMatchObject({
    state: 'failed',
    primary: { label: 'Check again', working: 'Checking…', does: 'check', busy: false },
    problem: { title: 'Review not confirmed', reason: 'GitHub didn’t respond.' },
  });
  // Named by what was sent, whichever verdict is chosen now.
  expect(
    stepOf(input({ state: 'unknown', sent: 'APPROVE', event: 'COMMENT' }), label).problem?.title,
  ).toBe('Approval not confirmed');
  // Asked for, the look keeps what it's about above the button, which works until it says.
  for (const state of ['unknown', 'checking'] as const) {
    expect(stepOf(input({ state, sent: 'APPROVE', checking: true }), label)).toMatchObject({
      state: 'failed',
      primary: { label: 'Check again', working: 'Checking…', busy: true, does: 'check' },
      problem: { title: 'Approval not confirmed' },
    });
  }
});

test('an approval ends done, with what it did and "Done"', () => {
  expect(stepOf(input({ done: 'APPROVE', state: null }), label)).toEqual({
    state: 'done',
    primary: { label: 'Done', working: 'Submitting…', busy: false, does: 'close', off: undefined },
    problem: undefined,
    result: 'Approved #4821',
  });
});

test('the result names the verdict and the pull request', () => {
  expect(toastOf('APPROVE', 4821)).toBe('Approved #4821');
  expect(toastOf('COMMENT', 4821)).toBe('Commented on #4821');
  expect(toastOf('REQUEST_CHANGES', 4821)).toBe('Requested changes on #4821');
  expect(toastOf(null, 4821)).toBe('Submitted review of #4821');
});

test('the banner shows while your pending review is on another revision than the one on screen', () => {
  const pending = { kind: 'pending' as const, id: 'PRR_1', commit: R2, comments: 1 };
  expect(otherRevisionOf(pending, R3, label)).toEqual({
    key: `PRR_1|${R2}|${R3}`,
    title: 'Your pending review is on r2',
    show: R2,
  });
  expect(otherRevisionOf(pending, R2.toUpperCase(), label)).toBeUndefined();
  expect(otherRevisionOf({ kind: 'none' }, R3, label)).toBeUndefined();
  expect(otherRevisionOf({ ...pending, commit: null }, R3, label)).toEqual({
    key: `PRR_1||${R3}`,
    title: 'Your pending review’s revision is no longer on GitHub',
    show: undefined,
  });
});

test('a summary kept from before says how long ago, in its largest whole unit', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  expect(agoOf(now - 30_000, now)).toBe('just now');
  expect(agoOf(now - 12 * 60_000 - 59_000, now)).toBe('12 min ago');
  expect(agoOf(now - 2 * 3_600_000 - 50 * 60_000, now)).toBe('2 h ago');
  expect(agoOf(now - 3 * 86_400_000, now)).toBe('3 d ago');
  expect(agoOf(Date.parse('2026-09-12T12:00:00Z'), now)).toBe('Sep 12');
  expect(agoOf(Date.parse('2025-09-12T12:00:00Z'), now)).toBe('Sep 12, 2025');
});

test('while GitHub asks Lo to hold off, nothing is submitted until the time it gave', () => {
  expect(pausedUntil(dialog({ pausedUntil: 2_000 }), 1_000)).toBe(2_000);
  expect(pausedUntil(dialog({ pausedUntil: 2_000 }), 2_000)).toBeUndefined();
  expect(pausedUntil(dialog(), 1_000)).toBeUndefined();
});

test('`⌘⏎` submits from anywhere in the dialog, and a held key submits nothing more, but makes lines in the summary', () => {
  const enter = {
    key: 'Enter',
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };
  const command = { ...enter, metaKey: true };
  expect(dialogKey(command, 'mac', true)).toBe('submit');
  expect(dialogKey(command, 'mac', false)).toBe('submit');
  expect(dialogKey({ ...enter, ctrlKey: true }, 'linux', true)).toBe('submit');
  expect(dialogKey({ ...enter, ctrlKey: true }, 'mac', true)).toBeUndefined();
  expect(dialogKey({ ...command, shiftKey: true }, 'mac', true)).toBeUndefined();
  // Held: `⌘⏎` anywhere, and `⏎` where it would press a button, do nothing more.
  expect(dialogKey({ ...command, repeat: true }, 'mac', true)).toBe('drop');
  expect(dialogKey({ ...enter, repeat: true }, 'mac', false)).toBe('drop');
  // In the summary, `⏎` makes lines, held or not.
  expect(dialogKey(enter, 'mac', true)).toBeUndefined();
  expect(dialogKey({ ...enter, repeat: true }, 'mac', true)).toBeUndefined();
  expect(dialogKey({ ...enter, key: 'a' }, 'mac', true)).toBeUndefined();
});

test('the palette says how many comments your pending review holds, if any', () => {
  expect(pendingDetail({ kind: 'pending', id: 'PRR_1', commit: R3, comments: 3 })).toBe(
    '3 pending',
  );
  expect(pendingDetail({ kind: 'pending', id: 'PRR_1', commit: R3, comments: 0 })).toBeUndefined();
  expect(pendingDetail({ kind: 'none' })).toBeUndefined();
  expect(pendingDetail(undefined)).toBeUndefined();
});
