// @vitest-environment jsdom
// The submit dialog's verdicts: Comment, Approve and Request changes on someone else's pull
// request, and Comment only on your own, which its subtitle says.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { DialogView } from '../contract.ts';
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

/** Draws the dialog as main read it for a pull request `own` or not. */
function render(own: boolean): void {
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

test('someone else’s pull request offers every verdict', () => {
  render(false);
  expect(verdicts()).toEqual(['Comment', 'Approve', 'Request changes']);
  expect(dialog()?.textContent).toContain('e2e #94 · on');
});

test('your own pull request offers only Comment, and says why', () => {
  render(true);
  expect(verdicts()).toEqual(['Comment']);
  expect(dialog()?.textContent).toContain('your PR, so GitHub takes comments only');
});
