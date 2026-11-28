// Where a comment on a line, a range or a file goes, as GitHub takes it and as its draft is kept;
// where one on a code block's lines goes, falling back to the file and then the pull request;
// where a draft's box goes in a diff as drawn; and what a box's frame says.

import { Line, Lines, Screen } from '@lo/review';
import { describe, expect, test } from 'vitest';

import type { DrawnDiff, ThreadedFile } from '../../diff/window/shared.ts';
import type { Commentable, DraftPlaceRow } from '../contract.ts';
import {
  actText,
  blockComment,
  blockWhere,
  boxAt,
  changedLines,
  commentableOn,
  commentedOn,
  commentOnText,
  draftOn,
  hunksOf,
  linesAt,
  NO_LINE_ABOVE,
  NO_LINE_BELOW,
  notesOf,
  ONE_LINE,
  placeKey,
  placeOf,
  offersOf,
  refusalNote,
  sendingNote,
  sentFromBlock,
  sentLabel,
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
    expect(words('changed')).toEqual(onTheFile('These lines changed since r1.'));
    expect(words('notInDiff')).toEqual(onTheFile('Those lines aren’t in the diff.'));
    expect(words('noLines')).toEqual(onTheFile('Couldn’t check which lines take comments.'));
    expect(words('older')).toEqual(onTheFile('Removed lines can’t be followed to r2.'));
    // Where the lines are now isn't known, and it says that much, not that they changed.
    expect(words('unknown')).toEqual(onTheFile('Couldn’t follow these lines to r2.'));
    expect(words('deleted')).toEqual(onTheFile('This pull request deletes this file.'));
    expect(words('untouched')).toEqual({
      head: 'Pull request',
      why: 'This pull request doesn’t change this file.',
    });
    expect(words('gone')).toEqual({ head: 'Pull request', why: 'This file is deleted in r2.' });
    const lines = placeOf(HEAD, path, { end: Line.right(5) });
    expect(blockWhere(null, lines, { written: 'r2', now: 'r2' })).toBeUndefined();
    expect(blockWhere(null, lines, names)).toEqual({ head: 'Line 5 · r2' });
    expect(whyOf({ kind: 'lines', lines: { end: Line.right(5) } })).toBeNull();
    expect(whyOf({ kind: 'pull', why: 'gone' })).toBe('gone');
  });

  test('once sent, says where a comment that won’t show under the block went', () => {
    const names = { written: 'r1', now: 'r2', pull: '#264' };
    expect(sentFromBlock({ kind: 'conversation' }, BASE, false, names)).toEqual({
      title: 'Sent comment on #264',
      body: '',
    });
    expect(sentFromBlock(placeOf(HEAD, path, undefined), BASE, true, names)).toEqual({
      title: 'Added comment on backoff.ts to review',
      body: '',
    });
    expect(sentFromBlock(placeOf(HEAD, path, undefined), BASE, false, names)).toEqual({
      title: 'Sent comment on backoff.ts',
      body: '',
    });
    const lines = placeOf(HEAD, path, { end: Line.right(5) });
    expect(sentFromBlock(lines, HEAD, false, names)).toBeUndefined();
    expect(sentFromBlock(lines, BASE, false, names)).toEqual({
      title: 'Sent comment at r2',
      body: '',
    });
    expect(sentFromBlock(lines, BASE, true, names)).toEqual({
      title: 'Added comment at r2 to review',
      body: '',
    });
  });

  test('a comment on the pull request says so, and has no box in the diff', () => {
    const onPull: DraftPlaceRow = { kind: 'conversation' };
    expect(whereText(onPull)).toBe('Pull request');
    expect(boxAt(drawn, Screen.full(HEAD), onPull)).toBeUndefined();
    expect(placeKey(onPull)).not.toBe(placeKey(placeOf(drawn.at, 'src/backoff.ts', undefined)));
  });
});

/** What a box says of a comment that goes on the file, and `why`. */
function onTheFile(why: string): { head: string; why: string } {
  return { head: 'File', why };
}

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
    const on = (lines: NonNullable<typeof onLines.lines>) => whereText({ ...onLines, lines });
    expect(whereText(onLines)).toBe('Lines 4–6');
    expect(on({ start: null, end: { side: 'RIGHT', number: 3 } })).toBe('Line 3');
    // A removed line says so; a line the pull request has says nothing more.
    expect(on({ start: null, end: { side: 'LEFT', number: 41 } })).toBe('Line 41, removed');
    expect(on({ start: { side: 'LEFT', number: 39 }, end: { side: 'LEFT', number: 41 } })).toBe(
      'Lines 39–41, removed',
    );
    expect(on({ start: { side: 'LEFT', number: 3 }, end: { side: 'RIGHT', number: 5 } })).toBe(
      'Line 3, removed, to line 5',
    );
    expect(whereText({ ...onLines, lines: null })).toBe('File');
    expect(whereText({ kind: 'reply', thread: 'T1' })).toBe('Reply');
    expect(whereText({ kind: 'edit', thread: 'T1', comment: 'C1' })).toBe('Edit');
  });

  test('names the lines selected on Comment’s row of their menu, as a box on them says them', () => {
    const span = { file: 'f1', side: 'new' as const, from: 35, to: 38 };
    expect(commentOnText(span, undefined)).toBe('Comment on lines 35–38');
    expect(commentOnText({ ...span, side: 'old' }, undefined)).toBe(
      'Comment on lines 35–38, removed',
    );
    // Where an unchanged line picked in the older column goes on the newer.
    expect(commentOnText({ ...span, side: 'old' }, 'Line 35, removed, to line 40')).toBe(
      'Comment on line 35, removed, to line 40',
    );
  });

  test('the commands that comment take the lines selected a right-click was inside, and the rest what it was on', () => {
    const clicked = { file: 'f1', side: 'new' as const, line: 36, column: 4 };
    const selected = { file: 'f1', side: 'new' as const, from: 35, to: 38 };
    expect(commentedOn({ kind: 'line', at: clicked, selected })).toEqual({
      kind: 'line',
      at: selected,
    });
    expect(commentedOn({ kind: 'line', at: clicked })).toEqual({ kind: 'line', at: clicked });
    const header = { kind: 'header' as const, file: 'f1', side: 'new' as const };
    expect(commentedOn(header)).toBe(header);
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
  test('a refusal says what wasn’t sent and why, with what to do', () => {
    expect(refusalNote({ kind: 'notLatest', head: HEAD })).toMatchObject({
      title: 'Couldn’t send the comment',
      text: 'This revision is out of date.',
      offers: ['showLatest'],
    });
    expect(refusalNote({ kind: 'headMoved', head: null }).offers).toEqual(['loadNewer']);
    // Lines that take no comment: one line, one button, and no title.
    const outside = refusalNote({ kind: 'notInDiff' });
    expect(outside).toMatchObject({
      tone: 'warning',
      text: 'Those lines aren’t in the diff.',
      offers: ['onFile'],
    });
    expect(outside.title).toBeUndefined();
    const until = new Date(2026, 10, 13, 14, 5).getTime();
    expect(refusalNote({ kind: 'paused', until }).text).toMatch(
      /^GitHub’s rate limit resets at .+\.$/,
    );
    // Nothing was sent, so it can go again: what failed was a read.
    expect(refusalNote({ kind: 'pendingUnknown' })).toMatchObject({
      tone: 'danger',
      title: 'Couldn’t send the comment',
      text: 'Couldn’t check for a pending review.',
      offers: ['sendAgain'],
    });
    expect(refusalNote({ kind: 'signIn' }).text).toBe('Sign in to comment');
    expect(refusalNote({ kind: 'run' }).text).toBe('Show a single layer to comment');
    expect(refusalNote({ kind: 'github', message: 'Nope.' })).toMatchObject({
      title: 'Couldn’t send the comment',
      text: 'Nope.',
    });
  });

  test('what the notes offer, in their order, is what the box’s menu has', () => {
    const none = { refusal: undefined, sending: null };
    expect(offersOf(none)).toEqual([]);
    // A draft restored has no note: the foot says so, beside "Discard draft".
    expect(offersOf({ refusal: { kind: 'headMoved', head: null }, sending: 'unknown' })).toEqual([
      'loadNewer',
      'checkAgain',
    ]);
    expect(offersOf({ ...none, refusal: { kind: 'paused', until: 0 } })).toEqual([]);
  });

  test('an edit’s refusals keep its text, and offer to discard it to start again', () => {
    const edit = { kind: 'edit', thread: 'T1', comment: 'C1' } as const;
    expect(notesOf({ place: edit, refusal: { kind: 'changed' }, sending: null })).toMatchObject([
      {
        title: 'Couldn’t save the comment',
        text: 'It was edited elsewhere.',
        offers: ['discard'],
      },
    ]);
    expect(sendingNote('gone', true)).toMatchObject({
      text: 'It was deleted elsewhere.',
      offers: ['discard'],
    });
    expect(refusalNote({ kind: 'noBase' }, 'edit')).toMatchObject({
      title: 'Couldn’t save the comment',
      text: 'The comment’s earlier text is missing.',
      offers: ['discard'],
    });
    expect(refusalNote({ kind: 'paused', until: 0 }, 'edit').title).toBe(
      'Couldn’t save the comment',
    );
  });

  test('a change to a thread that wasn’t made says why, in Lo’s words', () => {
    expect(actText({ kind: 'theirs', author: 'ravi-k' }, 'delete')).toBe(
      'This comment isn’t yours',
    );
    expect(actText({ kind: 'notAllowed', reasons: ['LOCKED'] }, 'edit')).toBe(
      'This pull request is locked',
    );
    expect(
      actText({ kind: 'notAllowed', reasons: ['INSUFFICIENT_ACCESS'] }, 'edit', 'rozed-bot'),
    ).toBe('rozed-bot doesn’t have permission');
    expect(actText({ kind: 'notAllowed', reasons: [] }, 'delete', 'rozed-bot')).toBe(
      'rozed-bot can’t delete this comment',
    );
    expect(actText({ kind: 'cantResolve', resolved: false }, 'unresolve', 'rozed-bot')).toBe(
      'rozed-bot can’t unresolve this thread',
    );
    expect(actText({ kind: 'changed' }, 'delete')).toBe('This comment was edited elsewhere');
    expect(actText({ kind: 'paused', until: 0 }, 'resolve')).toMatch(
      /^GitHub’s rate limit resets at [^.]+$/,
    );
  });

  test('while it’s on its way the box is its card, which says so: no note', () => {
    expect(sendingNote(null)).toBeUndefined();
    for (const sending of ['waiting', 'sending', 'checking'] as const) {
      expect(sendingNote(sending)).toBeUndefined();
    }
    expect(sentLabel('sending', false)).toBe('Sending…');
    expect(sentLabel('waiting', true)).toBe('Saving…');
    expect(sentLabel('checking', false)).toBe('Checking…');
  });

  test('known not to have posted, it offers to send it again; not known, only to check again', () => {
    expect(sendingNote('notPosted')).toMatchObject({
      title: 'Couldn’t send the comment',
      text: 'GitHub didn’t respond.',
      offers: ['sendAgain'],
    });
    expect(sendingNote('notPosted', true)?.title).toBe('Couldn’t save the comment');
    expect(sendingNote('unknown')).toMatchObject({
      title: 'Comment not confirmed',
      text: 'GitHub didn’t respond.',
      offers: ['checkAgain'],
    });
    expect(sendingNote('unknown', true)?.title).toBe('Edit not confirmed');
    // A send refused for the same reason says it once.
    const notes = notesOf({ refusal: { kind: 'unconfirmed' }, sending: 'unknown' });
    expect(notes.map((each) => each.offers)).toEqual([['checkAgain']]);
  });
});

describe('changing a new comment’s lines', () => {
  /** Two hunks: new lines 3–7, then new lines 20–24, with 12 lines between them. */
  const two: Commentable = {
    kind: 'diff',
    hunks: [
      { old: 2, new: 2, kinds: '  -++ ' },
      { old: 18, new: 19, kinds: '  +  ' },
    ],
  };
  const takes = commentableOn(Screen.full(HEAD), two);
  const right = (from: number, to: number) => Lines.range(Line.right(from), Line.right(to));

  test('a line added is the next that way that takes a comment, over the lines between hunks', () => {
    expect(changedLines(takes, right(4, 5), 'lineAbove')).toEqual(right(3, 5));
    expect(changedLines(takes, right(4, 5), 'lineBelow')).toEqual(right(4, 6));
    expect(changedLines(takes, Lines.one(Line.right(7)), 'lineBelow')).toEqual(right(7, 20));
    expect(changedLines(takes, right(20, 21), 'lineAbove')).toEqual(right(7, 21));
  });

  test('a line taken off leaves the next that takes one as the end', () => {
    expect(changedLines(takes, right(3, 6), 'dropFirst')).toEqual(right(4, 6));
    expect(changedLines(takes, right(3, 6), 'dropLast')).toEqual(right(3, 5));
    expect(changedLines(takes, right(6, 20), 'dropLast')).toEqual(right(6, 7));
    expect(changedLines(takes, right(7, 20), 'dropFirst')).toEqual(Lines.one(Line.right(20)));
  });

  test('says why where its lines can’t change that way', () => {
    expect(changedLines(takes, right(3, 4), 'lineAbove')).toBe(NO_LINE_ABOVE);
    expect(changedLines(takes, right(23, 24), 'lineBelow')).toBe(NO_LINE_BELOW);
    expect(changedLines(takes, Lines.one(Line.right(5)), 'dropFirst')).toBe(ONE_LINE);
    expect(changedLines(takes, Lines.one(Line.right(5)), 'dropLast')).toBe(ONE_LINE);
    expect(changedLines(undefined, right(4, 5), 'lineAbove')).toBe(NO_LINE_ABOVE);
    expect(draftOn(right(35, 38))).toBe('A draft is already on lines 35–38');
    expect(draftOn(Lines.one(Line.right(33)))).toBe('A draft is already on line 33');
  });

  test('a removed line keeps to the old side', () => {
    const removed = Lines.range(Line.left(5), Line.left(5));
    expect(changedLines(takes, removed, 'lineAbove')).toEqual(
      Lines.range(Line.right(4), Line.left(5)),
    );
  });
});
