// @vitest-environment jsdom
// Submitting from the dialog, as its main button and `⌘⏎` do: nothing goes while GitHub asks Lo to
// hold off, and once the pause is over, the review goes with its verdict and summary.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { DialogView } from '../contract.ts';
import { submit } from './actions.ts';
import { reviewStore } from './store.ts';

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => ({
    acting: { kind: 'account', login: 'rozed-bot' },
    connection: { kind: 'online' },
  }),
  runOf: () => undefined,
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

function open(view: DialogView): void {
  reviewStore.setState({
    dialog: {
      view: 'v0',
      number: 94,
      read: view,
      event: 'APPROVE',
      text: 'Ship it.',
      busy: false,
      refusal: undefined,
    },
  });
}

const sent = () =>
  bridge.calls.filter(([channel]) => channel === 'review.submit').map(([, input]) => input);

beforeEach(() => {
  vi.useFakeTimers();
  bridge.calls.length = 0;
  answers['review.submit'] = () => ({ kind: 'submitted', event: 'APPROVE' });
});

afterEach(() => {
  vi.useRealTimers();
  reviewStore.setState({ dialog: undefined });
});

test('while GitHub asks Lo to hold off, `⌘⏎` sends nothing, and once it’s over the review goes', async () => {
  vi.setSystemTime(1_000);
  open(read({ pausedUntil: 5_000 }));
  await submit();
  expect(sent()).toEqual([]);
  vi.setSystemTime(5_000);
  await submit();
  expect(sent()).toEqual([{ id: 'v0', event: 'APPROVE', body: 'Ship it.', anyway: false }]);
  // Submitted, the dialog closes.
  expect(reviewStore.getState().dialog).toBeUndefined();
});
