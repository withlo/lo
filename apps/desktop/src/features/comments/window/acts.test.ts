// @vitest-environment jsdom
// What a change to a thread that didn't go, or may not have, shows where its card isn't on screen,
// as beside lines once its popover has closed: the dot on its thread's mark, its name saying what
// failed, while the card says it; and one toast, whose "Show thread" shows the card and asks nothing
// of GitHub again. Wherever its card is on screen, in a popover or the flow, the card says it alone.

import type { ThreadView } from '@lo/ui/code';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Notices from '../../../window/commands/notices.tsx';
import type * as TabShared from '../../tab/window/shared.ts';
import type { ActRow, ThreadCommentRow, ThreadRow } from '../contract.ts';
import {
  acting,
  closeAct,
  followFailures,
  markFailures,
  resolveThread,
  takeActs,
  threw,
} from './acts.ts';
import { held } from './threads.ts';

const said = vi.hoisted(() => ({
  toasts: [] as { title: string; body: string; more: Parameters<typeof Notices.notify>[2] }[],
  told: [] as string[],
  shown: [] as string[],
  inPanel: [] as string[],
  resolves: 0,
  screen: 'v0' as string | undefined,
  resolve: (() => Promise.resolve({ kind: 'done' })) as () => Promise<unknown>,
}));

vi.mock('../../../window/commands/notices.tsx', async (original) => ({
  ...(await original<typeof Notices>()),
  notify: (title: string, body: string, more: Parameters<typeof Notices.notify>[2]) =>
    said.toasts.push({ title, body, more }),
}));
vi.mock('./Said.tsx', () => ({ tell: (text: string) => said.told.push(text) }));
vi.mock('./panel.ts', () => ({ showThread: (_tab: unknown, id: string) => said.inPanel.push(id) }));
vi.mock('./main.ts', () => ({
  main: () => ({
    resolve: () => {
      said.resolves += 1;
      return said.resolve();
    },
  }),
}));
vi.mock('./boxes.ts', () => ({
  canWrite: () => true,
  claimBriefly: () => {},
  IN_DIFF: {},
  knowPull: () => {},
  loginOf: () => 'rozed-bot',
  noDiff: () => 'No diff',
  offline: () => undefined,
  openAt: () => {},
}));
vi.mock('../../diff/window/shared.ts', () => ({
  writingDiff: () => ({ claimThread: () => () => {} }),
  goToThread: (view: string, thread: string) => {
    said.shown.push(`${view} ${thread}`);
    return true;
  },
}));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () =>
    said.screen === undefined
      ? undefined
      : { kind: 'pull', id: said.screen, owner: 'rozed-dev', repo: 'e2e', number: 94 },
  showTabOf: () => Promise.resolve(),
}));

const VIEW = 'v0';
const TAB = { kind: 'pull', id: VIEW, owner: 'rozed-dev', repo: 'e2e', number: 94 } as const;

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
    line: 2,
    startLine: null,
    originalLine: 2,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: null,
    writtenOn: null,
    comments: [comment()],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...overrides,
  };
}

/** Thread `id` as the diff places it, under new line 2 of file `a`, marked unresolved. */
function placed(id = 'T1'): ThreadView {
  return {
    id,
    at: { file: 'a', side: 'new', line: 2 },
    open: true,
    version: 1,
    mark: { resolved: false, words: { lines: 'line 2', line: 'line 2' } },
  };
}

/** Resolving thread T1 as main says it stands. */
function resolving(stands: ActRow['stands']): ActRow {
  return { thread: 'T1', comment: null, change: 'resolve', stands };
}

/** What T1's mark says failed, as the diff would mark it now. */
function failedOn(): string | undefined {
  return markFailures(VIEW, [placed()])[0]?.mark?.failed;
}

beforeEach(() => {
  held.set(VIEW, {
    threads: {
      id: VIEW,
      status: 'ready',
      threads: [row()],
      missing: 0,
      compared: null,
      problem: null,
    },
  });
  acting.set(VIEW, new Map());
  threw.set(VIEW, new Map());
  Object.assign(said, {
    toasts: [],
    told: [],
    shown: [],
    inPanel: [],
    resolves: 0,
    screen: VIEW,
    resolve: () => Promise.resolve({ kind: 'done' }),
  });
});

afterEach(() => {
  acting.set(VIEW, new Map());
  threw.set(VIEW, new Map());
  document.body.replaceChildren();
});

/**
 * T1's card, as a code view draws it, at `top` on the page, 120 px tall: in a box 400 px tall
 * that clips what's scrolled out of it, where `clipped`.
 */
function card(top = 100, clipped = false): HTMLElement {
  const drawn = document.createElement('div');
  drawn.dataset.threadId = 'T1';
  drawn.getBoundingClientRect = () => new DOMRect(0, top, 400, 120);
  if (!clipped) {
    document.body.append(drawn);
    return drawn;
  }
  const box = document.createElement('div');
  box.style.overflowY = 'auto';
  box.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
  box.append(drawn);
  document.body.append(box);
  return drawn;
}

describe('a resolve that didn’t go', () => {
  test('with its popover closed, one toast says so at danger tone, and its mark has the dot', () => {
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toEqual([
      {
        title: 'Couldn’t resolve the thread',
        body: 'GitHub didn’t respond.',
        more: expect.objectContaining({ tone: 'danger', details: undefined }),
      },
    ]);
    expect(said.toasts[0]!.more?.action?.label).toBe('Show thread');
    // The toast says it to a screen reader: nothing else does.
    expect(said.told).toEqual(['Resolving…']);
    expect(failedOn()).toBe('couldn’t resolve the thread');
    // Said once, however often main says the same again.
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toHaveLength(1);
  });

  test('one not confirmed is a warning, and its "Show thread" shows the thread, asking nothing again', async () => {
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('checking')] });
    takeActs({ id: VIEW, acts: [resolving('unknown')] });
    expect(said.toasts).toHaveLength(1);
    const [toast] = said.toasts;
    expect(toast).toMatchObject({ title: 'Resolve not confirmed', more: { tone: 'warning' } });
    toast!.more?.action?.onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(said.shown).toEqual([`${VIEW} T1`]);
    expect(said.resolves).toBe(0);
    expect(failedOn()).toBe('resolve not confirmed');
  });

  test('with its popover open, the card says it, and a screen reader hears it: no toast', () => {
    card();
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toEqual([]);
    expect(said.told).toEqual([
      'Resolving…',
      'Couldn’t resolve the thread. GitHub didn’t respond.',
    ]);
    // The mark has the dot all the same, while the card says it.
    expect(failedOn()).toBe('couldn’t resolve the thread');
  });

  test('in a tab not on screen, a toast says it', () => {
    card();
    said.screen = 'v1';
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toHaveLength(1);
  });

  test('its card on screen in the flow, between lines or in a code block, says it: no toast', () => {
    card(300, true);
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toEqual([]);
  });

  test('its card in a view kept unseen and inert, as a middle view not shown, a toast says it', () => {
    const view = document.createElement('div');
    view.className = 'invisible';
    view.setAttribute('inert', '');
    view.append(card());
    document.body.append(view);
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toHaveLength(1);
  });

  test('its card scrolled out of what holds it, or hidden, a toast says it', () => {
    card(500, true);
    const hidden = card();
    hidden.hidden = true;
    hidden.checkVisibility = () => false;
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toHaveLength(1);
  });

  test('one Lo didn’t see go, as main says how they stand as the window starts, has no toast', () => {
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(said.toasts).toEqual([]);
    expect(failedOn()).toBe('couldn’t resolve the thread');
  });

  test('its note dismissed, the dot goes, and the diff is told to mark it again', () => {
    const changed: string[] = [];
    followFailures((view) => changed.push(view));
    expect(failedOn()).toBeUndefined();
    takeActs({ id: VIEW, acts: [resolving('sending')] });
    takeActs({ id: VIEW, acts: [resolving('notDone')] });
    expect(changed).toEqual([VIEW]);
    expect(failedOn()).toBe('couldn’t resolve the thread');
    closeAct(VIEW, resolving('notDone'));
    expect(changed).toEqual([VIEW, VIEW]);
    expect(failedOn()).toBeUndefined();
    // Nothing failed, nothing changes: the marks are left as they are.
    expect(markFailures(VIEW, [placed()])[0]).toEqual(placed());
  });
});

describe('a resolve whose write failed in Lo', () => {
  test('with its popover closed, a toast says so with what came back, and the mark has the dot', async () => {
    said.resolve = () => Promise.reject(new Error('The window lost main.'));
    await resolveThread(TAB, row());
    expect(said.toasts).toEqual([
      {
        title: 'Couldn’t resolve the thread',
        body: '',
        more: expect.objectContaining({ tone: 'danger', details: 'The window lost main.' }),
      },
    ]);
    expect(failedOn()).toBe('couldn’t resolve the thread');
    // Showing the thread asks nothing of GitHub again.
    said.toasts[0]!.more?.action?.onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(said.shown).toEqual([`${VIEW} T1`]);
    expect(said.resolves).toBe(1);
  });

  test('with its popover open, only the card says it', async () => {
    card();
    said.resolve = () => Promise.reject(new Error('The window lost main.'));
    await resolveThread(TAB, row());
    expect(said.toasts).toEqual([]);
    expect(failedOn()).toBe('couldn’t resolve the thread');
  });
});
