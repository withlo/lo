// The Recent list: the pull requests opened lately, filtered by what's typed, grouped by day, with
// the one the keys move through. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { RecentPull } from '../contract.ts';

export interface RecentState {
  /** The pull requests opened lately, newest first, once main has said. */
  readonly rows: readonly RecentPull[] | undefined;
  /** What the filter holds. */
  readonly query: string;
  /** The row the keys are on, by {@link rowKey}. */
  readonly chosen: string | undefined;
}

export const recentStore = createStore<RecentState>()(() => ({
  rows: undefined,
  query: '',
  chosen: undefined,
}));

/** A row's key: its pull request, `owner/repo#number`, as GitHub's names ignore case. */
export function rowKey({ owner, repo, number }: RecentPull): string {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

/** A row's link, as Lo writes one. */
export function rowLink({ owner, repo, number }: RecentPull): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}

/**
 * Whether `row` matches `query`: each of its words is somewhere in the row's repository, number,
 * title or account, ignoring case.
 */
export function matches(row: RecentPull, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text =
    `${row.owner}/${row.repo} #${row.number} ${row.title ?? ''} ${row.login}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The rows `query` matches, in their order. */
export function filterRecent(rows: readonly RecentPull[], query: string): RecentPull[] {
  return rows.filter((row) => matches(row, query));
}

/** The row the keys are on among `shown`: the one chosen, or the first. */
export function chosenRow(
  shown: readonly RecentPull[],
  chosen: string | undefined,
): RecentPull | undefined {
  return shown.find((row) => rowKey(row) === chosen) ?? shown[0];
}

/** The row `step` rows after the chosen one, stopping at the ends. */
export function stepRow(
  shown: readonly RecentPull[],
  chosen: string | undefined,
  step: 1 | -1,
): RecentPull | undefined {
  const current = chosenRow(shown, chosen);
  const at = current === undefined ? -1 : shown.indexOf(current);
  return shown[Math.min(shown.length - 1, Math.max(0, at + step))];
}

/** A run of rows opened on the same day, or earlier. */
export interface RecentGroup {
  readonly label: string;
  readonly rows: readonly RecentPull[];
}

/** Midnight of the day `time` falls on, here. */
function dayOf(time: number): number {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** How many days before `now`'s `time` falls, here: 0 today, 1 yesterday. */
function daysBefore(time: number, now: number): number {
  return Math.round((dayOf(now) - dayOf(time)) / 86_400_000);
}

/** The group a row opened at `time` goes in, as of `now`. */
function groupOf(time: number, now: number): string {
  const days = daysBefore(time, now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  return 'Earlier';
}

/** The rows by when they were opened: today, yesterday, earlier this week, and earlier. */
export function groupRecent(rows: readonly RecentPull[], now: number): RecentGroup[] {
  const groups: { label: string; rows: RecentPull[] }[] = [];
  for (const row of rows) {
    const label = groupOf(row.openedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

/** When a row was opened, as its group shows it: the time this week or yesterday, else the day. */
export function whenOpened(time: number, now: number, locale?: string): string {
  const days = daysBefore(time, now);
  if (days <= 1) {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(time);
  }
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(time);
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(time);
}

/** Who the list's pull requests are across, for its header. */
export function acrossAccounts(logins: readonly string[]): string {
  if (logins.length === 0) return 'Not signed in';
  if (logins.length === 1) return `Signed in as ${logins[0] ?? ''}`;
  return `Across ${logins.length} accounts`;
}
