// @vitest-environment jsdom
// A comment box's frame: drawn in the parts the code view makes, at once, so the box is as tall as
// it'll be before it's on screen.

import type { Composer } from '@lo/ui/code';
import { afterEach, expect, test, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { DraftPlaceRow } from '../contract.ts';
import { Box } from './boxes.ts';
import { frameOf } from './Frame.tsx';

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({ keysOf: () => [], system: 'mac' }),
}));

/** What the window knows as the frame is drawn: who's signed in, and whether a review is pending. */
const said = vi.hoisted(() => ({ accounts: 1, pending: false }));
vi.mock('../../accounts/window/shared.ts', () => ({
  useAccounts: () => Array.from({ length: said.accounts }, (_, at) => ({ login: `account-${at}` })),
}));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  usePull: () => ({
    acting: { kind: 'account', login: 'tess-okafor' },
    connection: { kind: 'online' },
  }),
  useRun: () => undefined,
  useTabState: () => said.pending,
}));

/** A part of a box, empty. */
function part(): HTMLElement {
  return document.createElement('div');
}

test('the frame is drawn as the box is made, not after', () => {
  const box = new Box(
    'v1',
    {
      kind: 'thread',
      commit: 'a'.repeat(40),
      path: 'src/backoff.ts',
      lines: { start: null, end: { side: 'RIGHT', number: 5 } },
    },
    'review',
    'Kept',
  );
  box.set({ restored: Date.parse('2026-11-13T09:12:00') });
  const parts = {
    head: part(),
    note: part(),
    preview: part(),
    dropzone: part(),
    uploads: part(),
    foot: part(),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the frame reads none of it here.
  const frame = frameOf(box)(parts, {} as Composer);
  // What it's on is in the head, and that the draft was restored in the foot, over its buttons.
  expect(parts.head.textContent).toContain('Line 5');
  expect(parts.note.textContent).toBe('');
  expect(parts.foot.textContent).toMatch(/^Draft from .+Discard draftSend now.*Add to review/);
  frame.destroy();
});

afterEach(() => {
  said.accounts = 1;
  said.pending = false;
});

const ON_LINE: DraftPlaceRow = {
  kind: 'thread',
  commit: 'a'.repeat(40),
  path: 'src/backoff.ts',
  lines: { start: null, end: { side: 'RIGHT', number: 5 } },
};

/**
 * What a button is called. One that sends also holds what it says while it's working, out of sight
 * until then.
 */
function named(each: Element): string {
  return each.getAttribute('aria-label') ?? each.textContent.replace(/(Sending…|Saving…)$/, '');
}

/** The head and the foot of a box at `place`, holding "Kept", as its frame draws them. */
function drawn(place: DraftPlaceRow): {
  head: string;
  buttons: (string | null)[];
  leave: () => void;
} {
  const box = new Box('v1', place, 'review', 'Kept');
  const parts = {
    head: part(),
    note: part(),
    preview: part(),
    dropzone: part(),
    uploads: part(),
    foot: part(),
  };
  const leave = vi.fn<() => void>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the frame only closes it here.
  const frame = frameOf(box)(parts, { leave } as unknown as Composer);
  const read = {
    head: parts.head.textContent,
    buttons: [...parts.foot.querySelectorAll('button')].map(named),
    leave: () => {
      const close = [...parts.head.querySelectorAll('button')].find(
        (each) => named(each) === 'Close comment box',
      );
      close?.click();
      expect(leave).toHaveBeenCalledTimes(close ? 1 : 0);
    },
  };
  frame.destroy();
  return read;
}

test('every box has the same foot, with the buttons its comment can take', () => {
  // On a line, or a thread: into the review, or at once, the one `c` or `C` asked for last.
  expect(drawn(ON_LINE).buttons).toEqual([
    'Attach files…',
    'Discard draft',
    'Send now⌥⏎',
    'Add to review⌘⏎',
  ]);
  expect(drawn({ kind: 'reply', thread: 'T1' }).buttons.slice(2)).toEqual([
    'Send now⌥⏎',
    'Add to review⌘⏎',
  ]);
  // A comment on the pull request joins no review, and an edit is saved.
  expect(drawn({ kind: 'conversation' }).buttons.slice(2)).toEqual(['Send⌘⏎']);
  expect(drawn({ kind: 'edit', thread: 'T1', comment: 'C1' }).buttons.slice(2)).toEqual(['Save⌘⏎']);
});

test('while a review is pending, GitHub adds every comment to it, so the box only offers that', () => {
  said.pending = true;
  expect(drawn(ON_LINE).buttons.slice(2)).toEqual(['Add to review⌘⏎']);
  expect(drawn({ kind: 'conversation' }).buttons.slice(2)).toEqual(['Send⌘⏎']);
});

test('the head says what the comment is on, who it’s from only where that could be someone else', () => {
  expect(drawn(ON_LINE).head).toBe('Line 5WritePreview⌘⇧V');
  expect(drawn({ kind: 'reply', thread: 'T1' }).head).toBe('ReplyWritePreview⌘⇧V');
  said.accounts = 2;
  expect(drawn(ON_LINE).head).toContain('as tess-okafor');
});

test('a box closes from its head, but the pull request’s own, which is always there', () => {
  drawn(ON_LINE).leave();
  const own = drawn({ kind: 'conversation' });
  own.leave();
  expect(own.head).toBe('Pull requestWritePreview⌘⇧V');
});
