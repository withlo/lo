// @vitest-environment jsdom
// What a change to a thread that didn't go, or may not have, shows where its card isn't on screen,
// as beside lines once its popover has closed: the dot on its thread's mark, its name saying what
// failed, while the card says it; and one toast, whose "Show thread" shows the card and asks nothing
// of GitHub again. Wherever its card is on screen, in a popover or the flow, the card says it alone.

import type { ThreadView } from '@lo/ui/code';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as Notices from '../../../window/commands/notices.tsx';
import type * as TabShared from '../../tab/window/shared.ts';
import type * as Threads from './threads.ts';
import type { ActRow, ThreadCommentRow, ThreadRow } from '../contract.ts';
import {
  acting,
  closeAct,
  edit,
  followFailures,
  markFailures,
  reply,
  resolveThread,
  takeActs,
  threw,
  type ThreadKeyTarget,
  whyNotOn,
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
  /**
   * The boxes opened: where, with a diff to draw them in or none yet, in the diff or on a block,
   * and what's in them.
   */
  opened: [] as { place: unknown; diff: boolean; home: unknown; draft: unknown }[],
  /** Whether the diff is drawn, whether it's on screen, and whether it shows T1. */
  drawn: true,
  diffShown: false,
  placed: false,
  /** Whether a key or control on a thread is a code block's. */
  inBlock: false,
  /** Whether focus is in the diff, and the block's is only its popover pinned. */
  diffFocused: false,
  /** Whether that block shows the thread, beside lines, where a box is written on it. */
  writesInBlock: false,
  /** Whether the block draws a box it's asked to. */
  blockDraws: true,
  /** How many keys, clicks and wheel turns the reader has made. */
  inputs: 0,
  /** What was refused, and said so. */
  refused: [] as string[],
  /** Whether a draft of the edit was kept from before. */
  hadDraft: false,
  /** The edits whose drafts `i` started went, as no box opened for them. */
  dropped: [] as unknown[],
}));

vi.mock('../../../window/commands/notices.tsx', async (original) => ({
  ...(await original<typeof Notices>()),
  notify: (title: string, body: string, more: Parameters<typeof Notices.notify>[2]) =>
    said.toasts.push({ title, body, more }),
  refuse: (title: string) => said.refused.push(title),
}));
vi.mock('./threads.ts', async (original) => ({
  ...(await original<typeof Threads>()),
  shownAt: () => (said.placed ? { file: 'a', side: 'new', line: 2 } : undefined),
}));
vi.mock('./Said.tsx', () => ({ tell: (text: string) => said.told.push(text) }));
vi.mock('./panel.ts', () => ({ showThread: (_tab: unknown, id: string) => said.inPanel.push(id) }));
vi.mock('./main.ts', () => ({
  main: () => ({
    resolve: () => {
      said.resolves += 1;
      return said.resolve();
    },
    editing: () => Promise.resolve({ kind: 'editing' }),
  }),
}));
vi.mock('./boxes.ts', () => ({
  canWrite: () => true,
  claimBriefly: () => {},
  IN_DIFF: { kind: 'diff' },
  dropStartedEdit: (_view: string, place: unknown) => said.dropped.push(place),
  hasBox: () => said.hadDraft,
  homeInBlock: () => (said.writesInBlock ? { kind: 'block' } : undefined),
  inputsSoFar: () => said.inputs,
  knowPull: () => {},
  loginOf: () => 'rozed-bot',
  noDiff: () => 'Go to the diff first',
  offline: () => undefined,
  openAt: (
    _view: string,
    diff: unknown,
    home: { kind: string },
    place: unknown,
    _how: unknown,
    draft = '',
  ) => said.opened.push({ place, diff: diff !== undefined, home: home.kind, draft }),
  openInBlock: (_view: string, home: { kind: string }, place: unknown, draft: string) => {
    if (said.blockDraws) said.opened.push({ place, diff: false, home: home.kind, draft });
    return said.blockDraws;
  },
}));
vi.mock('../../diff/window/shared.ts', () => ({
  writingDiff: () =>
    said.drawn
      ? { claimThread: () => () => {}, openThread: () => true, hasFocus: () => said.diffFocused }
      : undefined,
  diffOnScreen: () => said.diffShown,
  goToThread: (view: string, thread: string, how = 'go') => {
    said.shown.push(`${view} ${thread}${how === 'go' ? '' : ` ${how}`}`);
    return true;
  },
}));
vi.mock('../../overview/window/shared.ts', () => ({
  writingBlockAsked: (_tab: string, _thread: string, elsewhere: boolean) =>
    said.inBlock && !(elsewhere && said.diffFocused) ? {} : undefined,
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
    opened: [],
    drawn: true,
    diffShown: false,
    placed: false,
    inBlock: false,
    diffFocused: false,
    writesInBlock: false,
    blockDraws: true,
    inputs: 0,
    refused: [],
    hadDraft: false,
    dropped: [],
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

/** T1's reply's box, as opened in the diff or on a block, with a diff to draw it in or none. */
function replyIn(home: string, diff = false) {
  return { place: { kind: 'reply', thread: 'T1' }, diff, home, draft: '' };
}

/** T1's C1's edit's box, as opened in the diff or on a block, with GitHub's text in it. */
function editIn(home: string, diff = false) {
  const place = { kind: 'edit', thread: 'T1', comment: 'C1' };
  return { place, diff, home, draft: 'Fixture C: Is doubling enough?' };
}

describe('a reply or an edit asked for on a code block', () => {
  const thread = { kind: 'thread', thread: 'T1' } as const;

  test('beside lines, is written on the block, in its popover, the diff on screen or not', async () => {
    said.inBlock = true;
    said.writesInBlock = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    said.diffShown = true;
    said.placed = true;
    reply(TAB, thread);
    expect(said.opened).toEqual([replyIn('block'), editIn('block'), replyIn('block')]);
    expect(said.refused).toEqual([]);
    expect(said.shown).toEqual([]);
  });

  test('with the code beside, asked for in the diff on a thread a block has pinned, writes in the diff', async () => {
    // The block's popover is pinned on T1, and focus is in the diff.
    said.inBlock = true;
    said.writesInBlock = true;
    said.diffFocused = true;
    said.diffShown = true;
    said.placed = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.opened).toEqual([replyIn('diff', true), editIn('diff', true)]);
  });

  test('where the block can’t draw it, with the diff off screen, says to go to the diff first, and opens nothing', async () => {
    said.inBlock = true;
    said.writesInBlock = true;
    said.blockDraws = false;
    said.placed = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.refused).toEqual(['Go to the diff first', 'Go to the diff first']);
    expect(said.opened).toEqual([]);
  });

  test('where the block can’t draw it, with the diff on screen, writes in the diff', async () => {
    said.inBlock = true;
    said.writesInBlock = true;
    said.blockDraws = false;
    said.diffShown = true;
    said.placed = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.opened).toEqual([replyIn('diff', true), editIn('diff', true)]);
    expect(said.refused).toEqual([]);
  });

  test('between lines, with the diff never drawn, says to go to the diff first, and opens nothing', async () => {
    said.inBlock = true;
    said.drawn = false;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.refused).toEqual(['Go to the diff first', 'Go to the diff first']);
    expect(said.opened).toEqual([]);
    expect(said.shown).toEqual([]);
  });

  test('between lines, with the diff drawn but hidden, says the same, and opens nothing in it', async () => {
    said.inBlock = true;
    said.placed = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.refused).toEqual(['Go to the diff first', 'Go to the diff first']);
    expect(said.opened).toEqual([]);
    expect(said.shown).toEqual([]);
  });

  test('between lines, with the diff on screen, as with the code beside, writes in the diff', async () => {
    said.inBlock = true;
    said.diffShown = true;
    said.placed = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.opened).toEqual([replyIn('diff', true), editIn('diff', true)]);
    expect(said.refused).toEqual([]);
  });

  test('from anywhere else, with the diff off screen, the diff hasn’t the thread', async () => {
    said.placed = true;
    reply(TAB, thread);
    await edit(TAB, thread);
    expect(said.refused).toEqual([
      'This thread isn’t in this diff',
      'This thread isn’t in this diff',
    ]);
    expect(said.opened).toEqual([]);
  });

  test('an edit the reader moved on from while it was asked for opens nothing', async () => {
    said.inBlock = true;
    said.writesInBlock = true;
    // Focus gone from its block.
    let asked = edit(TAB, thread);
    said.inBlock = false;
    await asked;
    // Between lines, written in the diff, which went off screen.
    said.inBlock = true;
    said.writesInBlock = false;
    said.diffShown = true;
    said.placed = true;
    asked = edit(TAB, thread);
    said.diffShown = false;
    await asked;
    said.writesInBlock = true;
    // A key typed meanwhile.
    asked = edit(TAB, thread);
    said.inputs += 1;
    await asked;
    // Another tab on screen, as when its own has closed.
    asked = edit(TAB, thread);
    said.screen = 'v1';
    await asked;
    expect(said.opened).toEqual([]);
    expect(said.refused).toEqual([]);
    // Each draft main started for it goes, as an untouched edit's does.
    const place = { kind: 'edit', thread: 'T1', comment: 'C1' };
    expect(said.dropped).toEqual([place, place, place, place]);
    // One kept from before stays.
    said.hadDraft = true;
    asked = edit(TAB, thread);
    await asked;
    expect(said.dropped).toHaveLength(4);
    // Nothing done meanwhile, it opens.
    said.hadDraft = false;
    said.screen = VIEW;
    await edit(TAB, thread);
    expect(said.opened).toEqual([editIn('block')]);
    expect(said.dropped).toHaveLength(4);
  });

  test('an edit the block can’t draw, with the diff off screen, lets the draft it started go', async () => {
    said.inBlock = true;
    said.writesInBlock = true;
    said.blockDraws = false;
    await edit(TAB, thread);
    expect(said.refused).toEqual(['Go to the diff first']);
    expect(said.dropped).toEqual([{ kind: 'edit', thread: 'T1', comment: 'C1' }]);
  });
});

describe('a comment’s own menu', () => {
  test('dims Edit and Delete on a comment that isn’t yours, or is gone, with why, and not on yours', () => {
    const theirs = comment({ id: 'C2', author: 'mira-chen', viewerCanUpdate: false });
    held.set(VIEW, {
      threads: {
        id: VIEW,
        status: 'ready',
        threads: [row({ comments: [comment(), theirs] })],
        missing: 0,
        compared: null,
        problem: null,
      },
    });
    expect(whyNotOn(VIEW, onT1('C1'), 'edit')).toBeUndefined();
    expect(whyNotOn(VIEW, onT1('C1'), 'delete')).toBeUndefined();
    expect(whyNotOn(VIEW, onT1('C2'), 'edit')).toMatch(/\byours\b/);
    expect(whyNotOn(VIEW, onT1('C2'), 'delete')).toMatch(/\byours\b/);
    expect(whyNotOn(VIEW, onT1('C9'), 'delete')).toMatch(/\bdeleted\b/);
    // Naming no comment, its key acts on your newest, which it finds as it runs.
    expect(whyNotOn(VIEW, onT1(), 'edit')).toBeUndefined();
  });
});

/** Thread `T1` as a menu's target, from one of its comments' own, or from the thread's. */
function onT1(id?: string): ThreadKeyTarget {
  return id === undefined
    ? { kind: 'thread', thread: 'T1' }
    : { kind: 'thread', thread: 'T1', comment: id };
}
