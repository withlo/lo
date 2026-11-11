import { describe, expect, test } from 'vitest';

import { answer, overviewFiles, repository, silent, type Paths } from '../test/readers.ts';
import { overview, PREAMBLE_LINES } from '../test/support.ts';
import {
  BINARY_WINDOW,
  checkArtifact,
  LIMITS,
  lineCount,
  parseArtifact,
  type CheckedArtifact,
  type CheckOptions,
  type CodeReader,
  type CodeState,
  type FileAnswer,
} from './index.ts';

const LINE = PREAMBLE_LINES + 1;
const COMMIT = '3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';

/** `body`'s overview checked against `readCode`. */
async function checkWith(
  body: string,
  readCode: CodeReader,
  options: CheckOptions = {},
): Promise<CheckedArtifact> {
  const text = overview(body);
  return checkArtifact(
    parseArtifact(text),
    overviewFiles({ 'artifact.md': text }),
    readCode,
    options,
  );
}

/** `body`'s overview checked against a repository holding `paths`: what it found, and asked. */
async function check(body: string, paths: Paths, options: CheckOptions = {}) {
  const repo = repository(COMMIT, paths);
  const checked = await checkWith(body, repo.readCode, options);
  return { ...checked, asked: repo.asked, states: states(checked), found: found(checked) };
}

/** Each target's code. */
function states(checked: CheckedArtifact): CodeState[] {
  const { outcome } = checked;
  return outcome.kind === 'shown' ? outcome.code.map(({ code }) => code) : [];
}

function found(checked: CheckedArtifact): string[] {
  return checked.findings.map(({ code, line }) => (line === undefined ? code : `${code}@${line}`));
}

const resolved: CodeState = { state: 'resolved' };
const broken = (why: Extract<CodeState, { state: 'broken' }>['why']): CodeState => ({
  state: 'broken',
  why,
});

/** `count` of `state`. */
function times(count: number, state: CodeState): CodeState[] {
  return Array.from({ length: count }, () => state);
}

const stopped: CodeState = { state: 'unread', why: 'stopped' };

/** `text` as UTF-8. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** `count` lines of code. */
function lines(count: number): string {
  return Array.from({ length: count }, (_, n) => `line ${n + 1}`).join('\n');
}

describe('code', () => {
  test('a block, a step and links to lines and to whole files resolve', async () => {
    const checked = await check(
      [
        ':::code src/a.ts#L1-L3',
        ':::',
        ':::walkthrough W',
        ...[1, 2, 3].flatMap((n) => [`:::step src/a.ts#L${n}`, 'S.', ':::']),
        ':::',
        '[b](code:src/b.ts#L2) [c](code:src/c.ts) [space](<code:docs/read me.md>)',
        '',
      ].join('\n'),
      { 'src/a.ts': lines(3), 'src/b.ts': lines(2), 'src/c.ts': '', 'docs/read me.md': 'Hi.' },
    );
    expect(checked.findings).toEqual([]);
    expect(checked.states).toEqual(times(7, resolved));
  });

  test('each file is read once, in the order it’s first named, and a whole file not at all', async () => {
    const { asked } = await check(
      '[c](code:src/c.ts) [a](code:src/a.ts#L1) [a2](code:src/a.ts#L2) [a3](code:src/a.ts)\n\n:::code src/b.ts#L1\n:::\n',
      { 'src/a.ts': lines(2), 'src/b.ts': lines(1), 'src/c.ts': lines(1) },
    );
    // In the order of their lines, the block's first; a file named whole only is asked for no bytes.
    expect(asked).toEqual([
      { commit: COMMIT, path: 'src/c.ts', cap: 0 },
      { commit: COMMIT, path: 'src/a.ts', cap: LIMITS.file },
      { commit: COMMIT, path: 'src/b.ts', cap: LIMITS.file },
    ]);
  });

  test('a path names exactly one file: the same bytes, the same case, never normalized', async () => {
    const checked = await check(
      '[a](code:src/A.ts) [b](code:café.ts) [c](code:%2e%2e/etc/passwd) [d](code:src/a.ts/)\n',
      { 'src/a.ts': 'a', 'café.ts': 'b', '../etc/passwd': 'root' },
    );
    // The last isn't a path, so it's never asked for.
    expect(checked.asked.map(({ path }) => path)).toEqual([
      'src/A.ts',
      'café.ts',
      '%2e%2e/etc/passwd',
    ]);
    expect(found(checked)).toEqual([
      `target-path@${LINE}`,
      `code-missing@${LINE}`,
      `code-missing@${LINE}`,
      `code-missing@${LINE}`,
    ]);
    expect(checked.findings[1]?.message).toBe(
      "src/A.ts isn't at the header's commit. A path names a file exactly, in the same case.",
    );
  });

  test('a path up and out of the repository is refused before anything is read', async () => {
    const checked = await check(
      ':::code ../../etc/passwd#L1\n:::\n\n[a](code:/etc/passwd) [b](code:.git/config) [c](code:src/../../x)\n',
      { '../../etc/passwd': 'root' },
    );
    expect(checked.asked).toEqual([]);
    expect(checked.outcome).toEqual({ kind: 'invalid' });
  });

  test.each([
    ['a link', 'link'],
    ['a folder', 'folder'],
    ['a submodule', 'submodule'],
  ] as const)('a target at %s is broken', async (what, kind) => {
    const checked = await check(':::code x#L1\n:::\n\n[x](code:x)\n', { x: { kind } });
    expect(checked.states).toEqual([broken('notFile'), broken('notFile')]);
    expect(found(checked)).toEqual([`code-not-file@${LINE}`, `code-not-file@${LINE + 3}`]);
    expect(checked.findings[0]?.message).toBe(`x is ${what}, not a file.`);
  });

  test('a link is never followed, to a file or through a folder', async () => {
    // The reader holds the link, and what's under it only as the link's target would make it.
    const checked = await check('[a](code:links/passwd#L1) [b](code:links/up/a.ts#L1)\n', {
      'links/passwd': { kind: 'link', size: 11 },
      'links/up': { kind: 'link', size: 3 },
    });
    expect(checked.states).toEqual([broken('notFile'), broken('missing')]);
  });

  test('a file with a NUL in its first 8 KiB isn’t text', async () => {
    const binary = new Uint8Array(BINARY_WINDOW).fill(0x61);
    binary[BINARY_WINDOW - 1] = 0;
    const late = new Uint8Array(BINARY_WINDOW + 1).fill(0x61);
    late[BINARY_WINDOW] = 0;
    const checked = await check('[a](code:a.bin#L1) [b](code:b.bin#L1) [c](code:a.bin)\n', {
      'a.bin': binary,
      'b.bin': late,
    });
    // Named whole, a binary file is there to open.
    expect(checked.states).toEqual([broken('binary'), resolved, resolved]);
    expect(checked.findings.map(({ message }) => message)).toEqual([
      "a.bin isn't text, so it has no lines to show.",
    ]);
  });

  test('lines past the end are broken, counting as git does', async () => {
    const checked = await check(
      [
        ':::code a.ts#L3',
        ':::',
        ':::code a.ts#L4',
        ':::',
        ':::code b.ts#L2',
        ':::',
        ':::code b.ts#L1-L3',
        ':::',
        ':::code empty.ts#L1',
        ':::',
        ':::code crlf.ts#L3',
        ':::',
        ':::code cr.ts#L2',
        ':::',
        '',
      ].join('\n'),
      {
        'a.ts': 'a\nb\nc\n',
        'b.ts': 'a\nb',
        'empty.ts': '',
        'crlf.ts': 'a\r\nb\r\nc\r\n',
        // A carriage return alone ends no line.
        'cr.ts': 'a\rb\r',
      },
    );
    expect(checked.states).toEqual([
      resolved,
      broken('lines'),
      resolved,
      broken('lines'),
      broken('lines'),
      resolved,
      broken('lines'),
    ]);
    expect(checked.findings.map(({ message }) => message)).toEqual([
      "a.ts has 3 lines, so line 4 isn't there.",
      "b.ts has 2 lines, so lines 1 to 3 aren't all there.",
      "empty.ts has no lines, so line 1 isn't there.",
      "cr.ts has 1 line, so line 2 isn't there.",
    ]);
  });

  test('lines are counted at newlines', () => {
    expect(['', '\n', 'a', 'a\n\n', 'a\nb'].map((text) => lineCount(utf8(text)))).toEqual([
      0, 1, 1, 2, 2,
    ]);
  });

  test('a file past 10 MiB isn’t read, and its lines are broken', async () => {
    const checked = await check(
      '[a](code:big.ts#L1) [b](code:huge.ts#L1) [c](code:huge.ts) [d](code:at.ts#L1)\n',
      {
        'big.ts': { kind: 'file', size: LIMITS.file + 1 },
        'huge.ts': { kind: 'file', size: 2 ** 31 },
        'at.ts': { kind: 'file', size: LIMITS.file },
      },
    );
    expect(checked.states).toEqual([broken('tooLarge'), broken('tooLarge'), resolved, resolved]);
    expect(checked.findings[0]?.message).toBe(
      'big.ts is larger than 10 MiB, the most Lo reads of a file to show its lines.',
    );
  });

  test('at most 64 MiB of code is read for an overview, in the order it’s named', async () => {
    const paths: Record<string, { kind: 'file'; size: number }> = {};
    const links: string[] = [];
    for (let n = 0; n < 8; n++) {
      paths[`f${n}.ts`] = { kind: 'file', size: LIMITS.file };
      links.push(`[${n}](code:f${n}.ts#L1)`);
    }
    // Named whole, a file takes none of it.
    paths['whole.ts'] = { kind: 'file', size: LIMITS.file };
    links.push('[w](code:whole.ts)');
    const checked = await check(`${links.join('\n')}\n`, paths);
    const left = LIMITS.code - 6 * LIMITS.file;
    expect(checked.asked.map(({ cap }) => cap)).toEqual([
      ...Array.from({ length: 6 }, () => LIMITS.file),
      left,
      left,
      0,
    ]);
    expect(checked.states).toEqual([
      ...times(6, resolved),
      broken('tooLarge'),
      broken('tooLarge'),
      resolved,
    ]);
    expect(checked.findings[0]?.message).toBe(
      'Lo reads at most 64 MiB of code for an overview, and the files named before f6.ts take that up. Name fewer large files.',
    );
  });

  test('a commit the repository doesn’t have breaks every target, said once, and stops reading', async () => {
    const repo = repository('0'.repeat(40), { 'a.ts': 'a' });
    const checked = await checkWith(
      ':::code a.ts#L1\n:::\n\n[b](code:b.ts) [c](code:c.ts#L1)\n',
      repo.readCode,
    );
    expect(states(checked)).toEqual(times(3, broken('commit')));
    expect(found(checked)).toEqual(['code-commit']);
    expect(checked.findings[0]?.message).toBe(
      `The repository doesn't have commit ${COMMIT}, the one the header names, so its code can't be shown.`,
    );
    expect(repo.asked).toHaveLength(1);
  });
});

/** An answer no reader may give, as JSON: it can't be typed as one. */
function unlike(json: string): () => Promise<FileAnswer> {
  return () => Promise.resolve(JSON.parse(json).answer);
}

describe('a reader that misbehaves', () => {
  const held: Paths = { 'a.ts': lines(3), 'b.ts': lines(3) };
  const body = '[a](code:a.ts#L1) [b](code:b.ts#L1)\n';

  /** A reader that answers a.ts with what `wrong` gives, and b.ts as it should. */
  function wrongOnA(wrong: () => Promise<FileAnswer>): CodeReader {
    return async (_commit, path, cap) => (path === 'a.ts' ? wrong() : answer(held, path, cap));
  }

  test.each([
    [
      'throws',
      () => {
        throw new Error('no');
      },
    ],
    ['rejects', () => Promise.reject(new Error('no'))],
    ['answers nothing', unlike('{}')],
    ['answers null', unlike('{ "answer": null }')],
    ['answers a kind it can’t', unlike('{ "answer": { "kind": "maybe" } }')],
    ['answers text, not bytes', unlike('{ "answer": { "kind": "bytes", "bytes": "line 1" } }')],
    [
      'answers a kind of entry it can’t',
      unlike('{ "answer": { "kind": "notFile", "is": "socket" } }'),
    ],
  ])('one that %s leaves that file unread, and the rest are read', async (_what, wrong) => {
    const checked = await checkWith(body, wrongOnA(wrong));
    expect(states(checked)).toEqual([{ state: 'unread', why: 'failed' }, resolved]);
    // What's unread isn't the overview's doing.
    expect(checked.findings).toEqual([]);
  });

  /** A reader that throws for a.ts before it returns a promise. */
  const throwing: CodeReader = (_commit, path, cap) => {
    if (path === 'a.ts') throw new Error('no');
    return Promise.resolve(answer(held, path, cap));
  };

  test('one that throws before it returns a promise', async () => {
    const checked = await checkWith(body, throwing);
    expect(states(checked)).toEqual([{ state: 'unread', why: 'failed' }, resolved]);
  });

  test('one that reads past the cap is taken at its cap, not its word', async () => {
    const checked = await checkWith('[a](code:a.ts#L1) [w](code:b.ts)\n', async () => ({
      kind: 'bytes',
      bytes: new Uint8Array(LIMITS.file + 1),
    }));
    // Asked for none of b.ts, it gave bytes: b.ts is there, as a file too large to read.
    expect(states(checked)).toEqual([broken('tooLarge'), resolved]);
  });

  test('one that never answers is stopped at the timeout', async () => {
    const started = performance.now();
    const checked = await checkWith(body, silent, { timeout: 50 });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(states(checked)).toEqual(times(2, stopped));
    expect(checked.findings).toEqual([]);
  });

  test('one that’s slow is stopped at the timeout, keeping what it read in time', async () => {
    const files: Paths = Object.fromEntries(
      Array.from({ length: 20 }, (_, n) => [`f${n}.ts`, 'a']),
    );
    const slow: CodeReader = (_commit, path, cap) =>
      new Promise((resolve) => setTimeout(() => resolve(answer(files, path, cap)), 20));
    const links = Object.keys(files)
      .map((path) => `[x](code:${path}#L1)`)
      .join(' ');
    const started = performance.now();
    const checked = await checkWith(`${links}\n`, slow, { timeout: 100 });
    expect(performance.now() - started).toBeLessThan(1_000);
    const got = states(checked);
    expect(got[0]).toEqual(resolved);
    expect(got.at(-1)).toEqual({ state: 'unread', why: 'stopped' });
  });

  test('the caller’s signal stops it, and one aborted already asks nothing', async () => {
    const stop = new AbortController();
    const reading = checkWith(body, silent, { signal: stop.signal });
    stop.abort();
    expect(states(await reading)).toEqual(times(2, stopped));
    const repo = repository(COMMIT, held);
    const aborted = await checkWith(body, repo.readCode, { signal: AbortSignal.abort() });
    expect(states(aborted)).toEqual(times(2, stopped));
    expect(repo.asked).toEqual([]);
  });

  test('a reader still at work is told its answer isn’t wanted', async () => {
    const signals: AbortSignal[] = [];
    const reader: CodeReader = (_commit, _path, _cap, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    };
    await checkWith(body, reader, { timeout: 10 });
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) expect(signal.aborted).toBe(true);
  });

  test('a timeout that isn’t a number of milliseconds is the default, never none', async () => {
    for (const timeout of [Infinity, -1, Number.NaN]) {
      const checked = await check(body, held, { timeout });
      expect(checked.states).toEqual([resolved, resolved]);
    }
  });
});
