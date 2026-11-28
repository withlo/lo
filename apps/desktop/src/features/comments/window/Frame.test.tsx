// @vitest-environment jsdom
// A comment box's frame: drawn in the parts the code view makes, at once, so the box is as tall as
// it'll be before it's on screen.

import type { Composer } from '@lo/ui/code';
import { afterEach, expect, test, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { DraftPlaceRow } from '../contract.ts';
import { Box } from './boxes.ts';
import { frameOf } from './Frame.tsx';
import { wroteHere } from './store.ts';

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({ keysOf: () => [], system: 'mac' }),
}));

/** What the window knows as the frame is drawn: who's signed in, and whether a review is pending. */
const said = vi.hoisted(() => ({
  accounts: 1,
  pending: false,
  threads: 'between' as 'beside' | 'between',
}));
vi.mock('../../accounts/window/shared.ts', () => ({
  useAccounts: () => Array.from({ length: said.accounts }, (_, at) => ({ login: `account-${at}` })),
}));
vi.mock('./mode.ts', () => ({ threadsMode: () => said.threads }));
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
    sent: part(),
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
  said.threads = 'between';
});

test('a box sending its comment notes its text, so the comment’s card shows it until GitHub’s rendering is in', async () => {
  const box = new Box(
    'v9',
    {
      kind: 'thread',
      commit: 'a'.repeat(40),
      path: 'src/backoff.ts',
      lines: { start: null, end: { side: 'RIGHT', number: 5 } },
    },
    'review',
    '<sup>Sent</sup> with a tag',
  );
  const parts = {
    head: part(),
    note: part(),
    preview: part(),
    sent: part(),
    dropzone: part(),
    uploads: part(),
    foot: part(),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the frame reads none of it here.
  const frame = frameOf(box)(parts, {} as Composer);
  expect(wroteHere('v9', '<sup>Sent</sup> with a tag')).toBe(false);
  box.set({ busy: true });
  await vi.waitFor(() => expect(wroteHere('v9', '<sup>Sent</sup> with a tag')).toBe(true));
  frame.destroy();
});

const ON_LINE: DraftPlaceRow = {
  kind: 'thread',
  commit: 'a'.repeat(40),
  path: 'src/backoff.ts',
  lines: { start: null, end: { side: 'RIGHT', number: 5 } },
};

/**
 * What the head row of the card the comment of a box at `place` is drawn as while it's sent says:
 * its words, before the room its card's buttons will take. Beside lines, it's a popover's head.
 */
async function sentHead(place: DraftPlaceRow): Promise<string | undefined> {
  const box = new Box('v10', place, 'now', 'On its way');
  const parts = {
    head: part(),
    note: part(),
    preview: part(),
    sent: part(),
    dropzone: part(),
    uploads: part(),
    foot: part(),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the frame reads none of it here.
  const frame = frameOf(box)(parts, {} as Composer);
  box.set({ busy: true });
  await vi.waitFor(() => expect(parts.sent.textContent).toContain('1 comment'));
  const head = parts.sent.querySelector('.border-b');
  expect(head?.hasAttribute('data-pop-head')).toBe(said.threads === 'beside');
  const row = head?.firstElementChild?.textContent;
  frame.destroy();
  return row;
}

test('a new thread’s sent comment says what it’s on in its head row, where its card will', async () => {
  const lines: DraftPlaceRow = {
    kind: 'thread',
    commit: 'a'.repeat(40),
    path: 'src/backoff.ts',
    lines: { start: { side: 'RIGHT', number: 3 }, end: { side: 'RIGHT', number: 5 } },
  };
  // Between lines, a card says its lines where it's on more than one.
  expect(await sentHead(lines)).toBe('UnresolvedLines 3–51 comment');
  expect(await sentHead(ON_LINE)).toBe('Unresolved1 comment');
  // Beside them, its popover's head always says them.
  said.threads = 'beside';
  expect(await sentHead(ON_LINE)).toBe('UnresolvedLine 51 comment');
});

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
    sent: part(),
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

/** A button the foot shows, by a word of its name and the keys it says, if any. */
const button = (word: string, keys = '') =>
  expect.stringMatching(new RegExp(`\\b${word}\\b.*${keys}$`));

test('every box has the same foot, with the buttons its comment can take', () => {
  // On a line, or a thread: into the review, or at once, the one `c` or `C` asked for last.
  expect(drawn(ON_LINE).buttons).toEqual([
    button('Attach'),
    button('Discard'),
    button('now', '⌥⏎'),
    button('review', '⌘⏎'),
  ]);
  expect(drawn({ kind: 'reply', thread: 'T1' }).buttons.slice(2)).toEqual([
    button('now', '⌥⏎'),
    button('review', '⌘⏎'),
  ]);
  // A comment on the pull request joins no review, and an edit is saved.
  expect(drawn({ kind: 'conversation' }).buttons.slice(2)).toEqual([button('Send', '⌘⏎')]);
  expect(drawn({ kind: 'edit', thread: 'T1', comment: 'C1' }).buttons.slice(2)).toEqual([
    button('Save', '⌘⏎'),
  ]);
});

test('while a review is pending, GitHub adds every comment to it, so the box only offers that', () => {
  said.pending = true;
  expect(drawn(ON_LINE).buttons.slice(2)).toEqual([button('review', '⌘⏎')]);
  expect(drawn({ kind: 'conversation' }).buttons.slice(2)).toEqual([button('Send', '⌘⏎')]);
});

test('the head says what the comment is on, who it’s from only where that could be someone else', () => {
  expect(drawn(ON_LINE).head).toMatch(/^Line 5/);
  expect(drawn(ON_LINE).head).not.toContain('tess-okafor');
  expect(drawn({ kind: 'reply', thread: 'T1' }).head).toMatch(/^Reply/);
  said.accounts = 2;
  expect(drawn(ON_LINE).head).toContain('as tess-okafor');
});

test('a box closes from its head, but the pull request’s own, which is always there', () => {
  drawn(ON_LINE).leave();
  const own = drawn({ kind: 'conversation' });
  own.leave();
  expect(own.head).toMatch(/^Pull request/);
});
