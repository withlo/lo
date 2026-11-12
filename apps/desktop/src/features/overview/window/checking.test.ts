// A tab's overview, checked in the window: with no code until the local copy is there, and again
// once it is; never with code without git; with code once read kept, whatever a later read says;
// published again only when the result changes, with the same parse for as long as the commit is
// the same.

import { describe, expect, it, vi } from 'vitest';

import type { CodeAccess, CodeReply, OverviewCommit, OverviewState } from '../contract.ts';
import type { CodeFile } from '../jobs.ts';
import { localJobs } from '../test/jobs.ts';
import { Checking, keyOf, prOf, type CheckedOverview, type CodeRead } from './checking.ts';

const encoder = new TextEncoder();
const HEAD = 'a'.repeat(40);

const TEXT = encoder.encode(
  `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n\n:::code src/a.ts#L2\n:::\n`,
);

/** An overview commit main read, holding `TEXT`. */
function commitOf(id = 'c'.repeat(40), read = true): OverviewCommit {
  return {
    id,
    source: 'base',
    repository: { owner: 'o', name: 'r' },
    byline: { login: null, name: 'Someone', at: 0 },
    entries: [{ path: 'artifact.md', kind: 'file', size: TEXT.length, id: 'b'.repeat(40) }],
    truncated: false,
    read,
  };
}

function stateOf(overview: OverviewCommit | null, code: CodeAccess): OverviewState {
  return {
    id: 't1',
    ref: 'refs/lo/pr/7',
    watching: true,
    found: overview ? 'commit' : 'none',
    overview,
    newer: null,
    saved: false,
    problem: null,
    code,
  };
}

/** A tab's checking, with main answering from `code`, and what it published and asked. */
function checkingWith(code: (files: CodeFile[]) => CodeReply) {
  const published: (CheckedOverview | undefined)[] = [];
  const asked = { files: 0, code: 0, parse: 0, check: 0 };
  const checking = new Checking('t1', {
    files: async ({ paths }) => {
      asked.files += 1;
      return paths.map(() => ({ kind: 'file' as const, size: TEXT.length, bytes: TEXT }));
    },
    code: async ({ files }) => {
      asked.code += 1;
      return code(files);
    },
    parse: (input) => {
      asked.parse += 1;
      return localJobs.parse(input);
    },
    check: (input) => {
      asked.check += 1;
      return localJobs.check(input);
    },
    publish: (value) => published.push(value),
    log: () => {},
  });
  return { checking, published, asked, last: () => published.at(-1) };
}

const READ: CodeReply = {
  kind: 'read',
  files: [{ kind: 'file', size: 8, bytes: encoder.encode('one\ntwo\n') }],
};

/** The code state of the first target in what was published last. */
function firstCode(value: CheckedOverview | undefined) {
  if (value?.kind !== 'checked' || value.checked.outcome.kind !== 'shown') return undefined;
  return value.checked.outcome.code[0]?.code;
}

describe('Checking', () => {
  it('checks with no code until the local copy is there, then again, keeping the parse', async () => {
    const { checking, published, asked, last } = checkingWith(() => READ);
    const commit = commitOf();
    checking.take(stateOf(commit, 'waiting'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(firstCode(last())).toEqual({ state: 'unread', why: 'failed' });
    expect(last()).toMatchObject({ kind: 'checked', code: { kind: 'waiting' } });
    expect(asked.code).toBe(0);
    const first = last();

    checking.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(firstCode(last())).toEqual({ state: 'resolved' });
    const second = last();
    if (first?.kind !== 'checked' || second?.kind !== 'checked') throw new Error('not checked');
    // The same parse, so what was drawn of it stays.
    expect(second.parsed).toBe(first.parsed);
    expect(second.key).not.toBe(first.key);
    expect(asked).toMatchObject({ files: 1, parse: 1, code: 1, check: 2 });
  });

  it('publishes nothing new when nothing changed', async () => {
    const { checking, published, asked } = checkingWith(() => READ);
    const commit = commitOf();
    checking.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    // Main says more of the tab, or the copy goes offline: the code read stays read.
    checking.take({ ...stateOf(commit, 'ready'), saved: true });
    checking.take(stateOf(commit, 'offline'));
    checking.take(stateOf(commit, 'waiting'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(published).toHaveLength(1);
    expect(asked).toMatchObject({ code: 1, check: 1 });
  });

  it('reads code that was unread again, and publishes only what changed', async () => {
    let reply: CodeReply = { kind: 'read', files: [{ kind: 'unread', why: 'Offline.' }] };
    const { checking, published, asked } = checkingWith(() => reply);
    const commit = commitOf();
    checking.take(stateOf(commit, 'offline'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    // Read again, the same: nothing is checked or published again.
    checking.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(asked.code).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(published).toHaveLength(1);
    expect(asked.check).toBe(1);
    reply = READ;
    checking.take(stateOf(commit, 'offline'));
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(firstCode(published[1])).toEqual({ state: 'resolved' });
    expect(asked.check).toBe(2);
  });

  it('keeps code it read when reading it again fails, or reads less of it', async () => {
    const TWO = encoder.encode(
      `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n\n:::code src/a.ts#L2\n:::\n\n:::code src/b.ts#L1\n:::\n`,
    );
    const half: CodeReply = {
      kind: 'read',
      files: [READ.files[0] ?? { kind: 'missing' }, { kind: 'unread', why: 'Offline.' }],
    };
    let reply: CodeReply = half;
    const published: (CheckedOverview | undefined)[] = [];
    const asked = { code: 0, check: 0 };
    const checking = new Checking('t1', {
      files: async ({ paths }) =>
        paths.map(() => ({ kind: 'file' as const, size: TWO.length, bytes: TWO })),
      code: async () => {
        asked.code += 1;
        return reply;
      },
      parse: (input) => localJobs.parse(input),
      check: (input) => {
        asked.check += 1;
        return localJobs.check(input);
      },
      publish: (value) => published.push(value),
      log: () => {},
    });
    const commit = commitOf();
    checking.take(stateOf(commit, 'offline'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    const states = () => {
      const last = published.at(-1);
      if (last?.kind !== 'checked' || last.checked.outcome.kind !== 'shown') return [];
      return last.checked.outcome.code.map(({ code }) => code.state);
    };
    expect(states()).toEqual(['resolved', 'unread']);

    // Read again as the copy comes back, the read fails, or the copy isn't there after all, or
    // what was read is unread now: what was read stays.
    for (const again of [
      { kind: 'failed', why: 'It broke.' },
      { kind: 'waiting' },
      {
        kind: 'read',
        files: [
          { kind: 'unread', why: 'Gone.' },
          { kind: 'unread', why: 'Gone.' },
        ],
      },
    ] satisfies CodeReply[]) {
      reply = again;
      const before = asked.code;
      checking.take(stateOf(commit, asked.code % 2 === 0 ? 'offline' : 'ready'));
      await vi.waitFor(() => expect(asked.code).toBe(before + 1));
      // Settled before the copy's state changes again.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(published).toHaveLength(1);
    }
    expect(asked.check).toBe(1);
    expect(states()).toEqual(['resolved', 'unread']);
    // What was read of it is kept by its size, not its bytes.
    expect(published[0]).toMatchObject({
      code: { kind: 'read', files: [{ answer: { kind: 'file', size: 8, read: 8 } }, {}] },
    });

    // Read in full at last.
    reply = {
      kind: 'read',
      files: [READ.files[0] ?? { kind: 'missing' }, READ.files[0] ?? { kind: 'missing' }],
    };
    checking.take(stateOf(commit, asked.code % 2 === 0 ? 'offline' : 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(states()).toEqual(['resolved', 'resolved']);
  });

  it('never asks for code without git', async () => {
    const { checking, published, asked, last } = checkingWith(() => READ);
    checking.take(stateOf(commitOf(), 'noGit'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(last()).toMatchObject({ code: { kind: 'noGit' } });
    expect(firstCode(last())).toMatchObject({ state: 'unread' });
    expect(asked.code).toBe(0);
  });

  it('checks a commit whose text main didn’t read from its listing alone', async () => {
    const { checking, published, asked, last } = checkingWith(() => READ);
    checking.take(stateOf(commitOf('d'.repeat(40), false), 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(last()).toMatchObject({ kind: 'checked', parsed: undefined });
    expect(asked).toMatchObject({ files: 0, parse: 0, code: 0 });
  });

  it('starts again for a new commit, and forgets the overview once there’s none', async () => {
    const { checking, published, last } = checkingWith(() => READ);
    checking.take(stateOf(commitOf(), 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    checking.take(stateOf(commitOf('e'.repeat(40)), 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(last()).toMatchObject({ commit: { id: 'e'.repeat(40) } });
    const [first, second] = published;
    if (first?.kind !== 'checked' || second?.kind !== 'checked') throw new Error('not checked');
    expect(second.parsed).not.toBe(first.parsed);
    checking.take(stateOf(null, 'ready'));
    expect(published).toHaveLength(3);
    expect(last()).toBe(undefined);
  });

  it('says why when it can’t check, and tries again when main next speaks', async () => {
    let fail = true;
    const { checking, published, last } = checkingWith(() => READ);
    const failing = new Checking('t1', {
      files: async ({ paths }) =>
        paths.map(() =>
          fail
            ? { kind: 'unread' as const, why: 'GitHub was out of reach.' }
            : { kind: 'file' as const, size: TEXT.length, bytes: TEXT },
        ),
      code: async () => READ,
      parse: (input) => localJobs.parse(input),
      check: (input) => localJobs.check(input),
      publish: (value) => published.push(value),
      log: () => {},
    });
    checking.stop();
    const commit = commitOf();
    failing.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(last()).toMatchObject({ kind: 'failed', why: expect.stringContaining('out of reach') });
    fail = false;
    failing.take({ ...stateOf(commit, 'ready'), problem: null, saved: true });
    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(firstCode(last())).toEqual({ state: 'resolved' });
  });

  it('publishes nothing once stopped', async () => {
    const { checking, published } = checkingWith(() => READ);
    checking.take(stateOf(commitOf(), 'ready'));
    checking.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(published).toEqual([]);
  });
});

/** Code read at `HEAD`: one file, of `size` bytes, all of it read. */
function readOf(size: number): CodeRead {
  return {
    kind: 'read',
    commit: HEAD,
    files: [{ path: 'a', lines: true, answer: { kind: 'file', size, read: size } }],
  };
}

describe('keyOf', () => {
  it('tells results apart by what was read, not by the bytes read', () => {
    const commit = commitOf();
    expect(keyOf(commit, 'f', readOf(3))).toBe(keyOf(commit, 'f', readOf(3)));
    expect(keyOf(commit, 'f', readOf(3))).not.toBe(keyOf(commit, 'f', readOf(4)));
    expect(keyOf(commit, 'f', readOf(3))).not.toBe(keyOf(commit, 'g', readOf(3)));
    expect(keyOf(commit, 'f', { kind: 'waiting' })).not.toBe(keyOf(commit, 'f', { kind: 'noGit' }));
    expect(keyOf(commit, '', { kind: 'none' })).not.toBe(
      keyOf(commitOf('f'.repeat(40)), '', { kind: 'none' }),
    );
  });
});

describe('prOf', () => {
  it('reads the pull request a ref is for', () => {
    expect(prOf('refs/lo/pr/80')).toBe(80);
    expect(prOf('refs/lo/pr/080')).toBe(undefined);
    expect(prOf('')).toBe(undefined);
  });
});
