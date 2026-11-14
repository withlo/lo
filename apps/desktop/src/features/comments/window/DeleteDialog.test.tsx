// @vitest-environment jsdom
// The question before your comment is deleted: its first line, whether it leaves your pending
// review, and whether its thread goes with it.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import type { DeleteAsking } from './acts.ts';
import { DeleteDialog } from './DeleteDialog.tsx';

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({ keysOf: () => [], system: 'mac' }),
}));

const asked = vi.hoisted(() => ({ now: undefined as DeleteAsking | undefined }));
vi.mock('./acts.ts', () => ({
  deleteAsking: () => asked.now,
  subscribeAsking: () => () => {},
  cancelDelete: () => {},
  confirmDelete: () => Promise.resolve(),
}));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** Draws the question about a comment that says `body`. */
function render(body: string, changes: Partial<DeleteAsking> = {}): HTMLElement {
  asked.now = {
    tab: { kind: 'pull', id: 'v0', owner: 'rozed-dev', repo: 'e2e', number: 94 },
    thread: 'T1',
    comment: 'C1',
    body,
    pending: false,
    onlyComment: false,
    ...changes,
  };
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  act(() => root.render(<DeleteDialog />));
  return document.querySelector<HTMLElement>('[data-testid="delete-comment"]')!;
}

test('shows the comment’s first line, not the rest of it', () => {
  const dialog = render(
    '\nFixture C: Start a little higher?\n\n```suggestion\nconst FIRST = 500;\n```',
  );
  expect(dialog.textContent).toContain('Delete your comment?');
  expect(dialog.textContent).toContain('Fixture C: Start a little higher?');
  expect(dialog.textContent).not.toContain('suggestion');
  expect(dialog.textContent).not.toContain('FIRST');
});

test('says a pending comment leaves your review, and a thread’s only comment takes it too', () => {
  const dialog = render('Mine.', { pending: true, onlyComment: true });
  expect(dialog.textContent).toContain('It leaves your pending review.');
  expect(dialog.textContent).toContain('It’s the thread’s only comment, so the thread goes too.');
});

test('cuts a long first line short', () => {
  expect(render('x'.repeat(200)).textContent).toContain(`${'x'.repeat(119)}…`);
});
