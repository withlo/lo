// What a tab's overview keeps from one check to the next: a result that arrives again, equal but
// made anew, hands on the objects the view already has, whole or in part.

import { describe, expect, it } from 'vitest';

import type { CodeReply, OverviewCommit, OverviewState } from '../contract.ts';
import { localJobs } from '../test/jobs.ts';
import { Checking, type CheckedOverview } from './checking.ts';
import { equal, steady } from './steady.ts';

const encoder = new TextEncoder();
const HEAD = 'a'.repeat(40);
const SVG = encoder.encode(
  '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><g id="parse"><rect x="0" y="0" width="40" height="40" fill="var(--fig-blue)"/></g></svg>',
);
const TEXT = encoder.encode(
  [
    `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n`,
    '## tl;dr\n\nIt reads [lines](term:line).\n',
    ':::code src/a.ts#L1-L2\n:::\n',
    ':::figure figures/flow.svg\nThe flow.\n\n- [parse](code:src/a.ts#L1)\n:::\n',
    '## Glossary\n\n- **Line**: one line.\n',
  ].join('\n'),
);

function commitOf(): OverviewCommit {
  return {
    id: 'c'.repeat(40),
    source: 'base',
    repository: { owner: 'o', name: 'r' },
    byline: { login: null, name: 'Someone', at: 0 },
    entries: [
      { path: 'artifact.md', kind: 'file', size: TEXT.length, id: 'b'.repeat(40) },
      { path: 'figures', kind: 'folder', size: null, id: 'd'.repeat(40) },
      { path: 'figures/flow.svg', kind: 'file', size: SVG.length, id: 'e'.repeat(40) },
    ],
    truncated: false,
    read: true,
  };
}

function stateOf(code: OverviewState['code']): OverviewState {
  return {
    id: 't1',
    ref: 'refs/lo/pr/7',
    watching: true,
    found: 'commit',
    overview: commitOf(),
    newer: null,
    saved: false,
    problem: null,
    code,
  };
}

/** A tab's checking, its results kept as the store keeps them, through {@link steady}. */
function checking(code: () => CodeReply) {
  let kept: CheckedOverview | undefined;
  const results: (CheckedOverview | undefined)[] = [];
  const checks = new Checking('t1', {
    files: async ({ paths }) =>
      paths.map((path) => {
        const bytes = path === 'artifact.md' ? TEXT : SVG;
        return { kind: 'file' as const, size: bytes.length, bytes };
      }),
    code: async () => code(),
    parse: (input) => localJobs.parse(input),
    check: (input) => localJobs.check(input),
    publish: (value) => {
      kept = steady(kept, value);
      results.push(kept);
    },
    log: () => {},
  });
  return { checks, results };
}

async function settled(results: readonly unknown[], count: number): Promise<void> {
  for (let round = 0; round < 200 && results.length < count; round++) {
    await new Promise((done) => setTimeout(done, 5));
  }
  expect(results).toHaveLength(count);
}

describe('a result checked again', () => {
  it('keeps the tree and the figures the view drew when nothing they show changed', async () => {
    const { checks, results } = checking(() => ({ kind: 'noGit' }));
    checks.take(stateOf('waiting'));
    await settled(results, 1);
    // Git turns out to be missing: the check runs again, and finds the same.
    checks.take(stateOf('noGit'));
    await settled(results, 2);
    const [first, second] = results;
    if (first?.kind !== 'checked' || second?.kind !== 'checked') throw new Error('not checked');
    expect(second).not.toBe(first);
    expect(second.parsed).toBe(first.parsed);
    expect(second.checked).toBe(first.checked);
    expect(second.figures).toBe(first.figures);
  });

  it('keeps what didn’t change, and takes what did', async () => {
    const { checks, results } = checking(() => ({
      kind: 'read',
      files: [{ kind: 'file', size: 8, bytes: encoder.encode('one\ntwo\n') }],
    }));
    checks.take(stateOf('waiting'));
    await settled(results, 1);
    checks.take(stateOf('ready'));
    await settled(results, 2);
    const [first, second] = results;
    if (first?.kind !== 'checked' || second?.kind !== 'checked') throw new Error('not checked');
    const [before, after] = [first.checked.outcome, second.checked.outcome];
    if (before.kind !== 'shown' || after.kind !== 'shown') throw new Error('not shown');
    expect(second.parsed).toBe(first.parsed);
    // The code was read, so its block's state is new; its figure's isn't.
    expect(after.code[0]).not.toBe(before.code[0]);
    expect(after.code[0]?.code).toEqual({ state: 'resolved' });
    expect(after.figures[0]).toBe(before.figures[0]);
    expect(after.header).toBe(before.header);
  });

  it('is the one before, whole, when it comes again equal, as a copy over a port does', async () => {
    const { checks, results } = checking(() => ({ kind: 'noGit' }));
    checks.take(stateOf('waiting'));
    await settled(results, 1);
    const first = results[0];
    expect(steady(first, structuredClone(first))).toBe(first);
    // For another commit, nothing is kept.
    const other = structuredClone(first);
    if (other?.kind !== 'checked') throw new Error('not checked');
    const moved = { ...other, commit: { ...other.commit, id: 'f'.repeat(40) } };
    const kept = steady(first, moved);
    expect(kept).toBe(moved);
    expect(kept?.kind === 'checked' && kept.parsed).not.toBe(
      first?.kind === 'checked' && first.parsed,
    );
  });
});

/** A tree 100,000 nodes deep. */
function deep(): object {
  let node: object = { kind: 'leaf' };
  for (let depth = 0; depth < 100_000; depth++) node = { kind: 'node', children: [node] };
  return node;
}

describe('equal', () => {
  it('compares data, bytes and maps by what they hold', () => {
    expect(equal({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] })).toBe(true);
    expect(equal({ a: [1, { b: 'c' }] }, { a: [1, { b: 'd' }] })).toBe(false);
    expect(equal({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(equal([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(equal(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equal(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equal(new Map([['a', [1]]]), new Map([['a', [1]]]))).toBe(true);
    expect(equal(new Map([['a', [1]]]), new Map([['b', [1]]]))).toBe(false);
    expect(equal(Number.NaN, Number.NaN)).toBe(true);
  });

  it('walks a deep tree without running out of stack', () => {
    expect(equal(deep(), deep())).toBe(true);
  });
});
