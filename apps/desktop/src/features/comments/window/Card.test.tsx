// @vitest-environment jsdom
// A review thread's card in the diff: its comments with their authors' avatars, when each was
// written and its text, as the caller draws it, and its one line while it's collapsed.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { ThreadCommentRow, ThreadRow, ThreadsView } from '../contract.ts';
import { editing, replying } from './boxes.ts';
import { Card, ThreadCard } from './Card.tsx';
import { held } from './threads.ts';

vi.mock('../../../window/commands/registry.ts', () => ({
  registry: () => ({ keysOf: () => [], system: 'mac' }),
}));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  // Signed in as rozed-bot, who may reply.
  usePull: () => ({ acting: { kind: 'account', login: 'rozed-bot' } }),
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
    review: null,
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

test('a thread GitHub put on a later revision says which', () => {
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
        landed="r5"
        now={NOW}
      />,
    ),
  );
  expect(element.textContent).toContain('On r5');
  act(() => root.unmount());
  element.remove();
  expect(drawn(row(), true).textContent).not.toContain('On r5');
});

/**
 * A resolved-or-not thread's card while a resolve asked of it stands as `stands`, its control at
 * work unless `atWork` says not.
 */
function resolving(stands: 'sending' | 'notDone', atWork = true): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  act(() =>
    root.render(
      <ThreadCard
        row={row()}
        asked={{ thread: 'T1', comment: null, change: 'resolve', stands }}
        atWork={atWork}
        open
        onToggle={() => undefined}
        author="rozed-bot"
        body={(each) => <p>{each.body}</p>}
        login="rozed-bot"
        actions={{ onReply: () => undefined, onResolve: () => undefined }}
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

test('a resolve asked for shows at once, with the control at work, and goes back if it didn’t go', () => {
  const sending = resolving('sending');
  expect(sending.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'Resolved thread by rozed-bot',
  );
  const busy = sending.querySelector('button[aria-busy="true"]');
  expect(busy?.textContent).toContain('Resolving…');
  // GitHub never took it: the thread is as it was, with its control to ask again.
  const back = resolving('notDone');
  expect(back.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'Unresolved thread by rozed-bot',
  );
  expect(back.querySelector('button[aria-busy="true"]')).toBeNull();
  // GitHub took it, and the threads don't show it yet: still resolved, its control its own again.
  const taken = resolving('sending', false);
  expect(taken.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'Resolved thread by rozed-bot',
  );
  expect(taken.querySelector('button[aria-busy="true"]')).toBeNull();
});

test('a card drawn as its row goes, and comes back, draws nothing meanwhile', () => {
  installBridge();
  const tab: PullTab = {
    id: 'view-card',
    kind: 'pull',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 94,
  };
  const shown = (rows: ThreadRow[]) => {
    const threads: ThreadsView = {
      id: tab.id,
      status: 'ready',
      threads: rows,
      missing: 0,
      compared: null,
      problem: null,
    };
    held.set(tab.id, { threads });
  };
  shown([row()]);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  onTestFinished(() => {
    act(() => root.unmount());
    element.remove();
    held.set(tab.id, {});
  });
  act(() => root.render(<Card tab={tab} id="T1" open onToggle={() => undefined} />));
  expect(element.querySelector('[data-comment="C1"]')).not.toBeNull();
  // Its only comment deleted elsewhere: the thread goes from what main sent, while it's drawn.
  act(() => shown([]));
  expect(element.innerHTML).toBe('');
  act(() => shown([row()]));
  expect(element.querySelector('[data-comment="C1"]')).not.toBeNull();
});

test('in a popover, only the box it holds takes a reply’s row or a comment’s place, not one open elsewhere', () => {
  installBridge();
  const tab: PullTab = {
    id: 'view-popover',
    kind: 'pull',
    owner: 'rozed-dev',
    repo: 'e2e',
    number: 94,
  };
  const threads: ThreadsView = {
    id: tab.id,
    status: 'ready',
    threads: [row()],
    missing: 0,
    compared: null,
    problem: null,
  };
  held.set(tab.id, { threads });
  // A reply and an edit of C1 open in the view, as in a diff out of sight.
  replying.set(tab.id, new Set(['T1']));
  editing.set(tab.id, new Set(['C1']));
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  onTestFinished(() => {
    act(() => root.unmount());
    element.remove();
    held.set(tab.id, {});
    replying.set(tab.id, new Set());
    editing.set(tab.id, new Set());
  });
  const draw = (popover: boolean, box?: { edits?: string }) =>
    act(() =>
      root.render(
        <Card tab={tab} id="T1" open popover={popover} onToggle={() => undefined} box={box} />,
      ),
    );
  const offers = () =>
    [...element.querySelectorAll('button')].some((button) =>
      button.textContent.startsWith('Reply'),
    );
  const shows = () => element.querySelector('[data-comment="C1"]') !== null;
  draw(true);
  expect(offers()).toBe(true);
  expect(shows()).toBe(true);
  // Its own reply's box takes the row's place; its own edit's, the comment's.
  draw(true, {});
  expect(offers()).toBe(false);
  draw(true, { edits: 'C1' });
  expect(shows()).toBe(false);
  // In the flow, one open anywhere in the view takes them.
  draw(false);
  expect(offers()).toBe(false);
  expect(shows()).toBe(false);
});

test('when a comment was written, in the largest whole unit only', () => {
  const card = drawn(row({ comments: [comment({ createdAt: '2026-11-04T09:00:00Z' })] }), true);
  expect(card.textContent).toContain('9 d ago');
});
