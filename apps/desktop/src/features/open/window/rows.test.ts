import { describe, expect, it } from 'vitest';

import type { RecentPull } from '../contract.ts';
import {
  acrossAccounts,
  chosenRow,
  filterRecent,
  groupRecent,
  rowKey,
  rowLink,
  stepRow,
  whenOpened,
} from './rows.ts';

/** Noon on Wednesday 11 November 2026, here. */
const NOW = new Date(2026, 10, 11, 12, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function row(number: number, openedAt: number, more: Partial<RecentPull> = {}): RecentPull {
  return {
    owner: 'rozed-dev',
    repo: 'e2e',
    number,
    title: `Change ${number}`,
    login: 'rozed-bot',
    openedAt,
    ...more,
  };
}

const rows = [
  row(78, NOW - HOUR, { title: "App: the pull request Lo's end-to-end tests open" }),
  row(77, NOW - 2 * HOUR, { repo: 'playground', login: 'work-bot' }),
  row(4, NOW - DAY - HOUR, { owner: 'sharkdp', repo: 'fd', title: null }),
  row(3, NOW - 3 * DAY),
  row(2, NOW - 30 * DAY),
];

/** The numbers of the rows `query` matches. */
function numbers(query: string): number[] {
  return filterRecent(rows, query).map((each) => each.number);
}

describe('the Recent list', () => {
  it('names each row’s pull request, its title, its account and when it was opened', () => {
    const [first] = rows;
    expect(first && rowLink(first)).toBe('https://github.com/rozed-dev/e2e/pull/78');
    expect(first && rowKey(first)).toBe('rozed-dev/e2e#78');
    expect(rowKey(row(1, 0, { owner: 'Rozed-Dev', repo: 'E2E' }))).toBe('rozed-dev/e2e#1');
    expect(whenOpened(NOW - HOUR, NOW, 'en-US')).toBe('11:00 AM');
    expect(whenOpened(NOW - DAY, NOW, 'en-US')).toBe('12:00 PM');
    expect(whenOpened(NOW - 3 * DAY, NOW, 'en-US')).toBe('Sun');
    expect(whenOpened(NOW - 30 * DAY, NOW, 'en-US')).toBe('Oct 12');
    expect(whenOpened(NOW - 400 * DAY, NOW, 'en-US')).toBe('Oct 7, 2025');
  });

  it('groups the rows by day, newest first, as they come', () => {
    expect(
      groupRecent(rows, NOW).map(({ label, rows: each }) => [label, each.map((r) => r.number)]),
    ).toEqual([
      ['Today', [78, 77]],
      ['Yesterday', [4]],
      ['Earlier this week', [3]],
      ['Earlier', [2]],
    ]);
    expect(groupRecent([], NOW)).toEqual([]);
  });

  it('filters by every word typed, in the repository, number, title or account', () => {
    expect(numbers('')).toEqual([78, 77, 4, 3, 2]);
    expect(numbers('E2E')).toEqual([78, 3, 2]);
    expect(numbers('#4')).toEqual([4]);
    expect(numbers('end-to-end 78')).toEqual([78]);
    expect(numbers('work-bot')).toEqual([77]);
    expect(numbers('sharkdp/fd')).toEqual([4]);
    expect(numbers('nothing like it')).toEqual([]);
  });

  it('moves the choice through the rows shown, stopping at the ends', () => {
    expect(chosenRow(rows, undefined)?.number).toBe(78);
    expect(chosenRow(rows, 'gone/gone#1')?.number).toBe(78);
    expect(stepRow(rows, undefined, 1)?.number).toBe(77);
    expect(stepRow(rows, 'rozed-dev/e2e#2', 1)?.number).toBe(2);
    expect(stepRow(rows, 'rozed-dev/e2e#78', -1)?.number).toBe(78);
    expect(stepRow([], undefined, 1)).toBeUndefined();
  });

  it('follows the accounts in its header', () => {
    expect(acrossAccounts([])).toBe('Not signed in');
    expect(acrossAccounts(['rozed-bot'])).toBe('Signed in as rozed-bot');
    expect(acrossAccounts(['rozed-bot', 'work-bot'])).toBe('Across 2 accounts');
  });
});
