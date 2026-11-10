/**
 * Revisions built from random push histories, whatever the sources say: each head is one revision,
 * the pull request's head is the latest, and comparisons end at it.
 */

import { expect, test } from 'vitest';

import { buildRevisions } from '../src/revisions/build.ts';
import { defaultComparison } from '../src/revisions/compare.ts';
import { viewedFileComparison } from '../src/revisions/viewed.ts';
import type { PushRecord, Revisions } from '../src/revisions.ts';

/** A linear congruential generator, so every run sees the same histories. */
class Random {
  #state: bigint;

  constructor(seed: number) {
    this.#state = BigInt(seed);
  }

  below(bound: number): number {
    this.#state =
      (this.#state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) &
      0xffff_ffff_ffff_ffffn;
    return Number((this.#state >> 33n) % BigInt(bound));
  }

  pick(names: readonly string[]): string {
    return names[this.below(names.length)] ?? '';
  }

  /** A time 1 to 100 seconds after the Unix epoch, in milliseconds. */
  time(): number {
    return (1 + this.below(100)) * 1000;
  }
}

/** Whether `from` is numbered before `to`, a revision with no number coming first. */
function numberedBefore(revisions: Revisions, from: string, to: string): boolean {
  return (revisions.number(from) ?? 0) < (revisions.number(to) ?? 0);
}

/**
 * What's wrong with the revisions `revisions` built from a history, and with the comparisons
 * between markers `a` and `b`, for a pull request whose head is `head`, given the heads `named` by
 * the records when it opened before every push.
 */
function problems(
  revisions: Revisions,
  head: string,
  named: ReadonlySet<string> | undefined,
  [a, b]: [string, string],
): string[] {
  const found: string[] = [];
  const heads = new Set([...revisions].map((revision) => revision.head));
  if (heads.size !== revisions.length) found.push('a head is more than one revision');
  if (revisions.latest()?.head !== head) found.push("the pull request's head isn't the latest");
  const missing = [...(named ?? [])].filter((name) => !heads.has(name));
  if (missing.length > 0) found.push(`${missing.join(', ')} named but no revision`);
  const comparison = defaultComparison(revisions, a, b);
  if (comparison.kind === 'full') {
    if (![undefined, head].includes(comparison.nothingNewSince)) {
      found.push('nothing new since another revision than the head');
    }
  } else if (comparison.to !== head || !numberedBefore(revisions, comparison.from, comparison.to)) {
    found.push(`compares ${comparison.from} to ${comparison.to}`);
  }
  const file = viewedFileComparison(revisions, 'DISMISSED', a, b);
  if (file === undefined) {
    found.push('a file changed since viewed has no comparison');
  } else if (
    file.kind !== 'full' &&
    (file.to !== head || !numberedBefore(revisions, file.from, file.to))
  ) {
    found.push(`a file compares ${file.from} to ${file.to}`);
  }
  return found;
}

test('random push histories', () => {
  const random = new Random(42);
  const names = Array.from({ length: 12 }, (_, n) => `h${n}`);
  const failures: string[] = [];
  for (let history = 0; history < 20_000; history++) {
    const records: PushRecord[] = [];
    // The heads the records name as heads, which are all revisions.
    const named = new Set<string>();
    for (let count = 1 + random.below(12); count > 0; count--) {
      const head = random.pick(names);
      const before = random.below(3) === 0 ? undefined : random.pick(names);
      const at = random.time();
      named.add(head);
      switch (random.below(5)) {
        case 0:
          records.push({
            kind: 'activity',
            before,
            after: head,
            at,
            forced: random.below(2) === 0,
          });
          break;
        case 1:
          if (before !== undefined) named.add(before);
          records.push({ kind: 'forcePush', before, after: head, at });
          break;
        case 2:
          records.push({ kind: 'checkSuite', previous: before, next: head, at });
          break;
        case 3:
          records.push({ kind: 'review', commit: head, at });
          break;
        default:
          records.push({ kind: 'polled', head, at });
      }
    }
    const commits: string[] = [];
    for (let count = random.below(6); count > 0; count--) {
      const commit = random.pick(names);
      if (!commits.includes(commit)) commits.push(commit);
    }
    const head = random.pick(names);
    named.add(head);
    // Half the time the pull request opened before every push; otherwise at a random time.
    const openedBeforeEveryPush = random.below(2) === 0;
    const openedAt = openedBeforeEveryPush ? 0 : random.time();

    const revisions = buildRevisions(records, commits, head, openedAt);

    const markers: [string, string] = [random.pick(names), random.pick(names)];
    const found = problems(revisions, head, openedBeforeEveryPush ? named : undefined, markers);
    // The first few histories that go wrong, with what went wrong.
    if (found.length > 0 && failures.length < 5) {
      failures.push(
        `${found.join('; ')}: ${JSON.stringify({ records, commits, head, openedAt, markers })}`,
      );
    }
  }
  expect(failures).toEqual([]);
});
