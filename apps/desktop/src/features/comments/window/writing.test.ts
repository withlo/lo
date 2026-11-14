// Where a comment on a line, a range or a file goes, as GitHub takes it and as its draft is kept;
// where one on a code block's lines goes, falling back to the file and then the pull request;
// where a draft's box goes in a diff as drawn; and what a box's frame says.

import { Line, Screen } from '@lo/review';
import { describe, expect, test } from 'vitest';

import type { DrawnDiff, ThreadedFile } from '../../diff/window/shared.ts';
import type { Commentable, DraftPlaceRow } from '../contract.ts';
import {
  actText,
  blockComment,
  blockWhere,
  boxAt,
  commentableOn,
  hunksOf,
  linesAt,
  notesOf,
  placeKey,
  placeOf,
  offersOf,
  refusalNote,
  restoredNote,
  sendingNote,
  sentFromBlock,
  whereText,
  whyOf,
} from './writing.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function file(overrides: Partial<ThreadedFile> = {}): ThreadedFile {
  return {
    id: 'f0',
    key: 'src/backoff.ts',
    path: 'src/backoff.ts',
    old: 'src/backoff.ts',
    since: false,
    ...overrides,
  };
}

const drawn: DrawnDiff = { at: HEAD, comparison: null, compareFrom: null, files: [file()] };

/**
 * One hunk from line 3 on both sides: two unchanged lines, one deleted (old 5), two added (new 5
 * and 6), one unchanged.
 */
const commentable: Commentable = { kind: 'diff', hunks: [{ old: 2, new: 2, kinds: '  -++ ' }] };

describe('the lines a comment goes on', () => {
  const takes = commentableOn(Screen.full(HEAD), commentable);

  test('a hunk row reads as the hunk it was', () => {
    const [hunk] = hunksOf(commentable.kind === 'diff' ? commentable.hunks : []);
    expect(hunk).toMatchObject({ old: { start: 2, end: 6 }, new: { start: 2, end: 7 } });
    expect(hunk!.lines.map((line) => line.kind)).toEqual([
      'unchanged',
      'unchanged',
      'deleted',
      'added',
      'added',
      'unchanged',
    ]);
  });

  test('a line of the diff takes one on its side; an unchanged line on the left goes right', () => {
    expect(linesAt(takes, { file: 'f0', side: 'new', line: 5 })).toEqual({
      end: { side: 'RIGHT', number: 5 },
    });
    expect(linesAt(takes, { file: 'f0', side: 'old', line: 5 })).toEqual({
      end: { side: 'LEFT', number: 5 },
    });
    expect(linesAt(takes, { file: 'f0', side: 'old', line: 3 })).toEqual({
      end: { side: 'RIGHT', number: 3 },
    });
  });

  test('a range takes one from its higher end; a line outside the hunks takes none', () => {
    expect(linesAt(takes, { file: 'f0', side: 'new', from: 6, to: 4 })).toEqual({
      start: { side: 'RIGHT', number: 4 },
      end: { side: 'RIGHT', number: 6 },
    });
    expect(linesAt(takes, { file: 'f0', side: 'new', line: 40 })).toBeUndefined();
    expect(linesAt(takes, { file: 'f0', side: 'new', from: 6, to: 40 })).toBeUndefined();
  });

  test('between revisions the older side takes none; with no patch, nothing but the file does', () => {
    const between = commentableOn(Screen.between(BASE, HEAD), commentable);
    expect(linesAt(between, { file: 'f0', side: 'old', line: 5 })).toBeUndefined();
    expect(commentableOn(Screen.full(HEAD), { kind: 'unknown' })).toBeUndefined();
    expect(linesAt(undefined, { file: 'f0', side: 'new', line: 5 })).toBeUndefined();
    expect(commentableOn(Screen.full(HEAD), { kind: 'notInDiff' })?.takesFileComment()).toBe(false);
  });
});

describe('a comment on a code block’s lines', () => {
  const takes = commentableOn(Screen.full(HEAD), commentable);
  const path = 'src/backoff.ts';

  test('goes on the lines at the head, where GitHub takes one on them', () => {
    expect(blockComment({ kind: 'lines', path, side: 'new', from: 4, to: 6 }, takes)).toEqual({
      kind: 'lines',
      lines: { start: { side: 'RIGHT', number: 4 }, end: { side: 'RIGHT', number: 6 } },
    });
    expect(blockComment({ kind: 'lines', path, side: 'new', from: 5, to: 5 }, takes)).toEqual({
      kind: 'lines',
      lines: { end: { side: 'RIGHT', number: 5 } },
    });
  });

  test('goes on the file where GitHub takes none on those lines, they changed, or Lo can’t tell', () => {
    expect(blockComment({ kind: 'lines', path, side: 'new', from: 30, to: 34 }, takes)).toEqual({
      kind: 'file',
      why: 'notInDiff',
    });
    expect(blockComment({ kind: 'lines', path, side: 'new', from: 4, to: 6 }, undefined)).toEqual({
      kind: 'file',
      why: 'noLines',
    });
    for (const why of ['changed', 'older', 'unknown'] as const) {
      expect(blockComment({ kind: 'file', path, why }, takes)).toEqual({ kind: 'file', why });
    }
  });

  test('goes on a file the pull request deletes, which GitHub still takes one on', () => {
    expect(blockComment({ kind: 'gone', path }, takes)).toEqual({ kind: 'file', why: 'deleted' });
  });

  test('goes on the pull request for a file it leaves alone, or one gone', () => {
    const untouched = commentableOn(Screen.full(HEAD), { kind: 'notInDiff' });
    expect(blockComment({ kind: 'lines', path, side: 'new', from: 4, to: 6 }, untouched)).toEqual({
      kind: 'pull',
      why: 'untouched',
    });
    expect(blockComment({ kind: 'gone', path }, untouched)).toEqual({ kind: 'pull', why: 'gone' });
    expect(blockComment({ kind: 'gone', path }, undefined)).toEqual({ kind: 'pull', why: 'gone' });
  });

  test('says where it goes and why, where that isn’t the block’s lines', () => {
    const names = { written: 'r1', now: 'r2' };
    const onFile = placeOf(HEAD, path, undefined);
    const words = (why: Parameters<typeof blockWhere>[0]) => blockWhere(why, onFile, names);
    expect(words('changed')).toBe('On the file, since these lines changed after r1');
    expect(words('notInDiff')).toBe(
      'On the file, since GitHub takes line comments only in the diff',
    );
    expect(words('noLines')).toBe(
      'On the file, since Lo couldn’t read which lines GitHub takes comments on',
    );
    expect(words('older')).toBe('On the file, since Lo maps only new-side lines from r1 to r2');
    expect(words('unknown')).toBe('On the file, since Lo can’t tell where these lines are at r2');
    expect(words('deleted')).toBe('On the file, which this pull request deletes');
    expect(words('untouched')).toBe('On the pull request, since it doesn’t change this file');
    expect(words('gone')).toBe('On the pull request, since this file is gone at r2');
    const lines = placeOf(HEAD, path, { end: Line.right(5) });
    expect(blockWhere(null, lines, { written: 'r2', now: 'r2' })).toBeUndefined();
    expect(blockWhere(null, lines, names)).toBe('On line 5, new side, at r2');
    expect(whyOf({ kind: 'lines', lines: { end: Line.right(5) } })).toBeNull();
    expect(whyOf({ kind: 'pull', why: 'gone' })).toBe('gone');
  });

  test('once sent, says where a comment that won’t show under the block went', () => {
    const names = { written: 'r1', now: 'r2' };
    expect(sentFromBlock({ kind: 'conversation' }, BASE, false, names)).toEqual({
      title: 'Posted on the pull request',
      body: 'It shows in the timeline.',
    });
    expect(sentFromBlock(placeOf(HEAD, path, undefined), BASE, true, names)).toEqual({
      title: 'Added to your review, on the file',
      body: 'src/backoff.ts. It shows under the file’s header in the diff.',
    });
    const lines = placeOf(HEAD, path, { end: Line.right(5) });
    expect(sentFromBlock(lines, HEAD, false, names)).toBeUndefined();
    expect(sentFromBlock(lines, BASE, false, names)).toEqual({
      title: 'Posted at r2',
      body: 'src/backoff.ts, on line 5, new side. It shows in the diff; this block shows r1.',
    });
  });

  test('a comment on the pull request says so, and has no box in the diff', () => {
    const onPull: DraftPlaceRow = { kind: 'conversation' };
    expect(whereText(onPull)).toBe('On the pull request');
    expect(boxAt(drawn, Screen.full(HEAD), onPull)).toBeUndefined();
    expect(placeKey(onPull)).not.toBe(placeKey(placeOf(drawn.at, 'src/backoff.ts', undefined)));
  });
});

describe('a draft’s place', () => {
  const onLines = placeOf(drawn.at, 'src/backoff.ts', {
    start: { side: 'RIGHT', number: 4 },
    end: { side: 'RIGHT', number: 6 },
  });

  test('is the head on screen, the path GitHub names, and the lines, or none for the file', () => {
    expect(onLines).toEqual({
      kind: 'thread',
      commit: HEAD,
      path: 'src/backoff.ts',
      lines: { start: { side: 'RIGHT', number: 4 }, end: { side: 'RIGHT', number: 6 } },
    });
    expect(placeOf(drawn.at, 'src/backoff.ts', undefined).lines).toBeNull();
    expect(placeKey(onLines)).toBe(placeKey({ ...onLines, commit: HEAD.toUpperCase() }));
    expect(placeKey(onLines)).not.toBe(placeKey({ ...onLines, lines: null }));
  });

  test('says where it is', () => {
    expect(whereText(onLines)).toBe('On lines 4–6, new side');
    expect(
      whereText({ ...onLines, lines: { start: null, end: { side: 'LEFT', number: 41 } } }),
    ).toBe('On line 41, old side');
    expect(whereText({ ...onLines, lines: null })).toBe('On the file');
    expect(whereText({ kind: 'reply', thread: 'T1' }, 'mira-chen')).toBe(
      'Reply to mira-chen’s thread',
    );
    expect(whereText({ kind: 'reply', thread: 'T1' }, null)).toBe('Reply to the thread');
    expect(whereText({ kind: 'edit', thread: 'T1', comment: 'C1' })).toBe('Edit your comment');
  });

  test('a reply’s is its thread’s, and an edit’s its comment’s, whatever the revision', () => {
    expect(placeKey({ kind: 'reply', thread: 'T1' })).not.toBe(
      placeKey({ kind: 'edit', thread: 'T1', comment: 'C1' }),
    );
  });
});

describe('where a draft’s box goes', () => {
  const place: DraftPlaceRow = {
    kind: 'thread',
    commit: HEAD,
    path: 'src/backoff.ts',
    lines: { start: { side: 'RIGHT', number: 4 }, end: { side: 'RIGHT', number: 6 } },
  };

  test('under its lines, or its file’s header, in a diff at its head', () => {
    expect(boxAt(drawn, Screen.full(HEAD), place)?.at).toEqual({
      file: 'f0',
      side: 'new',
      from: 4,
      to: 6,
    });
    expect(boxAt(drawn, Screen.full(HEAD), { ...place, lines: null })?.at).toEqual({ file: 'f0' });
    const across = { start: { side: 'LEFT' as const, number: 5 }, end: place.lines!.end };
    expect(boxAt(drawn, Screen.full(HEAD), { ...place, lines: across })?.at).toEqual({
      file: 'f0',
      side: 'new',
      line: 6,
    });
  });

  test('nowhere at another head, in another file, or on an older side that isn’t the base', () => {
    expect(boxAt({ ...drawn, at: BASE }, Screen.full(BASE), place)).toBeUndefined();
    expect(boxAt(drawn, Screen.full(HEAD), { ...place, path: 'src/other.ts' })).toBeUndefined();
    const left = { start: null, end: { side: 'LEFT' as const, number: 5 } };
    expect(boxAt(drawn, Screen.full(HEAD), { ...place, lines: left })?.at).toEqual({
      file: 'f0',
      side: 'old',
      line: 5,
    });
    expect(boxAt(drawn, Screen.between(BASE, HEAD), { ...place, lines: left })).toBeUndefined();
    const since = { ...drawn, files: [file({ since: true })] };
    expect(boxAt(since, Screen.full(HEAD), { ...place, lines: left })).toBeUndefined();
  });

  test('a reply’s, or an edit’s, right after its thread, while the diff has the thread', () => {
    const reply: DraftPlaceRow = { kind: 'reply', thread: 'T1' };
    expect(boxAt(drawn, Screen.full(HEAD), reply, (id) => id === 'T1')?.at).toEqual({
      thread: 'T1',
    });
    expect(boxAt(drawn, Screen.full(HEAD), reply)).toBeUndefined();
  });

  test('a renamed file’s draft is by its new path, and a deleted file’s by its old one', () => {
    const renamed = { ...drawn, files: [file({ path: 'src/retry.ts' })] };
    expect(boxAt(renamed, Screen.full(HEAD), { ...place, path: 'src/retry.ts' })).toBeDefined();
    const deleted = { ...drawn, files: [file({ path: null })] };
    expect(boxAt(deleted, Screen.full(HEAD), { ...place, lines: null })).toBeDefined();
  });
});

describe('a box’s notes', () => {
  const NOW = new Date(2026, 10, 13, 12, 0).getTime();

  test('a restored draft says when it was saved, and offers to discard it', () => {
    const yesterday = new Date(2026, 10, 12, 18, 40).getTime();
    const note = restoredNote(yesterday, NOW);
    expect(note.text).toMatch(/^Restored your draft from yesterday, .+\.$/);
    expect(note.offers).toEqual(['discard']);
  });

  test('a refusal says why, with what to do', () => {
    expect(refusalNote({ kind: 'notLatest', head: HEAD }).offers).toEqual(['showLatest']);
    expect(refusalNote({ kind: 'headMoved', head: null }).offers).toEqual(['loadNewer']);
    expect(refusalNote({ kind: 'notInDiff' }).offers).toEqual(['onFile']);
    const until = new Date(2026, 10, 13, 14, 5).getTime();
    expect(refusalNote({ kind: 'paused', until }).text).toMatch(
      /^GitHub asked Lo to hold off until .+\. Send it then\.$/,
    );
    expect(refusalNote({ kind: 'signIn' }).text).toBe('Sign in to comment');
    expect(refusalNote({ kind: 'run' }).text).toBe('Comment in a layer');
    expect(refusalNote({ kind: 'github', message: 'Nope.' }).text).toBe('Nope.');
  });

  test('what the notes offer, in their order, is what the box’s menu has', () => {
    const none = { restored: undefined, refusal: undefined, sending: null };
    expect(offersOf(none)).toEqual([]);
    expect(
      offersOf({ restored: 1, refusal: { kind: 'headMoved', head: null }, sending: 'unknown' }),
    ).toEqual(['discard', 'loadNewer', 'sendAnyway']);
    expect(offersOf({ ...none, refusal: { kind: 'paused', until: 0 } })).toEqual([]);
  });

  test('an edit’s refusals keep its text, and offer to discard it to start again', () => {
    const edit = { kind: 'edit', thread: 'T1', comment: 'C1' } as const;
    expect(
      notesOf({ place: edit, restored: undefined, refusal: { kind: 'changed' }, sending: null }, 0),
    ).toMatchObject([
      {
        text: 'It was edited on GitHub since you started. Your text is kept here; copy it, then edit again.',
        offers: ['discard'],
      },
    ]);
    expect(sendingNote('checking', true)?.text).toBe(
      'GitHub’s answer was lost. Lo is checking whether it saved the edit.',
    );
    expect(sendingNote('gone', true)?.offers).toEqual(['discard']);
    const until = new Date(2026, 10, 13, 14, 5).getTime();
    expect(refusalNote({ kind: 'paused', until }, 'edit').text).toMatch(/ Save it then\.$/);
  });

  test('a change to a thread that wasn’t made says why, in Lo’s words', () => {
    expect(actText({ kind: 'theirs', author: 'ravi-k' }, 'delete')).toBe(
      'It’s ravi-k’s comment. You can edit and delete only your own.',
    );
    expect(actText({ kind: 'notAllowed', reasons: ['LOCKED'] }, 'edit')).toBe(
      'GitHub doesn’t let you edit it: the conversation is locked.',
    );
    expect(actText({ kind: 'cantResolve', resolved: false }, 'unresolve')).toMatch(
      /^GitHub doesn’t let you unresolve this thread\./,
    );
    expect(actText({ kind: 'changed' }, 'delete')).toBe(
      'It changed on GitHub since you asked. Look at it again, then delete it.',
    );
  });

  test('sending says it waits, or what came of an answer that was lost', () => {
    expect(sendingNote(null)).toBeUndefined();
    expect(sendingNote('waiting')?.text).toBe('Waiting for your last comment');
    expect(sendingNote('notPosted')?.text).toBe('It didn’t post. Send it again.');
    expect(sendingNote('unknown')).toMatchObject({
      text: 'Lo can’t tell whether it posted.',
      offers: ['sendAnyway'],
    });
  });
});
