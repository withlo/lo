// @vitest-environment jsdom
// A review thread's card in the diff: its comments with their authors' avatars, when each was
// written and its text, as the caller draws it, and its one line while it's collapsed.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import type { ThreadCommentRow, ThreadRow } from '../contract.ts';
import { ago, ThreadCard } from './Card.tsx';

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({ keysOf: () => [], system: 'mac' }),
}));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const NOW = Date.parse('2026-11-13T12:00:00Z');

function comment(overrides: Partial<ThreadCommentRow> = {}): ThreadCommentRow {
  return {
    id: 'C1',
    author: 'rozed-bot',
    authorType: 'User',
    body: 'Fixture C: Is doubling enough?',
    state: 'SUBMITTED',
    createdAt: '2026-11-13T11:55:00Z',
    url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
    hidden: null,
    viewerCanUpdate: true,
    viewerCanDelete: true,
    ...overrides,
  };
}

function row(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 'T1',
    path: 'src/backoff.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line: 5,
    startLine: null,
    originalLine: 5,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: null,
    writtenOn: null,
    comments: [
      comment(),
      comment({ id: 'C2', author: 'mira', body: 'It is for three tries.', state: 'PENDING' }),
    ],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...overrides,
  };
}

/**
 * Draws a card of `thread`, each comment's text as `text: <its body>`, and `excerpt` as the first
 * comment's opening.
 */
function drawn(
  thread: ThreadRow,
  open: boolean,
  onToggle: () => void = () => undefined,
  excerpt?: string,
) {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  act(() =>
    root.render(
      <ThreadCard
        row={thread}
        open={open}
        onToggle={onToggle}
        author="rozed-bot"
        body={(each) => <p>text: {each.body}</p>}
        excerpt={excerpt}
        now={NOW}
      />,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    element.remove();
  });
  return element;
}

test('an open thread shows each comment, by whom, when, and its text as the caller draws it', () => {
  const card = drawn(row(), true);
  expect(card.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'Unresolved thread by rozed-bot',
  );
  const text = card.textContent ?? '';
  expect(text).toContain('text: Fixture C: Is doubling enough?');
  expect(text).toContain('text: It is for three tries.');
  expect(text).toContain('5 min ago');
  // The pull request's author is marked; a comment in a pending review says so.
  expect(text).toContain('Author');
  expect(text).toContain('Pending');
  const avatar = card.querySelector('img');
  expect(avatar?.getAttribute('src')).toMatch(/^lo-image:\/\/avatar\/rozed-bot/);
});

test('a collapsed thread is one line, its first comment cut short, that opens it', () => {
  const toggled = vi.fn<() => void>();
  const opening = `Fixture C: ${'word '.repeat(20)}…`;
  const card = drawn(
    row({ resolved: true, comments: [comment({ body: '**Fixture C:** `word`' })] }),
    false,
    toggled,
    opening,
  );
  const line = card.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  expect(line?.textContent).toContain('Resolved');
  expect(line?.textContent).toContain(opening);
  // What it shows of the comment is the opening it was given, never the comment's Markdown.
  expect(line?.textContent).not.toContain('**');
  expect(card.textContent).not.toContain('text:');
  act(() => line?.click());
  expect(toggled).toHaveBeenCalledOnce();
});

test('a collapsed thread whose opening isn’t read yet shows its author alone', () => {
  const card = drawn(row({ comments: [comment({ body: '**Fixture C**' })] }), false);
  const line = card.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  expect(line?.textContent).toContain('rozed-bot');
  expect(line?.textContent).not.toContain('Fixture C');
});

test('a thread GitHub put on a newer push says so', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  act(() =>
    root.render(
      <ThreadCard
        row={row()}
        open
        onToggle={() => undefined}
        author="rozed-bot"
        body={(each) => <p>{each.body}</p>}
        landed
        now={NOW}
      />,
    ),
  );
  expect(element.textContent).toContain('On a newer push');
  act(() => root.unmount());
  element.remove();
  expect(drawn(row(), true).textContent).not.toContain('On a newer push');
});

test('when a comment was written, in words', () => {
  expect(ago(NOW - 20_000, NOW)).toBe('just now');
  expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
  expect(ago(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
  expect(ago(NOW - 49 * 60 * 60_000, NOW)).toBe('2 days ago');
  expect(ago(Number.NaN, NOW)).toBe('');
});
