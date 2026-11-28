// @vitest-environment jsdom
// Writing on a pull request itself, in the window: the box at the end of its timeline keeps the
// pull request's own draft, as main restored it, with how sending it stands; and your comments
// there are edited and deleted only where Lo would, others refused in Lo's words before anything
// is asked.

import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab, PullView } from '../../tab/window/shared.ts';
import type { DraftRow } from '../contract.ts';
import { deleteAsking, setAsking } from './acts.ts';
import type { Composer } from '@lo/ui/code';

import {
  act,
  type Box,
  catchUpDrafts,
  SAVE_AFTER,
  send,
  takeDrafts,
  timelineBox,
  timelineBoxes,
  timelineEvents,
} from './boxes.ts';
import { editOnPull, type PullComment, pullChangeRefusal, removeOnPull } from './conversation.ts';
import { onPull, readBeforeWith, settleOnPull } from './onpull.ts';
import { ON_PULL } from './writing.ts';

let VIEW = 'p0';

const said = vi.hoisted(() => ({ pull: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
  runOf: () => undefined,
}));

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
    shown: 'a'.repeat(40),
    newer: null,
    ...changes,
  };
}

/** The box at the end of the timeline, which the pull request's draft opens in now. */
function ownBox(): Box {
  const box = timelineBox(VIEW, ON_PULL);
  if (!box) throw new Error('The pull request’s draft opens elsewhere.');
  return box;
}

/**
 * Gives `box` an editor as the timeline draws one, empty, which tells the box of each change as it
 * comes, as CodeMirror's does.
 */
function drawn(box: Box): Composer {
  const events = timelineEvents(box, () => {});
  let text = '';
  const composer = {
    get text() {
      return text;
    },
    mode: 'insert',
    previewing: false,
    focus() {},
    insert() {},
    replace(from: number, to: number, put: string) {
      text = text.slice(0, from) + put + text.slice(to);
      events.change(text);
    },
    preview() {},
    hold() {},
    close() {},
    leave() {},
    dismiss() {},
    keep: () => ({ text, editor: undefined }),
    move: () => false,
  } satisfies Composer;
  box.composer = composer;
  return composer;
}

function tab(): PullTab {
  return { kind: 'pull', id: VIEW, owner: 'rozed-dev', repo: 'e2e', number: 94 };
}

function comment(changes: Partial<PullComment> = {}): PullComment {
  return {
    id: 'IC_1',
    author: 'rozed-bot',
    body: 'Looks right.',
    viewerCanUpdate: true,
    viewerCanDelete: true,
    ...changes,
  };
}

/** The pull request's own draft, as main keeps it. */
function draft(changes: Partial<DraftRow> = {}): DraftRow {
  return {
    place: ON_PULL,
    text: 'Ship it.',
    savedAt: 1,
    restored: true,
    sending: null,
    sent: null,
    sentAt: null,
    base: null,
    home: null,
    ...changes,
  };
}

beforeEach(() => {
  VIEW = `p${Number(VIEW.slice(1)) + 1}`;
  said.pull = pull();
  bridge.calls.length = 0;
  answers['comments.draft'] = () => undefined;
  answers['comments.discard'] = () => undefined;
});

afterEach(() => {
  setAsking(undefined);
});

describe('the box at the end of the timeline', () => {
  test('takes the pull request’s draft as main restored it, with how sending it stands', () => {
    // Drawn before main said anything.
    const box = ownBox();
    expect(box.state.text).toBe('');
    takeDrafts({
      id: VIEW,
      drafts: [draft({ sending: 'unknown', sent: 'Ship it.' })],
    });
    expect(timelineBoxes.get(VIEW).own).toBe(box);
    expect(box.state).toMatchObject({ text: 'Ship it.', sending: 'unknown' });
    expect(box.sentMark).toBe(true);
  });

  test('drawn first, it takes main’s draft without saving it again, still saying how it stands', () => {
    vi.useFakeTimers();
    const box = ownBox();
    const composer = drawn(box);
    takeDrafts({ id: VIEW, drafts: [draft({ sending: 'notPosted', savedAt: 7 })] });
    expect(composer.text).toBe('Ship it.');
    expect(box.state).toMatchObject({ text: 'Ship it.', sending: 'notPosted', restored: 7 });
    vi.advanceTimersByTime(SAVE_AFTER * 2);
    expect(bridge.calls.filter(([channel]) => channel === 'comments.draft')).toEqual([]);
    vi.useRealTimers();
  });

  test('a draft discarded stays so, though main’s drafts sent before it heard still hold it', () => {
    const box = ownBox();
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    expect(box.state.text).toBe('Ship it.');
    act(box, 'discard');
    const next = ownBox();
    expect(next).not.toBe(box);
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    expect(next.state.text).toBe('');
  });

  test('a post whose draft main took down before its answer came leaves the next box be', async () => {
    let answer!: (outcome: unknown) => void;
    answers['comments.send'] = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const box = ownBox();
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    const sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
    // Main marked it sent, then found it posted: its draft goes before the answer comes here.
    takeDrafts({
      id: VIEW,
      drafts: [draft({ restored: false, sending: 'sending', sent: 'Ship it.' })],
    });
    takeDrafts({ id: VIEW, drafts: [] });
    const next = ownBox();
    answer({ kind: 'sent', pending: false, joined: false, thread: null, landedOn: null });
    await sending;
    await vi.waitFor(() => expect(timelineBoxes.get(VIEW).own).toBe(next));
    expect(timelineBox(VIEW, ON_PULL)).toBe(next);
  });

  test('main’s drafts from before GitHub’s answer, coming after it, leave the next box be', async () => {
    let answer!: (outcome: unknown) => void;
    answers['comments.send'] = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const box = ownBox();
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    const sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
    // GitHub's answer comes before the drafts main sent on the way to it.
    answer({
      kind: 'sent',
      pending: false,
      joined: false,
      thread: null,
      landedOn: null,
      comment: 'IC_9',
    });
    await sending;
    const next = ownBox();
    expect(next).not.toBe(box);
    const composer = drawn(next);
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false, sending: 'sending' })] });
    takeDrafts({
      id: VIEW,
      drafts: [draft({ restored: false, sending: 'sending', sent: 'Ship it.', sentAt: 9_000 })],
    });
    takeDrafts({ id: VIEW, drafts: [] });
    expect(timelineBox(VIEW, ON_PULL)).toBe(next);
    expect(composer.text).toBe('');
    expect(next.state).toMatchObject({ text: '', sending: null, busy: false, landing: false });
    expect(next.sentMark).toBe(false);
    // The comment is on the timeline once, as what was sent.
    expect(onPull.get(VIEW)).toEqual([
      expect.objectContaining({ key: box.id, state: 'sent', copy: 'IC_9' }),
    ]);
    // What main sends after its answer is taken as ever.
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false, text: 'One more thing.' })] });
    expect(composer.text).toBe('One more thing.');
  });

  test('a draft whose text changed since it was sent comes back after GitHub’s answer', async () => {
    let answer!: (outcome: unknown) => void;
    answers['comments.send'] = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const box = ownBox();
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    const sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer({ kind: 'sent', pending: false, joined: false, thread: null, landedOn: null });
    await sending;
    const next = ownBox();
    const composer = drawn(next);
    // What main sent on the way to its answer comes after it, and changes nothing.
    takeDrafts({
      id: VIEW,
      drafts: [draft({ restored: false, sending: 'sending', sent: 'Ship it.', sentAt: 9_000 })],
    });
    expect(composer.text).toBe('');
    // Main keeps the draft, its text changed since it was sent, and says it's sent no more.
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false, text: 'Ship it, then.' })] });
    expect(composer.text).toBe('Ship it, then.');
    expect(next.state).toMatchObject({ text: 'Ship it, then.', sending: null });
  });

  test('refused before main’s drafts said it was on its way, the timeline lets the comment go once', async () => {
    let answer!: (outcome: unknown) => void;
    answers['comments.send'] = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const box = ownBox();
    const composer = drawn(box);
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    const sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(onPull.get(VIEW)).toHaveLength(1);
    answer({ kind: 'refused', refusal: { kind: 'github', message: 'GitHub refused it.' } });
    await sending;
    // The row goes as the answer comes, and what main said on the way to it brings it back nowhere.
    expect(onPull.get(VIEW)).toEqual([]);
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false, sending: 'sending' })] });
    takeDrafts({
      id: VIEW,
      drafts: [draft({ restored: false, sending: 'sending', sent: 'Ship it.', sentAt: 9_000 })],
    });
    expect(onPull.get(VIEW)).toEqual([]);
    expect(timelineBox(VIEW, ON_PULL)).toBe(box);
    expect(box.state).toMatchObject({ text: 'Ship it.', sending: null, busy: false });
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    expect(onPull.get(VIEW)).toEqual([]);
    expect(composer.text).toBe('Ship it.');
  });

  test('asks main for the drafts once, after a reload, though the box was drawn first', async () => {
    answers['comments.current'] = () => ({
      threads: undefined,
      review: undefined,
      drafts: { id: VIEW, drafts: [draft({ sending: 'notPosted' })] },
    });
    const box = ownBox();
    catchUpDrafts(VIEW);
    await vi.waitFor(() => expect(box.state).toMatchObject({ text: 'Ship it.' }));
    expect(box.state.sending).toBe('notPosted');
  });
});

describe('what the timeline draws of a comment sent', () => {
  test('a comment sent says when it went, and what the timeline on screen held then', async () => {
    readBeforeWith((view, text) => (view === VIEW ? { had: 2, after: `c-${text}` } : undefined));
    onTestFinished(() => readBeforeWith(() => undefined));
    let answer!: (outcome: unknown) => void;
    answers['comments.send'] = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const box = ownBox();
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    const sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(onPull.get(VIEW)).toMatchObject([
      {
        key: box.id,
        state: 'sending',
        text: 'Ship it.',
        send: 1,
        sentAt: undefined,
        before: { had: 2, after: 'c-Ship it.' },
      },
    ]);
    // Main says when it went, by GitHub's clock.
    takeDrafts({
      id: VIEW,
      drafts: [draft({ restored: false, sending: 'sending', sent: 'Ship it.', sentAt: 9_000 })],
    });
    expect(onPull.get(VIEW)).toMatchObject([{ send: 1, sentAt: 9_000 }]);
    // The timeline shows GitHub's copy before the answer comes: the answer brings nothing back.
    settleOnPull(VIEW, new Set([box.id]));
    answer({ kind: 'sent', pending: false, joined: false, thread: null, landedOn: null });
    await sending;
    expect(box.state.landing).toBe(true);
    expect(onPull.get(VIEW)).toEqual([]);
  });

  test('with nothing from before, as from an overview’s block, GitHub’s answer names its copy, though main’s drafts said it was taken first', async () => {
    let answer!: (outcome: unknown) => void;
    answers['comments.send'] = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const box = ownBox();
    takeDrafts({ id: VIEW, drafts: [draft({ restored: false })] });
    const sending = send(box, 'now');
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(onPull.get(VIEW)).toMatchObject([{ before: undefined, sentAt: undefined }]);
    // Main took it down as posted before its answer came here, not yet knowing GitHub's clock.
    takeDrafts({
      id: VIEW,
      drafts: [draft({ restored: false, sending: 'sending', sent: 'Ship it.' })],
    });
    takeDrafts({ id: VIEW, drafts: [] });
    expect(onPull.get(VIEW)).toMatchObject([{ state: 'sent', copy: undefined }]);
    answer({
      kind: 'sent',
      pending: false,
      joined: false,
      thread: null,
      landedOn: null,
      comment: 'IC_9',
    });
    await sending;
    expect(onPull.get(VIEW)).toMatchObject([{ state: 'sent', copy: 'IC_9' }]);
  });

  test('an edit says when GitHub answered it, by GitHub’s clock', async () => {
    answers['comments.editing'] = () => ({ kind: 'done' });
    answers['comments.edit'] = () => ({ kind: 'done', editedAt: 9_000 });
    await editOnPull(tab(), comment());
    const box = timelineBoxes.get(VIEW).edits.get('IC_1');
    if (!box) throw new Error('The edit’s box didn’t open.');
    box.set({ text: 'Looks right to me.' });
    await send(box, 'review');
    expect(onPull.get(VIEW)).toMatchObject([
      { comment: 'IC_1', text: 'Looks right to me.', state: 'sent', editedAt: 9_000 },
    ]);
  });

  test('one found on its way as Lo starts went when main says, with nothing from before', () => {
    ownBox();
    takeDrafts({
      id: VIEW,
      drafts: [draft({ sending: 'checking', sent: 'Ship it.', sentAt: 1234 })],
    });
    expect(onPull.get(VIEW)).toMatchObject([
      { state: 'checking', send: 0, sentAt: 1234, before: undefined },
    ]);
  });
});

describe('changing your comment on the pull request', () => {
  test('Lo refuses someone else’s comment, and one GitHub doesn’t let you change, in its words', () => {
    expect(pullChangeRefusal(comment(), 'Rozed-Bot', 'edit')).toBeUndefined();
    expect(pullChangeRefusal(comment({ author: 'ravi-k' }), 'rozed-bot', 'delete')).toBe(
      'This comment isn’t yours',
    );
    expect(pullChangeRefusal(comment({ author: undefined }), 'rozed-bot', 'edit')).toBe(
      'This comment isn’t yours',
    );
    expect(pullChangeRefusal(comment({ viewerCanUpdate: false }), 'rozed-bot', 'edit')).toBe(
      'rozed-bot can’t edit this comment',
    );
  });

  test('an edit starts from GitHub’s text, in the comment’s card, focused', async () => {
    answers['comments.editing'] = () => ({ kind: 'done' });
    await editOnPull(tab(), comment());
    expect(bridge.calls).toContainEqual([
      'comments.editing',
      { id: VIEW, place: { kind: 'edit', thread: null, comment: 'IC_1' }, base: 'Looks right.' },
    ]);
    const box = timelineBoxes.get(VIEW).edits.get('IC_1');
    expect(box?.state.text).toBe('Looks right.');
    expect(box?.focusOnOpen).toBe(true);
  });

  test('a delete asks first, and nothing is asked offline or of someone else’s comment', () => {
    removeOnPull(tab(), comment({ author: 'ravi-k' }));
    expect(deleteAsking()).toBeUndefined();
    expect(notice()?.title).toBe('This comment isn’t yours');
    said.pull = pull({
      connection: { kind: 'offline', retryAt: null, cause: { kind: 'timeout' }, error: 'reset' },
    });
    removeOnPull(tab(), comment());
    expect(deleteAsking()).toBeUndefined();
    // Worded by why, as the header's chip is: GitHub took the read and never answered.
    expect(notice()?.title).toBe('No response');
    said.pull = pull();
    removeOnPull(tab(), comment());
    expect(deleteAsking()).toMatchObject({ thread: null, comment: 'IC_1', body: 'Looks right.' });
    expect(bridge.calls).toEqual([]);
  });
});
