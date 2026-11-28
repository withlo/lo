// @vitest-environment jsdom
// The box at the end of a pull request's timeline, for the pull request's draft written on a code
// block of the overview: what it says in the box's place while the draft isn't its own, the draft it
// shows, which it keeps whatever the overview does, and that draft opening under its block once the
// timeline goes.

import type { Composer, ComposerEvents, ComposerInit, DraftMark } from '@lo/ui/code';
import { KEY_EVENT } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, onTestFinished, test, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type * as OverviewShared from '../../overview/window/shared.ts';
import { blockKey, type WritingBlock } from '../../overview/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab, PullView } from '../../tab/window/shared.ts';
import type { DraftHomeRow, DraftRow, SendOutcome } from '../contract.ts';
import type { Rendered } from '../jobs.ts';
import { keepBoxesOf, reopenAll, restoreBlock, send, takeDrafts, timelineBox } from './boxes.ts';
import type * as Main from './main.ts';
import { PullBox } from './TimelineBox.tsx';
import { ON_PULL } from './writing.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const PATH = 'src/backoff.ts';
/** The code block the draft was written on: lines 3 to 9 of the overview at `OLDER`. */
const KEY = blockKey(OLDER, PATH, 3, 9);
let VIEW = 't0';

/** An editor the timeline draws, as a text field, which says whether it was dismissed. */
interface Drawn {
  readonly field: HTMLTextAreaElement;
  dismissed: boolean;
}

const editors = vi.hoisted(() => ({ drawn: [] as Drawn[] }));
vi.mock('@lo/ui/code', () => ({
  createComposer: (parent: HTMLElement, init: ComposerInit, on: ComposerEvents) => {
    const field = document.createElement('textarea');
    field.value = init.draft;
    parent.append(field);
    const drawn: Drawn = { field, dismissed: false };
    editors.drawn.push(drawn);
    return {
      get text() {
        return field.value;
      },
      mode: 'insert',
      previewing: false,
      focus: () => field.focus(),
      insert() {},
      replace(from: number, to: number, text: string) {
        field.value = field.value.slice(0, from) + text + field.value.slice(to);
        on.change(field.value);
      },
      preview() {},
      hold() {},
      close: () => field.remove(),
      dismiss() {
        drawn.dismissed = true;
        field.remove();
      },
    };
  },
}));

// What's sent is drawn from a tree made of its text first, which comes here at once.
vi.mock('./main.ts', async (original) => ({
  ...(await original<typeof Main>()),
  commentsJobs: () => ({
    render: (): Promise<Rendered> =>
      Promise.resolve({ tree: { blocks: [], notes: [], diagnostics: [] }, images: false }),
  }),
}));

/** How threads show: these tests are between lines, but where one says otherwise. */
const threadsShow = vi.hoisted(() => ({ mode: 'between' as 'beside' | 'between' }));
vi.mock('./mode.ts', () => ({ threadsMode: () => threadsShow.mode }));

const said = vi.hoisted(() => ({ pull: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
  runOf: () => undefined,
}));

const overview = vi.hoisted(() => ({
  /** The blocks drawn, by their keys. */
  blocks: new Map<string, unknown>(),
  /** Whether the overview has each block, by its key: `unknown` while Lo reads or checks it. */
  has: new Map<string, boolean | 'unknown'>(),
}));
vi.mock('../../overview/window/shared.ts', async (original) => ({
  ...(await original<typeof OverviewShared>()),
  writingBlock: (_tab: string, key: string) => overview.blocks.get(key),
  writingBlocks: () => [...overview.blocks.values()],
  blockInOverview: (_tab: string, key: string) =>
    overview.blocks.has(key) || (overview.has.get(key) ?? false),
  revisionName: (_tab: string, commit: string) => (commit === HEAD ? 'r2' : 'r1'),
}));

const answers: Record<string, (input: unknown) => unknown> = {
  'app.info': () => ({ nonce: 'n0' }),
  'comments.current': () => ({ threads: undefined, review: undefined, drafts: undefined }),
  'comments.draft': () => undefined,
};
installBridge(answers);

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // The box's keys, as it shows them, are this system's.
  createRegistry([], 'mac');
});

function pull(): PullView {
  return {
    id: VIEW,
    loading: false,
    acting: { kind: 'account', login: 'rozed-bot' },
    header: null,
    connection: { kind: 'live' },
    problem: null,
    shown: HEAD,
    newer: null,
  };
}

function tab(): PullTab {
  return { kind: 'pull', id: VIEW, owner: 'rozed-dev', repo: 'e2e', number: 94 };
}

/** Where the draft was written: line 7 of the block, a comment on the pull request itself. */
const HOME: DraftHomeRow = {
  commit: OLDER,
  path: PATH,
  block: { start: 3, end: 9 },
  at: { side: 'new', from: 7, to: 7 },
  why: 'untouched',
  head: HEAD,
};

/** The pull request's draft, written on the block, as main keeps it. */
function draft(): DraftRow {
  return {
    place: { kind: 'conversation' },
    text: 'On the pull request',
    savedAt: 1,
    restored: true,
    sending: null,
    sent: null,
    sentAt: null,
    base: null,
    home: HOME,
  };
}

/** The block, drawn: the texts of the boxes it draws on its lines, and the drafts its marks show. */
function drawBlock(): { writing: WritingBlock; texts: string[]; marks: DraftMark[] } {
  const texts: string[] = [];
  const marks: DraftMark[] = [];
  const writing: WritingBlock = {
    block: {
      tab: VIEW,
      key: KEY,
      block: 'b0',
      file: 'x0',
      path: PATH,
      commit: OLDER,
      from: null,
      lines: { start: 3, end: 9 },
      named: { start: 3, end: 9 },
    },
    compose(_at, text) {
      texts.push(text);
      return {
        text,
        mode: 'insert',
        previewing: false,
        focus() {},
        insert() {},
        replace() {},
        preview() {},
        hold() {},
        close() {},
        leave() {},
        dismiss() {},
        keep: () => ({ text, editor: undefined }),
        move: () => false,
      } satisfies Composer;
    },
    setDrafts(drafts) {
      marks.splice(0, marks.length, ...drafts);
    },
    openDraft: () => false,
  };
  overview.blocks.set(KEY, writing);
  return { writing, texts, marks };
}

/** Lets what's under way settle: what's queued, the page's nonce, and what React draws. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const unmounts: (() => void)[] = [];

/**
 * The box drawn at the end of the timeline, once the page's nonce has come, and what takes the
 * timeline away.
 */
async function drawBox(leave = () => {}): Promise<{ box: HTMLElement; unmount: () => void }> {
  const box = document.createElement('div');
  document.body.append(box);
  const root = createRoot(box);
  act(() => root.render(<PullBox tab={tab()} leave={leave} />));
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
    box.remove();
  };
  unmounts.push(unmount);
  await settle();
  return { box, unmount };
}

/** The overview changed: each view's drafts open where they open now, as the window has it. */
async function overviewChanged(): Promise<void> {
  act(() => reopenAll());
  await settle();
}

beforeEach(() => {
  VIEW = `t${Number(VIEW.slice(1)) + 1}`;
  said.pull = pull();
  editors.drawn.length = 0;
  overview.blocks.clear();
  overview.has.clear();
});

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  keepBoxesOf(new Set());
});

test('while Lo is still checking the overview, the box says so, not that the draft is under its block', async () => {
  overview.has.set(KEY, 'unknown');
  takeDrafts({ id: VIEW, drafts: [draft()] });
  const { box } = await drawBox();
  expect(box.textContent).toContain('Checking overview…');
  expect(editors.drawn).toEqual([]);
  // Checked, the overview has the block: the draft opens under it, as the box says.
  const block = drawBlock();
  await overviewChanged();
  expect(block.texts).toEqual(['On the pull request']);
  expect(box.textContent).toContain('Draft in the overview');
  expect(editors.drawn).toEqual([]);
});

test('beside lines, a draft whose block is drawn stays closed there, its mark on the line it was written on', async () => {
  threadsShow.mode = 'beside';
  onTestFinished(() => {
    threadsShow.mode = 'between';
  });
  takeDrafts({ id: VIEW, drafts: [draft()] });
  const block = drawBlock();
  restoreBlock(block.writing);
  const { box } = await drawBox();
  await overviewChanged();
  expect(block.texts).toEqual([]);
  expect(block.marks.map(({ at, words, shown }) => ({ at, words, shown }))).toEqual([
    { at: { file: 'x0', side: 'new', line: 7 }, words: 'line 7', shown: false },
  ]);
  expect(box.textContent).toContain('Draft in the overview');
  expect(editors.drawn).toEqual([]);
});

test('the draft it shows stays, with its text and focus, while the overview goes from lacking its block to having it', async () => {
  overview.has.set(KEY, false);
  takeDrafts({ id: VIEW, drafts: [draft()] });
  await drawBox();
  const [drawn] = editors.drawn;
  expect(drawn?.field.value).toBe('On the pull request');
  drawn?.field.focus();
  // Read again, then checked, the overview has the block, drawn: no input comes meanwhile.
  overview.has.set(KEY, 'unknown');
  await overviewChanged();
  overview.has.delete(KEY);
  const block = drawBlock();
  restoreBlock(block.writing);
  await overviewChanged();
  expect(editors.drawn).toEqual([drawn]);
  expect(drawn?.dismissed).toBe(false);
  expect(drawn?.field.value).toBe('On the pull request');
  expect(document.activeElement).toBe(drawn?.field);
  expect(block.texts).toEqual([]);
});

test('once the timeline goes, a draft it showed opens under its block, though the block was drawn first', async () => {
  overview.has.set(KEY, false);
  takeDrafts({ id: VIEW, drafts: [draft()] });
  const { unmount } = await drawBox();
  const [drawn] = editors.drawn;
  const block = drawBlock();
  restoreBlock(block.writing);
  await overviewChanged();
  expect(block.texts).toEqual([]);
  unmount();
  await settle();
  expect(drawn?.dismissed).toBe(true);
  expect(block.texts).toEqual(['On the pull request']);
});

/**
 * Sends `text` from the box at the end of the timeline, focused, its focus going to `list` as the
 * comment goes, as the timeline gives it; `meanwhile` runs while it's on its way, and GitHub then
 * refuses it. What had focus then.
 */
async function sendRefused(list: HTMLElement, meanwhile: () => void): Promise<Element | null> {
  let answer!: (outcome: SendOutcome) => void;
  answers['comments.send'] = () =>
    new Promise<SendOutcome>((resolve) => {
      answer = resolve;
    });
  onTestFinished(() => {
    delete answers['comments.send'];
  });
  takeDrafts({ id: VIEW, drafts: [] });
  await drawBox(() => list.focus());
  const box = timelineBox(VIEW, ON_PULL)!;
  const [drawn] = editors.drawn;
  drawn!.field.focus();
  box.set({ focused: true, text: 'Ship it.' });
  let sending!: Promise<void>;
  await act(async () => {
    sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
  });
  expect(document.activeElement).toBe(list);
  // As its frame says once focus has left it.
  box.set({ focused: false });
  meanwhile();
  await act(async () => {
    answer({ kind: 'refused', refusal: { kind: 'github', message: 'Validation failed' } });
    await sending;
  });
  expect(box.state.text).toBe('Ship it.');
  return document.activeElement;
}

/** A focusable element on the page, gone once the test is. */
function focusable(tag: string): HTMLElement {
  const element = document.createElement(tag);
  element.tabIndex = 0;
  document.body.append(element);
  onTestFinished(() => element.remove());
  return element;
}

test('a comment that couldn’t be sent is back in the box, and so is focus still in the list it went to', async () => {
  const list = focusable('ol');
  expect(await sendRefused(list, () => {})).toBe(editors.drawn[0]?.field);
});

test('a comment that couldn’t be sent leaves focus where the reader took it from the list', async () => {
  const list = focusable('ol');
  const elsewhere = focusable('button');
  expect(await sendRefused(list, () => elsewhere.focus())).toBe(elsewhere);
});

test('a comment that couldn’t be sent leaves focus in the list where the reader moved on in it, as with `j`', async () => {
  const list = focusable('ol');
  // A key Lo's command took in the list, as the key listener tells it.
  const moved = () => list.dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
  expect(await sendRefused(list, moved)).toBe(list);
});
