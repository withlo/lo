// @vitest-environment jsdom
// The submit dialog: Comment, Approve and Request changes on someone else's pull request, and on
// your own, Approve and Request changes dimmed with why; "Submit review" for every verdict; and an
// approval's end, with what it did and "Done".

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { DialogView, ReviewEventRow } from '../contract.ts';
import feature from './index.ts';
import { reviewStore } from './store.ts';
import { SubmitDialog } from './SubmitDialog.tsx';

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => ({
    acting: { kind: 'account', login: 'rozed-bot' },
    connection: { kind: 'online' },
  }),
  runOf: () => undefined,
}));

// The summary's editor is the comment box's, tested with it.
vi.mock('./Summary.tsx', () => ({ Summary: () => null }));

const HEAD = 'a'.repeat(40);

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
  installBridge();
});

afterEach(() => {
  act(() => reviewStore.setState({ dialog: undefined }));
});

/** Draws the dialog as main read it for a pull request `own` or not, done with `done` if given. */
function render(own: boolean, done?: ReviewEventRow): void {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  const read: DialogView = {
    login: 'rozed-bot',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 94,
    own,
    on: HEAD,
    head: HEAD,
    pending: { kind: 'pending', id: 'PRR_1', commit: HEAD, comments: 2 },
    comments: [],
    summary: null,
    submitting: null,
    pausedUntil: null,
  };
  act(() => {
    reviewStore.setState({
      dialog: {
        view: 'v0',
        number: 94,
        read,
        event: 'COMMENT',
        text: '',
        busy: false,
        refusal: undefined,
        done,
      },
    });
    root.render(<SubmitDialog />);
  });
}

const dialog = () => document.querySelector<HTMLElement>('[data-testid="submit-review"]');
const verdicts = () =>
  [...(dialog()?.querySelectorAll('[role="radio"]') ?? [])].map(
    (radio) => radio.textContent.match(/^(Comment|Approve|Request changes)/)?.[0],
  );

const dimmed = () =>
  [...(dialog()?.querySelectorAll('[role="radio"][aria-disabled="true"]') ?? [])].map(
    (radio) => radio.textContent,
  );
/** The dialog's buttons, by what a screen reader hears of them: not what's hidden, as their keys. */
const buttons = () =>
  [...(dialog()?.querySelectorAll('button:not([role])') ?? [])].map((button) => {
    const heard = button.cloneNode(true);
    if (!(heard instanceof HTMLElement)) return '';
    for (const hidden of heard.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return heard.textContent.trim();
  });

test('someone else’s pull request offers every verdict, and the dialog submits whichever', () => {
  render(false);
  expect(verdicts()).toEqual(['Comment', 'Approve', 'Request changes']);
  expect(dimmed()).toEqual([]);
  expect(dialog()?.querySelector('h2')?.textContent).toBe('Submit review');
  expect(dialog()?.textContent).toContain('e2e #94 · aaaaaaa');
  expect(dialog()?.textContent).toContain('2 pending comments');
  expect(buttons()).toEqual(['Cancel', 'Submit review']);
});

test('on your own pull request, Approve and Request changes are dimmed with why', () => {
  render(true);
  expect(verdicts()).toEqual(['Comment', 'Approve', 'Request changes']);
  expect(dimmed()).toEqual([
    'ApproveAuthors can’t approve their own pull request',
    'Request changesIts author can’t request changes',
  ]);
});

test('an approval ends with what it did, and "Done" alone', () => {
  render(false, 'APPROVE');
  expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe('Approved #94');
  expect(buttons()).toEqual(['Done']);
});
