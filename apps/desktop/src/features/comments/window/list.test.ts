// The threads panel's list: what each filter lists and counts, where each row says its thread is,
// the groups in the left panel's order with each file's own threads first, and how the keyboard
// moves through the rows.

import { describe, expect, it } from 'vitest';

import type { ThreadCommentRow, ThreadRow } from '../contract.ts';
import {
  filterCounts,
  focusedIn,
  nextFilter,
  rowKeys,
  stepRow,
  threadGroups,
  whereOf,
  type ListOptions,
} from './list.ts';

const HEAD = 'h'.repeat(40);
const FIRST = 'f'.repeat(40);

function comment(overrides: Partial<ThreadCommentRow> = {}): ThreadCommentRow {
  return {
    id: 'C1',
    author: 'mira-chen',
    authorType: 'User',
    body: 'Fixture C: Is doubling enough?',
    state: 'SUBMITTED',
    createdAt: '2026-11-13T11:55:00Z',
    url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
    hidden: null,
    viewerCanUpdate: false,
    viewerCanDelete: false,
    ...overrides,
  };
}

/** A thread on `src/a.ts`'s new line 5, unresolved, with one comment by mira-chen. */
function row(id: string, overrides: Partial<ThreadRow> = {}): ThreadRow {
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
    currentOn: HEAD,
    writtenOn: HEAD,
    comments: [comment()],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...overrides,
  };
}

const label = (head: string) => (head === FIRST ? 'r1' : head === HEAD ? 'r2' : undefined);

/** Stands in for the background process's reading of a comment's opening as plain words. */
const plain = (markdown: string) =>
  markdown.replaceAll(/[*`_]/g, '').replaceAll(/\s+/g, ' ').trim();

function options(overrides: Partial<ListOptions> = {}): ListOptions {
  return { filter: 'all', viewer: 'rozed-bot', order: [], label, excerpt: plain, ...overrides };
}

describe('the filter', () => {
  it('counts the unresolved threads, your pending ones among them, all of them and yours', () => {
    const rows = [
      row('open'),
      row('resolved', { resolved: true }),
      row('pending', { comments: [comment({ author: 'rozed-bot', state: 'PENDING' })] }),
      row('replied', {
        resolved: true,
        comments: [comment(), comment({ id: 'C2', author: 'Rozed-Bot' })],
      }),
    ];
    expect(filterCounts(rows, 'rozed-bot')).toEqual({ unresolved: 2, all: 4, yours: 2 });
    // Nobody has no threads of their own.
    expect(filterCounts(rows, undefined)).toEqual({ unresolved: 2, all: 4, yours: 0 });
  });

  it('steps from unresolved to all to yours, and round', () => {
    expect(nextFilter('unresolved')).toBe('all');
    expect(nextFilter('all')).toBe('yours');
    expect(nextFilter('yours')).toBe('unresolved');
  });
});

describe('where a row says its thread is', () => {
  it('names the side and line, or the lines of a range', () => {
    expect(whereOf(row('a'), label)).toBe('new 5');
    expect(whereOf(row('a', { side: 'LEFT', line: 30 }), label)).toBe('old 30');
    expect(whereOf(row('a', { startLine: 39, line: 41 }), label)).toBe('new 39–41');
    expect(whereOf(row('a', { startLine: 41, line: 41 }), label)).toBe('new 41');
  });

  it('says a file’s own thread is on the file', () => {
    expect(whereOf(row('a', { subject: 'FILE', line: null }), label)).toBe('On the file');
  });

  it('names the revision an outdated thread was written on, and its line there', () => {
    const outdated = row('a', { outdated: true, line: null, originalLine: 22, writtenOn: FIRST });
    expect(whereOf(outdated, label)).toBe('r1 · line 22');
    expect(whereOf({ ...outdated, originalStartLine: 20 }, label)).toBe('r1 · lines 20–22');
    // A commit that's no revision Lo knows of.
    expect(whereOf({ ...outdated, writtenOn: 'c'.repeat(40) }, label)).toBe('line 22');
  });
});

describe('the groups', () => {
  it('go in the left panel’s order, then the files it doesn’t list, by path', () => {
    const rows = [
      row('z', { path: 'z.ts' }),
      row('b', { path: 'src/b.ts' }),
      row('a', { path: 'src/a.ts' }),
      row('y', { path: 'y.ts' }),
    ];
    const groups = threadGroups(rows, options({ order: ['src/b.ts', 'src/a.ts'] }));
    expect(groups.map((group) => group.label)).toEqual(['src/b.ts', 'src/a.ts', 'y.ts', 'z.ts']);
    expect(groups.every((group) => group.file === true)).toBe(true);
  });

  it('list a file’s own threads first, then by line, the old side first on one line', () => {
    const rows = [
      row('new 9', { line: 9, originalLine: 9 }),
      row('outdated 7', { outdated: true, line: null, originalLine: 7, writtenOn: FIRST }),
      row('file', { subject: 'FILE', line: null, originalLine: null }),
      row('old 9', { side: 'LEFT', line: 9, originalLine: 9 }),
      row('new 2', { line: 2, originalLine: 2 }),
    ];
    const [group] = threadGroups(rows, options());
    expect(group?.rows.map((each) => each.key)).toEqual([
      'file',
      'new 2',
      'outdated 7',
      'old 9',
      'new 9',
    ]);
  });

  it('list only what the filter lists', () => {
    const rows = [
      row('open'),
      row('resolved', { resolved: true }),
      row('mine', { resolved: true, comments: [comment({ author: 'rozed-bot' })] }),
    ];
    const keys = (filter: ListOptions['filter'], viewer: string | undefined) =>
      rowKeys(threadGroups(rows, options({ filter, viewer })));
    expect(keys('unresolved', 'rozed-bot')).toEqual(['open']);
    expect(keys('all', 'rozed-bot')).toEqual(['open', 'resolved', 'mine']);
    expect(keys('yours', 'rozed-bot')).toEqual(['mine']);
    expect(keys('yours', undefined)).toEqual([]);
  });

  it('give each row who started the thread, its replies, its state and its opening', () => {
    const rows = threadGroups(
      [
        row('a', {
          resolved: true,
          outdated: true,
          line: null,
          originalLine: 22,
          writtenOn: FIRST,
          comments: [
            comment({ body: '**Fixture C:**\n  Is   `doubling`\nenough?' }),
            comment({ id: 'C2' }),
            comment({ id: 'C3' }),
          ],
        }),
        row('b', { comments: [comment({ author: null, authorType: null, state: 'PENDING' })] }),
        row('c', { comments: [comment({ author: 'renovate', authorType: 'Bot' })] }),
      ],
      options(),
    ).flatMap((group) => group.rows);
    const listed = (key: string) => rows.find((each) => each.key === key);
    expect(listed('a')).toEqual({
      key: 'a',
      author: 'mira-chen',
      image: expect.stringContaining('mira-chen'),
      where: 'r1 · line 22',
      replies: 2,
      resolved: true,
      pending: false,
      outdated: true,
      excerpt: 'Fixture C: Is doubling enough?',
    });
    // A row shows the opening it's given for the first comment, never the comment's Markdown, and
    // none while that's still being read.
    const unread = threadGroups([row('a', { comments: [comment({ body: '**Bold**' })] })], {
      ...options(),
      excerpt: () => '',
    }).flatMap((group) => group.rows);
    expect(unread.map((each) => each.excerpt)).toEqual(['']);
    // A deleted account is GitHub's ghost, with no avatar; a pending thread says so.
    expect(listed('b')).toMatchObject({ author: 'ghost', image: undefined, pending: true });
    // A bot has no avatar of its own to load.
    expect(listed('c')).toMatchObject({ author: 'renovate', image: undefined });
  });
});

describe('the keyboard', () => {
  const keys = ['a', 'b', 'c'];

  it('is on the row it was put on while that’s listed, and else on the first', () => {
    expect(focusedIn(keys, 'b')).toBe('b');
    expect(focusedIn(keys, 'gone')).toBe('a');
    expect(focusedIn(keys, undefined)).toBe('a');
    expect(focusedIn([], 'b')).toBeUndefined();
  });

  it('moves a row at a time, stopping at the ends', () => {
    expect(stepRow(keys, 'a', 1)).toBe('b');
    expect(stepRow(keys, 'c', 1)).toBe('c');
    expect(stepRow(keys, 'a', -1)).toBe('a');
    expect(stepRow(keys, 'gone', 1)).toBe('a');
  });
});
