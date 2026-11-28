// What the reader wrote on the pull request itself that the timeline on screen doesn't show yet:
// a comment sent from the box at its end is its last row until the timeline shows GitHub's copy,
// which takes its place, and an edit shows its new text in its comment's card until it's shown.

import { describe, expect, test } from 'vitest';

import type { OnPull } from '../../comments/window/shared.ts';
import type { Item, Timeline } from '../contract.ts';
import type { Row } from './rows.ts';
import { beforeOf, sentKey, sentRows, type Before } from './sent.ts';

const AT = '2026-11-13T12:00:00Z';
const ME = { login: 'rozed-bot', type: 'User' };

function said(id: string, body: string): Item {
  return {
    kind: 'comment',
    comment: {
      id,
      author: ME,
      body,
      createdAt: AT,
      lastEditedAt: undefined,
      url: `https://github.com/rozed-dev/e2e/pull/94#${id}`,
      hidden: undefined,
      viewerCanUpdate: true,
      viewerCanDelete: true,
    },
  };
}

function timeline(items: Item[]): Timeline {
  return {
    description: { author: { login: 'mona', type: 'User' }, body: '', createdAt: AT },
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
            author: ME,
            at: AT,
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
    label: 'Sending…',
    at: undefined,
    ...changes,
  };
}

describe('sentRows', () => {
  test('a comment on its way is the last row, drawn from its text, saying what’s being done', () => {
    const items = [said('IC_1', 'Looks right.')];
    const shown = timeline(items);
    const before = new Map<string, Before>([['box-1', beforeOf(shown, 'Ship it.')]]);
    const made = sentRows([sent()], shown, rows(items), before, ME, true);
    expect(made.rows).toEqual([
      {
        kind: 'sent',
        key: sentKey(sent()),
        author: ME,
        body: 'Ship it.',
        byAuthor: true,
        sending: 'Sending…',
        at: undefined,
      },
    ]);
    expect(made.shown.size).toBe(0);
    // Taken, it has its time, and says nothing more.
    const taken = sentRows(
      [sent({ state: 'sent', at: Date.parse(AT) })],
      shown,
      rows(items),
      before,
      ME,
      false,
    );
    expect(taken.rows[0]).toMatchObject({ sending: undefined, at: '2026-11-13T12:00:00.000Z' });
  });

  test('GitHub’s copy takes its row’s place, and the keyboard on it goes to that copy', () => {
    // The timeline held a comment with the same text before: only a second one is GitHub's copy.
    const was = [said('IC_1', 'Ship it.')];
    const before = new Map<string, Before>([['box-1', beforeOf(timeline(was), 'Ship it.')]]);
    const taken = sent({ state: 'sent', at: Date.parse(AT) });
    const still = sentRows([taken], timeline(was), rows(was), before, ME, false);
    expect(still.rows.map((row) => row.kind)).toEqual(['sent']);
    const now = [...was, said('IC_2', 'Ship it.\r\n')];
    const landed = sentRows([taken], timeline(now), rows(now), before, ME, false);
    expect(landed.rows).toEqual([]);
    expect([...landed.shown]).toEqual(['box-1']);
    expect(landed.landed.get(sentKey(taken))).toBe('c-IC_2');
  });

  test('an edit shows its new text in its comment’s card until the timeline has it', () => {
    const items = [said('IC_1', 'Looks right.')];
    const saving = sent({ comment: 'IC_1', text: 'Looks right to me.', label: 'Saving…' });
    const made = sentRows([saving], timeline(items), rows(items), new Map(), ME, false);
    expect(made.rows).toEqual([]);
    expect(made.edits.get('IC_1')).toEqual({ text: 'Looks right to me.', saving: 'Saving…' });
    // Taken, it keeps the new text, saying nothing more, until the timeline shows the edit.
    const taken = { ...saving, state: 'sent' as const, at: Date.parse(AT) };
    expect(
      sentRows([taken], timeline(items), rows(items), new Map(), ME, false).edits.get('IC_1'),
    ).toEqual({ text: 'Looks right to me.', saving: undefined });
    const edited = [said('IC_1', 'Looks right to me.')];
    const shown = sentRows([taken], timeline(edited), rows(edited), new Map(), ME, false);
    expect(shown.edits.size).toBe(0);
    expect([...shown.shown]).toEqual(['box-1']);
  });

  test('with no account to have sent it, a comment draws no row', () => {
    const items = [said('IC_1', 'Looks right.')];
    expect(
      sentRows([sent()], timeline(items), rows(items), new Map(), undefined, false).rows,
    ).toEqual([]);
  });
});
