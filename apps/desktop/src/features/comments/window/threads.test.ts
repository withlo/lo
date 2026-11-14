// What a view's threads panel lists: main's threads once their openings are read, so a row is never
// drawn without its words and never moves as they come.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThreadCommentRow, ThreadRow, ThreadsView } from '../contract.ts';
import { excerptOf } from './excerpts.ts';
import { held, listed, takeThreads } from './threads.ts';

/** The reads of openings the background process was asked for, to answer when a test says. */
const reads: { bodies: string[]; answer: () => void; fail: () => void }[] = [];

vi.mock('./main.ts', () => ({
  main: () => ({ current: () => Promise.resolve({}) }),
  commentsJobs: () => ({
    excerpts: ({ bodies }: { bodies: string[] }) =>
      new Promise<string[]>((resolve, reject) => {
        reads.push({
          bodies,
          answer: () => resolve(bodies.map((body) => `words of ${body}`)),
          fail: () => reject(new Error('The process stopped.')),
        });
      }),
  }),
}));

function comment(body: string): ThreadCommentRow {
  return {
    id: `C_${body}`,
    author: 'mira-chen',
    authorType: 'User',
    body,
    state: 'SUBMITTED',
    createdAt: '2026-11-13T11:55:00Z',
    url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
    hidden: null,
    viewerCanUpdate: false,
    viewerCanDelete: false,
  };
}

function thread(id: string, body: string): ThreadRow {
  return {
    id,
    path: 'src/a.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line: 5,
    startLine: null,
    originalLine: 5,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: 'h'.repeat(40),
    writtenOn: 'h'.repeat(40),
    comments: [comment(body)],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
  };
}

let count = 0;
/** A fresh view's id, since the stores are the window's own. */
function fresh(): string {
  count += 1;
  return `view-${count}`;
}

function view(id: string, threads: ThreadRow[], status: ThreadsView['status'] = 'ready') {
  return { id, status, threads, missing: 0, compared: null, problem: null } satisfies ThreadsView;
}

/** Lets the asks that are due go to the background process. */
async function due(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  reads.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the threads a panel lists', () => {
  it('are main’s, once the openings of their first comments are read, never before', async () => {
    const id = fresh();
    const sent = view(id, [thread('T1', '**First**'), thread('T2', 'Second')]);
    expect(takeThreads(sent)).toBe(true);
    // Held for everything else at once, and not yet for the panel.
    expect(held.get(id).threads).toBe(sent);
    expect(listed.get(id)).toBeUndefined();
    await due();
    expect(reads.map((each) => each.bodies)).toEqual([['**First**', 'Second']]);
    expect(listed.get(id)).toBeUndefined();
    reads[0]?.answer();
    await due();
    expect(listed.get(id)).toBe(sent);
    // Every row has its words as it first draws.
    expect(excerptOf('**First**')).toBe('words of **First**');
    expect(excerptOf('Second')).toBe('words of Second');
  });

  it('come at once when their openings are read already, as for threads sent again', async () => {
    const id = fresh();
    takeThreads(view(id, [thread('T1', 'Once read')]));
    await due();
    reads[0]?.answer();
    await due();
    const again = view(id, [thread('T1', 'Once read'), thread('T2', 'Once read')]);
    takeThreads(again);
    expect(listed.get(id)).toBe(again);
    expect(reads).toHaveLength(1);
  });

  it('keep the last list while an edited comment’s opening is read, then change in one step', async () => {
    const id = fresh();
    const before = view(id, [thread('T1', 'Old words')]);
    takeThreads(before);
    await due();
    reads[0]?.answer();
    await due();
    expect(listed.get(id)).toBe(before);
    const edited = view(id, [thread('T1', 'New words')]);
    takeThreads(edited);
    // The panel keeps the row as it was, with its words, while the new ones are read.
    expect(held.get(id).threads).toBe(edited);
    expect(listed.get(id)).toBe(before);
    await due();
    expect(listed.get(id)).toBe(before);
    reads[1]?.answer();
    await due();
    expect(listed.get(id)).toBe(edited);
    expect(excerptOf('New words')).toBe('words of New words');
  });

  it('are only the newest: older threads, whose openings are read after, never take the panel', async () => {
    const id = fresh();
    const older = view(id, [thread('T1', 'Older')]);
    const newer = view(id, [thread('T1', 'Newer')]);
    takeThreads(older);
    await due();
    // Sent again while the older's openings are read, which one ask at a time makes the newer's wait.
    takeThreads(newer);
    reads[0]?.answer();
    await due();
    expect(listed.get(id)).toBeUndefined();
    expect(held.get(id).threads).toBe(newer);
    await due();
    reads[1]?.answer();
    await due();
    expect(listed.get(id)).toBe(newer);
  });

  it('come anyway when their openings can’t be read, which would otherwise leave the panel empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = fresh();
    const sent = view(id, [thread('T1', 'Unreadable')]);
    takeThreads(sent);
    await due();
    reads[0]?.fail();
    await due();
    expect(listed.get(id)).toBe(sent);
    expect(excerptOf('Unreadable')).toBe('');
  });

  it('come at once for a view with none to read: still loading, a run, signed out or failed', () => {
    for (const status of ['loading', 'run', 'signIn', 'failed'] as const) {
      const id = fresh();
      const sent = view(id, [], status);
      takeThreads(sent);
      expect(listed.get(id)).toBe(sent);
    }
    // A comment with no words has nothing to read.
    const id = fresh();
    const bare = view(id, [thread('T1', '  ')]);
    takeThreads(bare);
    expect(listed.get(id)).toBe(bare);
    expect(reads).toHaveLength(0);
  });
});
