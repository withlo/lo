// A tab's overview, checked in the window: by its text alone first, while its figures and code are
// to come, so whether it shows never waits for them; with no code until the local copy is there,
// and again once it is; never with code without git; with code once read kept, whatever a later
// read says; published again only when the result changes, with the same parse for as long as the
// commit is the same.

import { describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { CodeAccess, CodeReply, OverviewCommit, OverviewState } from '../contract.ts';
import type { CodeFile } from '../jobs.ts';
import { localJobs } from '../test/jobs.ts';
import {
  Checking,
  failedWhy,
  keyOf,
  prOf,
  type CheckedOverview,
  type CodeRead,
} from './checking.ts';

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

  it('publishes what the text alone says first, never waiting for the figures or the code', async () => {
    const WITH_FIGURE = encoder.encode(
      `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n\n:::code src/a.ts#L2\n:::\n\n:::figure figures/a.svg\nA figure.\n:::\n`,
    );
    const SVG = encoder.encode('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"/>');
    // The figure and the code come only when let go.
    let letGo!: () => void;
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const published: (CheckedOverview | undefined)[] = [];
    const checking = new Checking('t1', {
      files: async ({ paths }) => {
        if (paths[0] !== 'artifact.md') await held;
        return paths.map((path) => {
          const bytes = path === 'artifact.md' ? WITH_FIGURE : SVG;
          return { kind: 'file' as const, size: bytes.length, bytes };
        });
      },
      code: async () => {
        await held;
        return READ;
      },
      parse: (input) => localJobs.parse(input),
      check: (input) => localJobs.check(input),
      publish: (value) => published.push(value),
      log: () => {},
    });
    const commit = {
      ...commitOf(),
      entries: [
        {
          path: 'artifact.md',
          kind: 'file' as const,
          size: WITH_FIGURE.length,
          id: 'b'.repeat(40),
        },
        { path: 'figures', kind: 'folder' as const, size: null, id: 'd'.repeat(40) },
        { path: 'figures/a.svg', kind: 'file' as const, size: SVG.length, id: 'e'.repeat(40) },
      ],
    };
    checking.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(1));
    const [first] = published;
    if (first?.kind !== 'checked' || first.checked.outcome.kind !== 'shown') {
      throw new Error('not shown');
    }
    // Its figures are coming, and its code waits.
    expect(first.coming).toEqual(['figures/a.svg']);
    expect(first.figures.size).toBe(0);
    expect(first.code).toEqual({ kind: 'waiting' });
    expect(first.checked.outcome.figures.map(({ figure }) => figure.state)).toEqual(['unread']);
    expect(firstCode(first)).toMatchObject({ state: 'unread' });

    letGo();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    const [, whole] = published;
    if (whole?.kind !== 'checked' || whole.checked.outcome.kind !== 'shown') {
      throw new Error('not shown');
    }
    expect(whole.parsed).toBe(first.parsed);
    expect(whole.coming).toEqual([]);
    expect(whole.figures.get('figures/a.svg')).toMatchObject({ kind: 'file' });
    expect(whole.checked.outcome.figures.map(({ figure }) => figure.state)).toEqual(['kept']);
    expect(firstCode(whole)).toEqual({ state: 'resolved' });
  });

  it('publishes each of the first figures as it comes, before asking for the rest', async () => {
    const names = ['figures/a.svg', 'figures/b.svg', 'figures/c.svg'];
    const text = encoder.encode(
      `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n\n${names
        .map((path) => `:::figure ${path}\nA figure.\n:::\n`)
        .join('\n')}`,
    );
    const svg = encoder.encode('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"/>');
    // Each ask for figures waits until let go.
    const asked: string[][] = [];
    const waiting: (() => void)[] = [];
    const published: (CheckedOverview | undefined)[] = [];
    const checking = new Checking('t1', {
      files: async ({ paths }) => {
        if (paths[0] !== 'artifact.md') {
          asked.push(paths);
          await new Promise<void>((resolve) => waiting.push(resolve));
        }
        return paths.map((path) => {
          const bytes = path === 'artifact.md' ? text : svg;
          return { kind: 'file' as const, size: bytes.length, bytes };
        });
      },
      code: async () => READ,
      parse: (input) => localJobs.parse(input),
      check: (input) => localJobs.check(input),
      publish: (value) => published.push(value),
      log: () => {},
    });
    const commit = {
      ...commitOf(),
      entries: [
        { path: 'artifact.md', kind: 'file' as const, size: text.length, id: 'b'.repeat(40) },
        { path: 'figures', kind: 'folder' as const, size: null, id: 'd'.repeat(40) },
        ...names.map((path, index) => ({
          path,
          kind: 'file' as const,
          size: svg.length,
          id: String(index + 1).repeat(40),
        })),
      ],
    };
    checking.take(stateOf(commit, 'waiting'));
    const coming = () =>
      published.map((value) => (value?.kind === 'checked' ? value.coming.length : undefined));
    const states = (at: number) => {
      const value = published[at];
      if (value?.kind !== 'checked' || value.checked.outcome.kind !== 'shown') return undefined;
      return value.checked.outcome.figures.map(({ figure }) => figure.state);
    };

    // The text alone, with every figure coming; then the first, by itself.
    await vi.waitFor(() => expect(asked).toEqual([['figures/a.svg']]));
    expect(coming()).toEqual([3]);
    waiting.shift()?.();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toEqual(['figures/b.svg']);
    expect(coming()).toEqual([3, 2]);
    expect(states(1)).toEqual(['kept', 'unread', 'unread']);
    // The second, then the rest together, and the whole check.
    waiting.shift()?.();
    await vi.waitFor(() => expect(asked).toHaveLength(3));
    expect(asked[2]).toEqual(['figures/c.svg']);
    expect(coming()).toEqual([3, 2, 1]);
    waiting.shift()?.();
    await vi.waitFor(() => expect(coming()).toEqual([3, 2, 1, 0]));
    expect(states(3)).toEqual(['kept', 'kept', 'kept']);
  });

  it('never takes a figure drawn back to being read, as the local copy turns ready while the rest come', async () => {
    const names = ['figures/a.svg', 'figures/b.svg', 'figures/c.svg'];
    const text = encoder.encode(
      `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n\n${names
        .map((path) => `:::figure ${path}\nA figure.\n:::\n`)
        .join('\n')}`,
    );
    const svg = encoder.encode('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"/>');
    // The first two come at once; the third waits until let go.
    const asked: string[][] = [];
    let letGo!: () => void;
    const third = new Promise<void>((resolve) => (letGo = resolve));
    const published: (CheckedOverview | undefined)[] = [];
    const checking = new Checking('t1', {
      files: async ({ paths }) => {
        if (paths[0] !== 'artifact.md') asked.push(paths);
        if (paths.includes('figures/c.svg')) await third;
        return paths.map((path) => {
          const bytes = path === 'artifact.md' ? text : svg;
          return { kind: 'file' as const, size: bytes.length, bytes };
        });
      },
      code: async () => READ,
      parse: (input) => localJobs.parse(input),
      check: (input) => localJobs.check(input),
      publish: (value) => published.push(value),
      log: () => {},
    });
    const commit = {
      ...commitOf(),
      entries: [
        { path: 'artifact.md', kind: 'file' as const, size: text.length, id: 'b'.repeat(40) },
        { path: 'figures', kind: 'folder' as const, size: null, id: 'd'.repeat(40) },
        ...names.map((path, index) => ({
          path,
          kind: 'file' as const,
          size: svg.length,
          id: String(index + 1).repeat(40),
        })),
      ],
    };
    const coming = () =>
      published.map((value) => (value?.kind === 'checked' ? value.coming.join() : undefined));
    checking.take(stateOf(commit, 'waiting'));
    await vi.waitFor(() => expect(asked).toHaveLength(3));
    expect(coming()).toEqual([names.join(), 'figures/b.svg,figures/c.svg', 'figures/c.svg']);

    // The local copy turns ready, which checks again; then the third comes.
    checking.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(asked).toHaveLength(4));
    letGo();
    await vi.waitFor(() => expect(coming().at(-1)).toBe(''));
    // Nothing drawn went back to coming, and only the third was asked for again.
    expect(coming()).toEqual([names.join(), 'figures/b.svg,figures/c.svg', 'figures/c.svg', '']);
    expect(asked).toEqual([
      ['figures/a.svg'],
      ['figures/b.svg'],
      ['figures/c.svg'],
      ['figures/c.svg'],
    ]);
    const whole = published.at(-1);
    if (whole?.kind !== 'checked' || whole.checked.outcome.kind !== 'shown')
      throw new Error('not shown');
    expect(whole.checked.outcome.figures.map(({ figure }) => figure.state)).toEqual([
      'kept',
      'kept',
      'kept',
    ]);
  });

  it('publishes nothing new when nothing changed', async () => {
    const { checking, published, asked } = checkingWith(() => READ);
    const commit = commitOf();
    checking.take(stateOf(commit, 'ready'));
    // The text alone, then with its code.
    await vi.waitFor(() => expect(published).toHaveLength(2));
    // Main says more of the tab, or the copy goes offline: the code read stays read.
    checking.take({ ...stateOf(commit, 'ready'), saved: true });
    checking.take(stateOf(commit, 'offline'));
    checking.take(stateOf(commit, 'waiting'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(published).toHaveLength(2);
    expect(asked).toMatchObject({ code: 1, check: 2 });
  });

  it('reads code that was unread again, and publishes only what changed', async () => {
    let reply: CodeReply = { kind: 'read', files: [{ kind: 'unread', why: 'Offline.' }] };
    const { checking, published, asked } = checkingWith(() => reply);
    const commit = commitOf();
    checking.take(stateOf(commit, 'offline'));
    await vi.waitFor(() => expect(published).toHaveLength(2));
    // Read again, the same: nothing is checked or published again.
    checking.take(stateOf(commit, 'ready'));
    await vi.waitFor(() => expect(asked.code).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(published).toHaveLength(2);
    expect(asked.check).toBe(2);
    reply = READ;
    checking.take(stateOf(commit, 'offline'));
    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(firstCode(published[2])).toEqual({ state: 'resolved' });
    expect(asked.check).toBe(3);
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
    await vi.waitFor(() => expect(published).toHaveLength(2));
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
      expect(published).toHaveLength(2);
    }
    expect(asked.check).toBe(2);
    expect(states()).toEqual(['resolved', 'unread']);
    // What was read of it is kept by its size, not its bytes.
    expect(published[1]).toMatchObject({
      code: { kind: 'read', files: [{ answer: { kind: 'file', size: 8, read: 8 } }, {}] },
    });

    // Read in full at last.
    reply = {
      kind: 'read',
      files: [READ.files[0] ?? { kind: 'missing' }, READ.files[0] ?? { kind: 'missing' }],
    };
    checking.take(stateOf(commit, asked.code % 2 === 0 ? 'offline' : 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(3));
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
    await vi.waitFor(() => expect(published).toHaveLength(2));
    checking.take(stateOf(commitOf('e'.repeat(40)), 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(4));
    expect(last()).toMatchObject({ commit: { id: 'e'.repeat(40) } });
    const [, first, , second] = published;
    if (first?.kind !== 'checked' || second?.kind !== 'checked') throw new Error('not checked');
    expect(second.parsed).not.toBe(first.parsed);
    checking.take(stateOf(null, 'ready'));
    expect(published).toHaveLength(5);
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
    // In Lo's words: what main said goes to the log.
    expect(last()).toMatchObject({ kind: 'failed', why: 'Lo couldn’t read artifact.md.' });
    fail = false;
    failing.take({ ...stateOf(commit, 'ready'), problem: null, saved: true });
    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(firstCode(last())).toEqual({ state: 'resolved' });
    // A newer commit it can't check says why too, though the last one's check showed.
    fail = true;
    failing.take(stateOf(commitOf('e'.repeat(40)), 'ready'));
    await vi.waitFor(() => expect(published).toHaveLength(4));
    expect(last()).toMatchObject({ kind: 'failed', commit: { id: 'e'.repeat(40) } });
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

describe('failedWhy', () => {
  it('says why a check failed in Lo’s words, never the error’s own', () => {
    expect(failedWhy(new IpcError('timeout', 'overview.check ran past 10000 ms.'))).toBe(
      'Checking it took longer than Lo allows.',
    );
    expect(failedWhy(new IpcError('internal', 'SQLITE_BUSY: database is locked'))).toBe(
      'Lo can’t tell why.',
    );
    expect(failedWhy(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(
      'Lo can’t tell why.',
    );
  });
});

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
