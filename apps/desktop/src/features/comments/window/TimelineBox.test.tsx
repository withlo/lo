// @vitest-environment jsdom
// The box at the end of a pull request's timeline, for the pull request's draft written on a code
// block of the overview: what it says in the box's place while the draft isn't its own, the draft it
// keeps while the overview is read again or checked, and the draft it lets go under its block once
// the overview has the block again.

import type { Composer, ComposerEvents, ComposerInit } from '@lo/ui/code';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type * as OverviewShared from '../../overview/window/shared.ts';
import { blockKey, type WritingBlock } from '../../overview/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab, PullView } from '../../tab/window/shared.ts';
import type { DraftHomeRow, DraftRow } from '../contract.ts';
import { keepBoxesOf, reopenAll, restoreBlock, takeDrafts } from './boxes.ts';
import { PullBox } from './TimelineBox.tsx';

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
  // The box keeps its room from what it measures, which jsdom never changes.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
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
    base: null,
    home: HOME,
  };
}

/** The block, drawn: the texts of the boxes it draws under its lines. */
function drawBlock(): { writing: WritingBlock; texts: string[] } {
  const texts: string[] = [];
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
        dismiss() {},
      } satisfies Composer;
    },
  };
  overview.blocks.set(KEY, writing);
  return { writing, texts };
}

/** Lets what's under way settle: what's queued, the page's nonce, and what React draws. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const unmounts: (() => void)[] = [];

/** The box drawn at the end of the timeline, once the page's nonce has come. */
async function drawBox(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<PullBox tab={tab()} leave={() => {}} />));
  unmounts.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await settle();
  return container;
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
  const box = await drawBox();
  expect(box.textContent).toContain(
    'Lo is still checking the overview. Your comment on the pull request opens under its code block if the overview still has it, or here if not.',
  );
  expect(editors.drawn).toEqual([]);
  // Checked, the overview has the block: the draft opens under it, as the box says.
  const block = drawBlock();
  await overviewChanged();
  expect(block.texts).toEqual(['On the pull request']);
  expect(box.textContent).toContain(
    'Your comment on the pull request is open under its code block in the overview.',
  );
  expect(editors.drawn).toEqual([]);
});

test('the draft it shows stays, with focus, while the overview is read again and checked without its block', async () => {
  overview.has.set(KEY, false);
  takeDrafts({ id: VIEW, drafts: [draft()] });
  await drawBox();
  const [drawn] = editors.drawn;
  expect(drawn?.field.value).toBe('On the pull request');
  drawn?.field.focus();
  overview.has.set(KEY, 'unknown');
  await overviewChanged();
  overview.has.set(KEY, false);
  await overviewChanged();
  expect(editors.drawn).toEqual([drawn]);
  expect(drawn?.dismissed).toBe(false);
  expect(document.activeElement).toBe(drawn?.field);
});

test('once the overview has its block again, the draft goes under it, though the block was drawn first', async () => {
  overview.has.set(KEY, false);
  takeDrafts({ id: VIEW, drafts: [draft()] });
  const box = await drawBox();
  const [drawn] = editors.drawn;
  // The block is drawn while the timeline still has the draft, which it leaves there.
  const block = drawBlock();
  restoreBlock(block.writing);
  await settle();
  expect(block.texts).toEqual([]);
  // The window hears the overview changed: the timeline lets the draft go, and the block takes it.
  await overviewChanged();
  expect(drawn?.dismissed).toBe(true);
  expect(block.texts).toEqual(['On the pull request']);
  expect(box.textContent).toContain(
    'Your comment on the pull request is open under its code block in the overview.',
  );
});
