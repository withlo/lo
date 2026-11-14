// @vitest-environment jsdom
// What the timeline on screen shows of what main sends: nothing moves while the reader looks until
// their next key, click or scroll, but what their own write changed shows as it comes, for a
// minute at most; and what `i` and `dd` act on, refusing in Lo's words what Lo doesn't change.

import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Item, Timeline, TimelineView } from '../contract.ts';
import { atOnce, CLAIM_FOR, holding, shows, stillToCome, type Claim } from './holding.ts';
import type { Row } from './rows.ts';
import { claim, setLooked, showHeld, shownTimelines, takeTimeline } from './store.ts';
import { changeTarget, commentIn, isYours } from './yours.ts';

const AT = '2026-11-13T12:00:00Z';

function said(id: string, body: string, login = 'rozed-bot'): Item {
  return {
    kind: 'comment',
    comment: {
      id,
      author: { login, type: 'User' },
      body,
      createdAt: AT,
      lastEditedAt: undefined,
      url: `https://github.com/rozed-dev/e2e/pull/94#${id}`,
      hidden: undefined,
      viewerCanUpdate: login === 'rozed-bot',
      viewerCanDelete: login === 'rozed-bot',
    },
  };
}

function timeline(items: Item[]): Timeline {
  return {
    description: { author: { login: 'mona', type: 'User' }, body: '', createdAt: AT },
    items: items.map((item, at) => ({ cursor: `c${at}`, item })),
    leftOut: 0,
    count: items.length,
    shownUpdatedAt: AT,
    readInFullAt: AT,
  };
}

let VIEW = 'h0';

function view(items: Item[], id = VIEW): TimelineView {
  return { id, status: 'ready', timeline: timeline(items), problem: null };
}

/** The reader's post of `Ship it.`, made when the timeline held `had` comments with its text. */
function posted(had: number, until = 1_000): Claim {
  return { write: { kind: 'posted', text: 'Ship it.' }, until, had };
}

/** A comment of rozed-bot's, as the timeline's rows have it. */
function row(changes: Partial<Extract<Row, { kind: 'comment' }>> = {}): Row {
  return {
    kind: 'comment',
    key: 'IC_1',
    id: 'IC_1',
    author: { login: 'rozed-bot', type: 'User' },
    at: AT,
    body: 'Looks right.',
    url: 'https://github.com/rozed-dev/e2e/pull/94#issuecomment-1',
    byAuthor: false,
    hidden: undefined,
    canUpdate: true,
    canDelete: true,
    ...changes,
  };
}

afterEach(() => {
  setLooked(VIEW, false);
  VIEW = `h${Number(VIEW.slice(1)) + 1}`;
  vi.useRealTimers();
});

describe('holding', () => {
  test('a post shows once the timeline holds one more comment with its text than it had', () => {
    const before = timeline([said('IC_1', 'Ship it.')]);
    expect(holding(before, 'Ship it.\r\n')).toBe(1);
    expect(shows(before, posted(1))).toBe(false);
    expect(shows(timeline([said('IC_1', 'Ship it.'), said('IC_2', 'Ship it.')]), posted(1))).toBe(
      true,
    );
  });

  test('an edit shows with its text, and a delete once the comment is gone', () => {
    const edited: Claim = {
      write: { kind: 'edited', comment: 'IC_1', text: 'New.' },
      until: 1_000,
      had: 0,
    };
    expect(shows(timeline([said('IC_1', 'Old.')]), edited)).toBe(false);
    expect(shows(timeline([said('IC_1', 'New.')]), edited)).toBe(true);
    const deleted: Claim = { write: { kind: 'deleted', comment: 'IC_1' }, until: 1_000, had: 0 };
    expect(shows(timeline([said('IC_1', 'Old.')]), deleted)).toBe(false);
    expect(shows(timeline([]), deleted)).toBe(true);
  });

  test('what comes waits while the reader looks, but for the first rows and their own writes', () => {
    const shown = view([said('IC_1', 'One.')]);
    const next = view([said('IC_1', 'One.'), said('IC_2', 'Two.', 'ravi-k')]);
    expect(atOnce(next, shown, true, [], 0)).toBe(false);
    expect(atOnce(next, shown, false, [], 0)).toBe(true);
    expect(atOnce(next, undefined, true, [], 0)).toBe(true);
    expect(atOnce(next, shown, true, [posted(0, 1_000)], 500)).toBe(true);
    // A minute at most.
    expect(atOnce(next, shown, true, [posted(0, 1_000)], 1_000)).toBe(false);
    expect(stillToCome([posted(0, 1_000)], next.timeline, 500)).toHaveLength(1);
    expect(stillToCome([posted(0, 1_000)], timeline([said('IC_3', 'Ship it.')]), 500)).toEqual([]);
  });

  test('the store holds what comes while the timeline is on screen until the reader’s input', () => {
    const first = view([said('IC_1', 'One.')]);
    takeTimeline(first);
    setLooked(VIEW, true);
    const next = view([said('IC_1', 'One.'), said('IC_2', 'Two.', 'ravi-k')]);
    takeTimeline(next);
    expect(shownTimelines.get(VIEW)).toBe(first);
    showHeld(VIEW);
    expect(shownTimelines.get(VIEW)).toBe(next);
    // Off screen, it comes at once.
    setLooked(VIEW, false);
    const third = view([said('IC_1', 'One.')]);
    takeTimeline(third);
    expect(shownTimelines.get(VIEW)).toBe(third);
  });

  test('the reader’s own post shows as it comes, and the claim goes once it has', () => {
    vi.useFakeTimers();
    takeTimeline(view([said('IC_1', 'One.')]));
    setLooked(VIEW, true);
    claim(VIEW, { kind: 'posted', text: 'Ship it.' });
    const items = [said('IC_1', 'One.'), said('IC_2', 'Two.', 'ravi-k')];
    const before = view(items);
    takeTimeline(before);
    expect(shownTimelines.get(VIEW)).toBe(before);
    const mine = view([...items, said('IC_3', 'Ship it.')]);
    takeTimeline(mine);
    expect(shownTimelines.get(VIEW)).toBe(mine);
    // It came: what follows waits again.
    const after = view([said('IC_4', 'Later.', 'ravi-k')]);
    takeTimeline(after);
    expect(shownTimelines.get(VIEW)).toBe(mine);
    // And a claim that never comes lasts a minute.
    claim(VIEW, { kind: 'deleted', comment: 'IC_9' });
    vi.advanceTimersByTime(CLAIM_FOR);
    takeTimeline(view([]));
    expect(shownTimelines.get(VIEW)).not.toBe(mine);
  });
});

describe('what i and dd act on', () => {
  test('your comment, which says it’s yours, logins ignoring case', () => {
    expect(changeTarget(row(), false, 'Rozed-Bot', 'edit')).toEqual({
      id: 'IC_1',
      author: 'rozed-bot',
      body: 'Looks right.',
      viewerCanUpdate: true,
      viewerCanDelete: true,
    });
    expect(isYours(row(), 'ROZED-BOT')).toBe(true);
    expect(isYours(row({ author: undefined }), 'rozed-bot')).toBe(false);
    expect(isYours(row(), undefined)).toBe(false);
  });

  test('anything else is refused in Lo’s words', () => {
    expect(
      changeTarget(
        row({ author: { login: 'ravi-k', type: 'User' } }),
        false,
        'rozed-bot',
        'delete',
      ),
    ).toBe('It’s ravi-k’s comment. You can edit and delete only your own.');
    expect(changeTarget(row(), true, 'rozed-bot', 'edit')).toBe(
      'This comment is hidden. Show it first.',
    );
    const older: Row = { kind: 'older', key: 'older', count: 3 };
    expect(commentIn(older, false)).toBe('This event isn’t a comment.');
  });
});
