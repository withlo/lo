// @vitest-environment jsdom
// The comment boxes of a view's diff: opened from `c`, `C` and `s`, refused where GitHub takes no
// comment, restored from main's drafts, saved as they're typed in, and closed once what they sent
// is on GitHub.

import type { BoxFrame, Composer, ComposerEvents, ComposeOptions } from '@lo/ui/code';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type { DrawnDiff, WritingDiff } from '../../diff/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab, PullView } from '../../tab/window/shared.ts';
import type { Commentable, DraftPlaceRow, DraftRow, SendOutcome } from '../contract.ts';
import {
  act,
  canWrite,
  comment,
  frameWith,
  keepBoxesOf,
  offering,
  restore,
  SAVE_AFTER,
  send,
  takeDrafts,
  takeOffer,
  type Box,
} from './boxes.ts';
import { landed } from './landed.ts';
import { NEW_SIDE_ONLY, NO_LINES, NOT_IN_DIFF } from './writing.ts';

const HEAD = 'a'.repeat(40);
let VIEW = 'v0';

const said = vi.hoisted(() => ({ pull: undefined as unknown, run: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
  runOf: () => said.run,
}));

/** A box the fake diff drew, with the events it was given. */
interface Drawn {
  at: unknown;
  on: ComposerEvents;
  options: ComposeOptions | undefined;
  composer: Composer & { text: string; held: boolean; closed?: 'close' | 'dismiss' };
}

const diff = vi.hoisted(() => ({
  current: undefined as unknown,
  keys: true,
  shown: [] as string[],
}));
vi.mock('../../diff/window/shared.ts', () => ({
  writingDiff: (_view: string, keys = false) => (keys && !diff.keys ? undefined : diff.current),
  showDiff: (view: string) => diff.shown.push(view),
}));

/** A diff that draws boxes, as the code view does, but for lines it doesn't draw yet. */
function fakeDiff(missing: (at: unknown) => boolean = () => false) {
  const drawn: Drawn[] = [];
  const vim = vi.fn<(keys: readonly string[]) => void>();
  const shown: DrawnDiff = {
    at: HEAD,
    comparison: null,
    compareFrom: null,
    files: [
      {
        id: 'f0',
        key: 'src/backoff.ts',
        path: 'src/backoff.ts',
        old: 'src/backoff.ts',
        since: false,
      },
    ],
  };
  const writing: WritingDiff = {
    drawn: () => shown,
    lines: (span) =>
      Array.from({ length: span.to - span.from + 1 }, (_, at) => `line ${span.from + at}`),
    compose(at, draft, on, frame?: BoxFrame, options?: ComposeOptions) {
      if (missing(at)) throw new Error('A comment box goes under a line of a file that is shown.');
      const open = drawn.find(
        (each) => JSON.stringify(each.at) === JSON.stringify(at) && !each.composer.closed,
      );
      if (open) return open.composer;
      const composer = {
        text: draft,
        mode: 'insert' as const,
        previewing: false,
        focus: vi.fn<() => void>(),
        insert: vi.fn<(text: string) => void>(),
        replace(from: number, to: number, text: string) {
          composer.text = composer.text.slice(0, from) + text + composer.text.slice(to);
          on.change(composer.text);
        },
        preview: vi.fn<(on: boolean) => void>(),
        held: false,
        hold(held: boolean) {
          composer.held = held;
        },
        close() {
          composer.closed = 'close';
        },
        dismiss() {
          composer.closed = 'dismiss';
        },
      } as Drawn['composer'];
      drawn.push({ at, on, options, composer });
      return composer;
    },
    toTop: () => true,
    vim,
  };
  diff.current = writing;
  return { drawn, writing, vim };
}

const answers: Record<string, (input: unknown) => unknown> = {};
const bridge = installBridge(answers);

function pull(changes: Partial<PullView> = {}): PullView {
  return {
    id: VIEW,
    loading: false,
    acting: { kind: 'account', login: 'rozed-bot' },
    header: null,
    connection: { kind: 'live' },
    problem: null,
    shown: HEAD,
    newer: null,
    ...changes,
  };
}

function tab(): PullTab {
  return { kind: 'pull', id: VIEW, owner: 'rozed-dev', repo: 'e2e', number: 94 };
}

/** One hunk from line 3: two unchanged, one deleted, two added, one unchanged. */
const IN_DIFF: Commentable = { kind: 'diff', hunks: [{ old: 2, new: 2, kinds: '  -++ ' }] };

function onLines(start: number | null, end: number): DraftPlaceRow {
  return {
    kind: 'thread',
    commit: HEAD,
    path: 'src/backoff.ts',
    lines: {
      start: start === null ? null : { side: 'RIGHT', number: start },
      end: { side: 'RIGHT', number: end },
    },
  };
}

function row(place: DraftPlaceRow, text: string, changes: Partial<DraftRow> = {}): DraftRow {
  return { place, text, savedAt: 0, restored: false, sending: null, sent: null, ...changes };
}

/** The requests to `channel` made so far. */
function asked(channel: string): unknown[] {
  return bridge.calls.filter(([name]) => name === channel).map(([, input]) => input);
}

let views = 0;

/** Each box as it's drawn: the frame it'd get is where its state is read. */
const boxesSeen: Box[] = [];
frameWith((box) => {
  boxesSeen.push(box);
  return undefined;
});

beforeEach(() => {
  VIEW = `v${++views}`;
  said.pull = pull();
  said.run = undefined;
  diff.keys = true;
  bridge.calls.length = 0;
  answers['comments.commentable'] = () => IN_DIFF;
  answers['comments.draft'] = () => undefined;
  answers['comments.discard'] = () => undefined;
});

afterEach(() => {
  keepBoxesOf(new Set());
  vi.useRealTimers();
});

describe('opening a box', () => {
  test('`c` on a line of the diff opens a focused box under it, where GitHub puts the thread', async () => {
    const { drawn } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.at).toEqual({ file: 'f0', side: 'new', line: 5 });
    expect(drawn[0]!.options).toEqual({ focus: true, name: expect.any(String) });
    expect(asked('comments.commentable')).toEqual([
      { id: VIEW, commit: HEAD, path: 'src/backoff.ts', previous: null },
    ]);
  });

  test('`v` then `c` opens it under the range’s last line; `c` on a header, on the file', async () => {
    const { drawn } = fakeDiff();
    await comment(
      tab(),
      { kind: 'line', at: { file: 'f0', side: 'new', from: 6, to: 4 } },
      'review',
    );
    await comment(tab(), { kind: 'header', file: 'f0', side: 'old' }, 'now');
    expect(drawn.map((each) => each.at)).toEqual([
      { file: 'f0', side: 'new', from: 4, to: 6 },
      { file: 'f0' },
    ]);
  });

  test('a line GitHub takes no comment on says so, and then `⏎` comments on the file', async () => {
    const { drawn, vim } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 40 } }, 'review');
    expect(drawn).toEqual([]);
    expect(notice()?.body).toBe(NOT_IN_DIFF);
    expect(takeOffer(tab())).toBe(true);
    await vi.waitFor(() => expect(drawn.map((each) => each.at)).toEqual([{ file: 'f0' }]));
    // Once taken, `⏎` is Vim's again.
    expect(takeOffer(tab())).toBe(false);
    expect(vim).not.toHaveBeenCalled();
  });

  test('a file whose lines Lo couldn’t read says so, `⏎` comments on the file, and it asks again', async () => {
    const { drawn } = fakeDiff();
    answers['comments.commentable'] = () => ({ kind: 'unknown' });
    const line = { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } } as const;
    await comment(tab(), line, 'review');
    expect(drawn).toEqual([]);
    expect(notice()?.body).toBe(NO_LINES);
    expect(takeOffer(tab())).toBe(true);
    await vi.waitFor(() => expect(drawn.map((each) => each.at)).toEqual([{ file: 'f0' }]));
    // Main can tell now: the line takes its comment.
    answers['comments.commentable'] = () => IN_DIFF;
    await comment(tab(), line, 'review');
    expect(drawn.map((each) => each.at)).toEqual([
      { file: 'f0' },
      { file: 'f0', side: 'new', line: 5 },
    ]);
  });

  test('`s` opens the lines in a suggestion block; on the older side it refuses', async () => {
    const { drawn } = fakeDiff();
    await comment(
      tab(),
      { kind: 'line', at: { file: 'f0', side: 'new', from: 4, to: 5 } },
      'review',
      true,
    );
    expect(drawn[0]!.composer.text).toBe('```suggestion\nline 4\nline 5\n```');
    await comment(
      tab(),
      { kind: 'line', at: { file: 'f0', side: 'old', line: 5 } },
      'review',
      true,
    );
    expect(notice()?.body).toBe(NEW_SIDE_ONLY);
    expect(drawn).toHaveLength(1);
  });

  test('a view acting as nobody, or a run of layers, can’t write', () => {
    expect(canWrite(VIEW)).toBe(true);
    said.pull = pull({ acting: { kind: 'anonymous' } });
    expect(canWrite(VIEW)).toBe('Sign in to comment');
    said.pull = pull();
    said.run = { layers: [1, 2] };
    expect(canWrite(VIEW)).toBe('Comment in a layer');
  });
});

describe('drafts', () => {
  test('typing saves 300 ms after it stops; Esc Esc saves at once and keeps the box shut', async () => {
    vi.useFakeTimers();
    const { drawn } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    const { on } = drawn[0]!;
    on.change('Hel');
    on.change('Hello');
    vi.advanceTimersByTime(SAVE_AFTER - 1);
    expect(asked('comments.draft')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(asked('comments.draft')).toEqual([{ id: VIEW, place: onLines(null, 5), text: 'Hello' }]);
    on.change('Hello there');
    on.close(true);
    expect(asked('comments.draft')).toHaveLength(2);
    restore(VIEW);
    expect(drawn).toHaveLength(1);
  });

  test('a box closed with nothing in it takes its draft with it', async () => {
    const { drawn } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    drawn[0]!.on.close(false);
    expect(asked('comments.draft')).toEqual([{ id: VIEW, place: onLines(null, 5), text: '' }]);
  });

  test('a draft restored as Lo started reopens unfocused once its line is drawn', async () => {
    vi.useFakeTimers();
    let ready = false;
    const { drawn } = fakeDiff(() => !ready);
    takeDrafts({ id: VIEW, drafts: [row(onLines(4, 6), 'Kept', { restored: true, savedAt: 1 })] });
    expect(drawn).toEqual([]);
    ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      at: { file: 'f0', side: 'new', from: 4, to: 6 },
      options: { focus: false },
    });
    expect(drawn[0]!.composer.text).toBe('Kept');
  });

  test('“Discard” on a restored draft drops it and its box, which sent nothing', () => {
    const { drawn } = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    const box = boxIn(drawn[0]!);
    expect(box.state.restored).toBe(1);
    act(box, 'discard');
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(asked('comments.discard')).toEqual([{ id: VIEW, place: onLines(null, 5) }]);
    // Drafts main sent before it heard still hold it; they don't bring it back.
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    expect(drawn).toHaveLength(1);
    // Once main says it's gone, a draft there later is a new one.
    takeDrafts({ id: VIEW, drafts: [] });
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'New', { restored: true, savedAt: 2 })],
    });
    expect(drawn).toHaveLength(2);
    expect(drawn[1]!.composer.text).toBe('New');
  });

  test('after the window loads again, each draft’s box comes back, unfocused, saying so', () => {
    const { drawn } = fakeDiff();
    takeDrafts({ id: VIEW, drafts: [row(onLines(null, 5), 'Kept', { savedAt: 1 })] });
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      at: { file: 'f0', side: 'new', line: 5 },
      options: { focus: false },
    });
    expect(boxIn(drawn[0]!).state.restored).toBe(1);
    // A draft heard of after, as one kept with `Esc Esc` in another tab, stays shut.
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(null, 5), 'Kept', { savedAt: 1 }),
        row(onLines(null, 7), 'Shut', { savedAt: 2 }),
      ],
    });
    expect(drawn).toHaveLength(1);
  });

  test('what a box’s notes offer is a command on the box, there only while it offers it', () => {
    const { drawn } = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    const target = { kind: 'box', box: boxIn(drawn[0]!).id } as const;
    const discard = offering('discard');
    const sendAnyway = offering('sendAnyway');
    expect(discard.listed?.(target)).toBe(true);
    expect(discard.enabled?.(target)).toBe(true);
    expect(sendAnyway.listed?.(target)).toBe(false);
    expect(sendAnyway.enabled?.(target)).toBe('“Send it anyway” isn’t offered in this box now.');
    void discard.run(target);
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(asked('comments.discard')).toEqual([{ id: VIEW, place: onLines(null, 5) }]);
    // The box is gone, and so is what it offered.
    expect(discard.listed?.(target)).toBe(false);
  });

  test('a box the diff took down as it was drawn again opens again with it', async () => {
    const first = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    first.drawn[0]!.on.change('Mine');
    // The diff drew its boxes' frames; the fake has none, so it's taken down by hand.
    const box = boxIn(first.drawn[0]!);
    box.composer = undefined;
    const second = fakeDiff();
    restore(VIEW);
    expect(second.drawn.map((each) => each.composer.text)).toEqual(['Mine']);
  });
});

/** The box behind a box the fake diff drew, through the frame it'd get. */
function boxIn(drawn: Drawn): Box {
  let found: Box | undefined;
  for (const each of boxesSeen) if (each.composer === drawn.composer) found = each;
  if (!found) throw new Error('No box has that composer.');
  return found;
}

/** A box opened with `c` on a line, with text in it. */
async function opened() {
  const fake = fakeDiff();
  await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
  fake.drawn[0]!.on.change('Ship it?');
  return { ...fake, box: boxIn(fake.drawn[0]!) };
}

describe('sending', () => {
  test('sent, the box closes as after a send, and a thread on a newer push is marked', async () => {
    const { drawn, box } = await opened();
    const outcome: SendOutcome = {
      kind: 'sent',
      pending: true,
      joined: false,
      thread: 'T_1',
      landedOn: { head: null },
    };
    answers['comments.send'] = () => outcome;
    await send(box, 'review');
    expect(asked('comments.send')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: 'Ship it?', how: 'review' },
    ]);
    expect(drawn[0]!.composer.closed).toBe('close');
    expect(landed.get(VIEW).has('T_1')).toBe(true);
  });

  test('while it’s sent, and until Lo knows whether it posted, its text is held', async () => {
    const { drawn, box } = await opened();
    let answer!: (outcome: SendOutcome) => void;
    answers['comments.send'] = () =>
      new Promise<SendOutcome>((resolve) => {
        answer = resolve;
      });
    const sending = send(box, 'review');
    expect(drawn[0]!.composer.held).toBe(true);
    answer({ kind: 'refused', refusal: { kind: 'paused', until: 1 } });
    await sending;
    expect(drawn[0]!.composer.held).toBe(false);
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'checking', sent: 'Ship it?' })],
    });
    expect(drawn[0]!.composer.held).toBe(true);
  });

  test('refused, the box stays with why; offline, nothing sends', async () => {
    const { drawn, box } = await opened();
    answers['comments.send'] = () => ({ kind: 'refused', refusal: { kind: 'notInDiff' } });
    await send(box, 'now');
    expect(box.state.refusal).toEqual({ kind: 'notInDiff' });
    expect(drawn[0]!.composer.closed).toBeUndefined();
    said.pull = pull({ connection: { kind: 'offline', savedAt: null, retryAt: null, error: '' } });
    await send(box, 'review');
    expect(asked('comments.send')).toHaveLength(1);
  });

  test('“Comment on the file” moves the text to a box on the file', async () => {
    const { drawn, box } = await opened();
    act(box, 'onFile');
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(drawn[1]!.at).toEqual({ file: 'f0' });
    expect(drawn[1]!.composer.text).toBe('Ship it?');
  });

  test('once main finds what a lost answer was to on GitHub, the box closes', async () => {
    const { drawn } = await opened();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'checking', sent: 'Ship it?' })],
    });
    expect(drawn[0]!.composer.closed).toBeUndefined();
    takeDrafts({ id: VIEW, drafts: [] });
    expect(drawn[0]!.composer.closed).toBe('close');
  });
});
