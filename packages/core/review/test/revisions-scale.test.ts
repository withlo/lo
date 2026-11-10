/** Building revisions stays fast on very long push histories. */

import { expect, test } from 'vitest';

import { buildRevisions } from '../src/revisions/build.ts';
import { defaultComparison } from '../src/revisions/compare.ts';
import type { PushRecord } from '../src/revisions.ts';

const HEADS = 20_000;

/**
 * How long building, comparing and numbering may take, in milliseconds: three times the slowest of
 * the three on a Linux CI runner.
 */
const LIMIT = process.env.CI ? 1000 : 500;

/** `seconds` into a day in 2026, in milliseconds since the Unix epoch. */
function at(seconds: number): number {
  return (1_790_000_000 + seconds) * 1000;
}

function sha(index: number): string {
  return index.toString(16).padStart(40, '0');
}

/**
 * Builds the revisions, picks the default comparison and numbers every revision: how many
 * revisions there are, the heads with no number, and how long it took.
 */
function timed(
  records: readonly PushRecord[],
  commits: readonly string[],
): { count: number; unnumbered: string[]; elapsed: number } {
  const start = performance.now();
  const revisions = buildRevisions(records, commits, sha(HEADS), at(0));
  defaultComparison(revisions, sha(HEADS / 2), sha(Math.floor(HEADS / 3)));
  const unnumbered = [...revisions]
    .filter((revision) => revisions.number(revision.head) === undefined)
    .map((revision) => revision.head);
  const elapsed = performance.now() - start;
  process.stderr.write(
    `revisions scale: ${records.length} records took ${elapsed.toFixed(1)} ms\n`,
  );
  return { count: revisions.length, unnumbered, elapsed };
}

/** Every head, as the current commits. */
function currentCommits(): string[] {
  return Array.from({ length: HEADS }, (_, index) => sha(index + 1));
}

test('normal pushes each with ten check suites', () => {
  const records: PushRecord[] = [];
  for (let index = 1; index <= HEADS; index++) {
    const before = sha(index - 1);
    const pushedAt = (seconds: number) => at(index * 60 + seconds);
    records.push({ kind: 'activity', before, after: sha(index), at: pushedAt(0), forced: false });
    for (let seconds = 0; seconds < 10; seconds++) {
      records.push({
        kind: 'checkSuite',
        previous: before,
        next: sha(index),
        at: pushedAt(5 + seconds),
      });
    }
  }

  const { count, unnumbered, elapsed } = timed(records, currentCommits());

  expect([count, unnumbered]).toEqual([HEADS, []]);
  expect(elapsed).toBeLessThan(LIMIT);
});

test('heads only the poller saw newest first', () => {
  const records = Array.from({ length: HEADS }, (_, offset): PushRecord => ({
    kind: 'polled',
    head: sha(HEADS - offset),
    at: at((HEADS - offset) * 60),
  }));

  const { count, unnumbered, elapsed } = timed(records, [sha(HEADS)]);

  expect([count, unnumbered]).toEqual([HEADS, []]);
  expect(elapsed).toBeLessThan(LIMIT);
});

test('late reviews along the current commits', () => {
  // Each review came long after the push, so every time comes from the next head's.
  const records = Array.from({ length: HEADS - 1 }, (_, offset): PushRecord => ({
    kind: 'review',
    commit: sha(offset + 1),
    at: at(10_000_000 + offset + 1),
  }));
  records.push({ kind: 'polled', head: sha(HEADS), at: at(60) });

  const { count, unnumbered, elapsed } = timed(records, currentCommits());

  expect([count, unnumbered]).toEqual([HEADS, []]);
  expect(elapsed).toBeLessThan(LIMIT);
});
