// @vitest-environment jsdom
// Submitting from the dialog, as its main button and `⌘⏎` do: nothing goes while GitHub asks Lo to
// hold off, and once the pause is over, the review goes with its verdict and summary, and the
// summary's files with it. An approval ends in the dialog, done, with no toast; any other review
// closes it, and a toast says what it did. Once Lo can't tell whether a review whose answer was lost
// was submitted, "Check again" only looks.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { notices } from '../../../window/commands/notices.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type * as CommentsShared from '../../comments/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { DialogView, ReviewEventRow } from '../contract.ts';
import { checkAgain, heard, stepNow, submit, summaryBox } from './actions.ts';
import { reviewStore, submitting } from './store.ts';

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => ({
    acting: { kind: 'account', login: 'rozed-bot' },
    connection: { kind: 'online' },
  }),
  runOf: () => undefined,
}));

const ended = vi.hoisted(() => [] as unknown[]);
vi.mock('../../comments/window/shared.ts', async (original) => ({
  ...(await original<typeof CommentsShared>()),
  endUploads: (box: unknown) => ended.push(box),
}));

const HEAD = 'a'.repeat(40);
const answers: Record<string, (input: unknown) => unknown> = {};
const bridge = installBridge(answers);

/** What main read for the dialog on view `v0`: no pending review, on the latest head. */
function read(overrides: Partial<DialogView> = {}): DialogView {
  return {
    login: 'rozed-bot',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 94,
    own: false,
    on: HEAD,
    head: HEAD,
    pending: { kind: 'none' },
    comments: [],
    summary: null,
    submitting: null,
    pausedUntil: null,
    ...overrides,
  };
}

function open(view: DialogView, event: ReviewEventRow = 'APPROVE'): void {
  reviewStore.setState({
    dialog: {
      view: 'v0',
      number: 94,
      read: view,
      event,
      text: 'Ship it.',
      busy: false,
      refusal: undefined,
    },
  });
}

/** The toasts showing, by their words. */
const toasts = () => notices().map((note) => note.title);

const sent = () =>
  bridge.calls.filter(([channel]) => channel === 'review.submit').map(([, input]) => input);

beforeEach(() => {
  vi.useFakeTimers();
  bridge.calls.length = 0;
  ended.length = 0;
  answers['review.submit'] = () => ({ kind: 'submitted', event: 'APPROVE' });
  answers['review.check'] = () => undefined;
});

afterEach(() => {
  vi.useRealTimers();
  reviewStore.setState({ dialog: undefined });
  submitting.set('v0', null);
});

test('while GitHub asks Lo to hold off, `⌘⏎` sends nothing, and once it’s over the review goes', async () => {
  vi.setSystemTime(1_000);
  open(read({ pausedUntil: 5_000 }));
  await submit();
  expect(sent()).toEqual([]);
  vi.setSystemTime(5_000);
  await submit();
  expect(sent()).toEqual([{ id: 'v0', event: 'APPROVE', body: 'Ship it.' }]);
  // Approved, the dialog stays to show it's done.
  expect(stepNow()).toMatchObject({ state: 'done', result: 'Approved #94' });
});

test('once the review is submitted, the files attached to its summary go with it', async () => {
  open(read());
  await submit();
  expect(ended).toEqual([summaryBox('v0')]);
  // As when main says it was submitted from another view of the pull request.
  heard({
    id: 'v1',
    repo: 'rozed-dev/e2e',
    number: 94,
    state: null,
    submitted: { event: 'APPROVE' },
  });
  expect(ended).toEqual([summaryBox('v0'), summaryBox('v1')]);
});

test('an approval ends in the dialog with no toast, and any other review closes it with one', async () => {
  vi.setSystemTime(10_000);
  open(read());
  await submit();
  heard({
    id: 'v0',
    repo: 'rozed-dev/e2e',
    number: 94,
    state: null,
    submitted: { event: 'APPROVE' },
  });
  expect(stepNow()?.state).toBe('done');
  expect(toasts()).not.toContain('Approved #94');
  reviewStore.setState({ dialog: undefined });
  answers['review.submit'] = () => ({ kind: 'submitted', event: 'COMMENT' });
  open(read(), 'COMMENT');
  await submit();
  expect(reviewStore.getState().dialog).toBeUndefined();
  heard({
    id: 'v0',
    repo: 'rozed-dev/e2e',
    number: 94,
    state: null,
    submitted: { event: 'COMMENT' },
  });
  expect(toasts()).toContain('Commented on #94');
});

test('an approval of a pull request with the same number in another repository leaves this one’s dialog be', async () => {
  open(read());
  await submit();
  expect(stepNow()?.state).toBe('done');
  heard({
    id: 'v2',
    repo: 'rozed-dev/other',
    number: 94,
    state: null,
    submitted: { event: 'APPROVE' },
  });
  expect(toasts()).toContain('Approved #94');
});

test('an approval found once the dialog was closed says so in a toast', () => {
  heard({
    id: 'v0',
    repo: 'rozed-dev/e2e',
    number: 94,
    state: null,
    submitted: { event: 'APPROVE' },
  });
  expect(toasts()).toContain('Approved #94');
});

test('once Lo can’t tell whether it went, nothing is sent again, and "Check again" only looks', async () => {
  open(read(), 'COMMENT');
  heard({ id: 'v0', repo: 'rozed-dev/e2e', number: 94, state: 'unknown', submitted: null });
  expect(stepNow()).toMatchObject({
    state: 'failed',
    primary: { label: 'Check again', does: 'check' },
    problem: { title: 'Review not confirmed' },
  });
  await submit();
  expect(sent()).toEqual([]);
  checkAgain();
  expect(bridge.calls.filter(([channel]) => channel === 'review.check')).toEqual([
    ['review.check', { id: 'v0' }],
  ]);
  expect(stepNow()?.primary).toMatchObject({ busy: true, working: 'Checking…' });
  heard({ id: 'v0', repo: 'rozed-dev/e2e', number: 94, state: 'checking', submitted: null });
  expect(stepNow()?.primary).toMatchObject({ busy: true, working: 'Checking…' });
  // It's only looking: the dialog can be left meanwhile.
  expect(stepNow()?.state).toBe('failed');
  // Not found: now it can go again.
  heard({ id: 'v0', repo: 'rozed-dev/e2e', number: 94, state: 'notSubmitted', submitted: null });
  expect(stepNow()).toMatchObject({
    state: 'failed',
    primary: { label: 'Try again', does: 'submit', busy: false },
  });
  expect(sent()).toEqual([]);
});
