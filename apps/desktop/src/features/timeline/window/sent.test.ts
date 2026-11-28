// What the reader wrote on the pull request itself that the timeline on screen doesn't show yet:
// a comment sent from the box at its end is its last row until the timeline shows GitHub's copy,
// which takes its place, and an edit shows its new text in its comment's card until it's shown.

import { afterEach, describe, expect, test, vi } from 'vitest';

import type { OnPull } from '../../comments/window/shared.ts';
import type { Item, Timeline } from '../contract.ts';
import type { Row } from './rows.ts';
import { beforeOf, CLOCK_SLACK, sentKey, sentRows } from './sent.ts';

const AT = '2026-11-13T12:00:00Z';
/** When the comments on their way were sent, by GitHub's clock: a minute after `AT`. */
const SENT = Date.parse(AT) + 60_000;
const ME = { login: 'rozed-bot', type: 'User' };
const MONA = { login: 'mona', type: 'User' };
/** What a write's card says while it's on its way, as its box gave it. */
const LABEL = 'On its way';

function said(
  id: string,
  body: string,
  changes: { author?: typeof ME; createdAt?: string; lastEditedAt?: string } = {},
): Item {
  return {
    kind: 'comment',
    comment: {
      id,
      author: changes.author ?? ME,
      body,
      createdAt: changes.createdAt ?? AT,
      lastEditedAt: changes.lastEditedAt,
      url: `https://github.com/rozed-dev/e2e/pull/94#${id}`,
      hidden: undefined,
      viewerCanUpdate: true,
      viewerCanDelete: true,
    },
  };
}

/** A moment `ms` after the comments on their way were sent, as GitHub says the time. */
function since(ms: number): string {
  return new Date(SENT + ms).toISOString();
}

function timeline(items: Item[]): Timeline {
  return {
    description: { author: MONA, body: '', createdAt: AT },
    items: items.map((item, at) => ({
      cursor: item.kind === 'comment' ? `c-${item.comment.id}` : `c${at}`,
      item,
    })),
    leftOut: 0,
    count: items.length,
    shownUpdatedAt: AT,
    readInFullAt: AT,
  };
}

/** The timeline's rows of `items`' comments, as `rowsOf` keys them. */
function rows(items: Item[]): Row[] {
  return items.flatMap((item) =>
    item.kind === 'comment'
      ? [
          {
            kind: 'comment',
            key: `c-${item.comment.id}`,
            id: item.comment.id,
            author: item.comment.author,
            at: item.comment.createdAt,
            body: item.comment.body,
            url: item.comment.url,
            byAuthor: false,
            hidden: undefined,
            canUpdate: true,
            canDelete: true,
          } satisfies Row,
        ]
      : [],
  );
}

function sent(changes: Partial<OnPull> = {}): OnPull {
  return {
    key: 'box-1',
    comment: undefined,
    text: 'Ship it.',
    state: 'sending',
    label: LABEL,
    at: undefined,
    send: 1,
    sentAt: SENT,
    before: undefined,
    copy: undefined,
    editedAt: undefined,
    ...changes,
  };
}

/** What the timeline on screen shows of `items`, with `entry`, sent as it held them. */
function drawn(items: Item[], entry: OnPull) {
  return sentRows([entry], timeline(items), rows(items), ME, false);
}

afterEach(() => {
  vi.useRealTimers();
});

/** Runs `check` with this computer's clock an hour behind GitHub's, then an hour ahead of it. */
function eitherClock(check: () => void): void {
  for (const off of [-3_600_000, 3_600_000]) {
    vi.useFakeTimers({ now: SENT + off });
    check();
  }
}

describe('sentRows', () => {
  test('a comment on its way is the last row, drawn from its text, saying what’s being done', () => {
    const items = [said('IC_1', 'Looks right.')];
    const shown = timeline(items);
    const before = beforeOf(shown, 'Ship it.', ME.login);
    const made = sentRows([sent({ before })], shown, rows(items), ME, true);
    expect(made.rows).toEqual([
      {
        kind: 'sent',
        key: sentKey(sent()),
        author: ME,
        body: 'Ship it.',
        byAuthor: true,
        sending: LABEL,
        at: undefined,
      },
    ]);
    expect(made.shown.size).toBe(0);
    // Taken, it has its time, and says nothing more.
    const taken = drawn(items, sent({ before, state: 'sent', at: Date.parse(AT) }));
    expect(taken.rows[0]).toMatchObject({ sending: undefined, at: '2026-11-13T12:00:00.000Z' });
  });

  test('GitHub’s copy takes its row’s place, and the keyboard on it goes to that copy', () => {
    // The timeline held a comment with the same text before: only a second one is GitHub's copy.
    const was = [said('IC_1', 'Ship it.')];
    const before = beforeOf(timeline(was), 'Ship it.', ME.login);
    const taken = sent({ before, state: 'sent', at: Date.parse(AT) });
    expect(drawn(was, taken).rows.map((row) => row.kind)).toEqual(['sent']);
    const now = [...was, said('IC_2', 'Ship it.\r\n')];
    const landed = drawn(now, taken);
    expect(landed.rows).toEqual([]);
    expect([...landed.shown]).toEqual(['box-1']);
    expect(landed.landed.get(sentKey(taken))).toBe('c-IC_2');
  });

  test('GitHub’s copy, as its answer named it, takes its row’s place, from an overview’s block the first time too', () => {
    // Sent from an overview's block before the timeline was read, the account's first write since
    // Lo started: nothing from before it was sent, nor when by GitHub's clock.
    const answered = sent({ state: 'sent', at: SENT, sentAt: undefined, copy: 'IC_7' });
    const mineSince = said('IC_6', 'Ship it.', { createdAt: since(1000) });
    expect(drawn([mineSince], answered).rows.map((row) => row.kind)).toEqual(['sent']);
    // Its copy is the comment GitHub named, whatever its text as GitHub keeps it.
    const copy = said('IC_7', 'Ship it.\n', { createdAt: since(2000) });
    const landed = drawn([mineSince, copy], answered);
    expect(landed.rows).toEqual([]);
    expect([...landed.shown]).toEqual(['box-1']);
    expect(landed.landed.get(sentKey(answered))).toBe('c-IC_7');
  });

  test('while its answer is still to come, with nothing from before, nothing is taken for its copy', () => {
    const mineSince = said('IC_6', 'Ship it.', { createdAt: since(1000) });
    expect(drawn([mineSince], sent()).rows.map((row) => row.kind)).toEqual(['sent']);
  });

  test('its answer lost, with nothing from before, GitHub’s copy is one of theirs made since, by GitHub’s clock', () => {
    // Sent before the timeline was read, or found on its way as Lo started: an older comment of
    // theirs with its text isn't its copy, one made since is, there already or not, whatever this
    // computer's clock says.
    eitherClock(() => {
      const older = said('IC_1', 'Ship it.', { createdAt: since(-CLOCK_SLACK - 1000) });
      const lost = sent({ state: 'checking' });
      expect(drawn([older], lost).rows.map((row) => row.kind)).toEqual(['sent']);
      const copy = said('IC_2', 'Ship it.', { createdAt: since(-1000) });
      const landed = drawn([older, copy], lost);
      expect(landed.rows).toEqual([]);
      expect([...landed.shown]).toEqual(['box-1']);
      expect(landed.landed.get(sentKey(lost))).toBe('c-IC_2');
      // Until main says when it went, nothing is taken for its copy.
      const unknown = drawn([older, copy], sent({ state: 'checking', sentAt: undefined }));
      expect(unknown.rows.map((row) => row.kind)).toEqual(['sent']);
    });
  });

  test('someone else’s comment with the same text never takes its place', () => {
    const theirs = said('IC_9', 'Ship it.', { author: MONA, createdAt: since(1000) });
    // With what the timeline held before, and, its answer lost, by GitHub's clock.
    const before = beforeOf(timeline([]), 'Ship it.', ME.login);
    expect(drawn([theirs], sent({ before })).rows.map((row) => row.kind)).toEqual(['sent']);
    const lost = sent({ state: 'checking' });
    expect(drawn([theirs], lost).rows.map((row) => row.kind)).toEqual(['sent']);
    // GitHub's copy, before theirs, takes the keyboard, not theirs after it.
    const copy = said('IC_2', 'Ship it.', { createdAt: since(500) });
    expect(drawn([copy, theirs], sent({ before })).landed.get(sentKey(sent()))).toBe('c-IC_2');
  });

  test('an edit shows its new text in its comment’s card until the timeline has it', () => {
    const items = [said('IC_1', 'Looks right.')];
    const saving = sent({ comment: 'IC_1', text: 'Looks right to me.' });
    const made = drawn(items, saving);
    expect(made.rows).toEqual([]);
    expect(made.edits.get('IC_1')).toEqual({ text: 'Looks right to me.', saving: LABEL });
    // Taken, it keeps the new text, saying nothing more, until the timeline shows the edit.
    const taken = { ...saving, state: 'sent' as const, at: Date.parse(AT) };
    expect(drawn(items, taken).edits.get('IC_1')).toEqual({
      text: 'Looks right to me.',
      saving: undefined,
    });
    const shown = drawn([said('IC_1', 'Looks right to me.')], taken);
    expect(shown.edits.size).toBe(0);
    expect([...shown.shown]).toEqual(['box-1']);
  });

  test('an edit made elsewhere after GitHub answered it shows, by its answer’s time, the first since Lo started too', () => {
    eitherClock(() => {
      // GitHub answered a second after it was sent; main didn't know its clock when it was sent.
      const answered = sent({
        comment: 'IC_1',
        text: 'Mine.',
        state: 'sent',
        at: SENT,
        sentAt: undefined,
        editedAt: SENT + 1000,
      });
      const before = [said('IC_1', 'Older.', { lastEditedAt: since(-CLOCK_SLACK) })];
      expect(drawn(before, answered).edits.get('IC_1')).toMatchObject({ text: 'Mine.' });
      const after = [said('IC_1', 'Theirs, since.', { lastEditedAt: since(3000) })];
      const shown = drawn(after, answered);
      expect(shown.edits.size).toBe(0);
      expect([...shown.shown]).toEqual(['box-1']);
    });
  });

  test('an edit whose answer was lost, made elsewhere after, shows: GitHub’s copy is newer by GitHub’s clock, whatever its text', () => {
    eitherClock(() => {
      const taken = sent({ comment: 'IC_1', text: 'Mine.', state: 'sent', at: SENT });
      // Edited before it was sent: the card keeps its text.
      const before = [said('IC_1', 'Older.', { lastEditedAt: since(-CLOCK_SLACK - 1000) })];
      expect(drawn(before, taken).edits.get('IC_1')).toMatchObject({ text: 'Mine.' });
      const after = [said('IC_1', 'Theirs, since.', { lastEditedAt: since(2000) })];
      const shown = drawn(after, taken);
      expect(shown.edits.size).toBe(0);
      expect([...shown.shown]).toEqual(['box-1']);
      // Until main says when it went, its text stays.
      const unknown = drawn(after, { ...taken, sentAt: undefined });
      expect(unknown.edits.get('IC_1')).toMatchObject({ text: 'Mine.' });
    });
  });

  test('with no account to have sent it, a comment draws no row', () => {
    const items = [said('IC_1', 'Looks right.')];
    expect(sentRows([sent()], timeline(items), rows(items), undefined, false).rows).toEqual([]);
  });
});
