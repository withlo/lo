// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';
import { keptRow, revealHidden, stillHidden } from './actions.ts';
import type { Row } from './rows.ts';
import { focusedRows } from './store.ts';

const TAB: PullTab = { kind: 'pull', id: 't1', owner: 'rozed-dev', repo: 'e2e', number: 23 };

const HIDDEN: Row = {
  kind: 'comment',
  key: 'c1',
  id: 'IC_1',
  author: { login: 'mona', type: 'User' },
  at: '2026-11-06T12:00:00Z',
  body: 'Spam',
  url: 'https://github.com/rozed-dev/e2e/pull/23#issuecomment-1',
  byAuthor: false,
  hidden: 'spam',
  canUpdate: false,
  canDelete: false,
};

describe('revealHidden', () => {
  it('gives focus back to the list as the pressed "Show comment" goes', () => {
    const list = document.createElement('ol');
    list.tabIndex = 0;
    const row = document.createElement('li');
    row.dataset['key'] = HIDDEN.key;
    // jsdom has no scrollIntoView, and the row is brought on screen a frame later, which can come
    // after the test.
    Reflect.set(row, 'scrollIntoView', () => undefined);
    const button = document.createElement('button');
    row.append(button);
    list.append(row);
    document.body.append(list);
    button.focus();

    revealHidden({ tab: TAB, rows: [HIDDEN], list: () => list }, HIDDEN.key);
    // The comment shows, so its button goes.
    button.remove();

    expect(stillHidden(TAB.id, HIDDEN)).toBe(false);
    expect(document.activeElement).toBe(list);
    expect(focusedRows.get(TAB.id)).toBe(HIDDEN.key);
    list.remove();
  });
});

/** Rows with the keys `keys`, in order. */
function rows(...keys: string[]): Row[] {
  return keys.map((key) => ({ kind: 'older', key, count: 1 }) satisfies Row);
}

describe('keptRow', () => {
  it('keeps the row the keyboard is on, and once it goes, its neighbour, never the first row', () => {
    const before = rows('description', 'c1', 'c2', 'c3');
    expect(keptRow(before, rows('description', 'c1', 'c2', 'c3', 'c4'), 'c2')).toBe('c2');
    // A comment deleted: the next row, where it was.
    expect(keptRow(before, rows('description', 'c1', 'c3'), 'c2')).toBe('c3');
    // The last: the one before it.
    expect(keptRow(before, rows('description', 'c1', 'c2'), 'c3')).toBe('c2');
    // Gone with its neighbours after it, and others come: the nearest still there.
    expect(keptRow(before, rows('description', 'c1', 'c5'), 'c2')).toBe('c1');
    expect(keptRow(before, rows('description'), 'gone')).toBe('description');
  });
});
