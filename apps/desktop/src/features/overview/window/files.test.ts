// @vitest-environment jsdom
// The files an overview's blocks show, held: read once for every block that holds one, kept a
// little while once none does, up to a bound on their text, and let go oldest first; a failed read
// is never kept, and one still being read when the last block lets it go is let go too. A small
// file is diffed at once, its highlighting following; a larger one waits for the diff's job.

import { diffText } from '@lo/diff';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { DiffedText } from '../../diff/window/shared.ts';
import type { BlockText } from '../contract.ts';
import { heldFiles, holdFile, IDLE_LIMIT, QUICK_LIMIT } from './files.ts';

/** What the diff's job answers next, which a test may hold back: by default, that it couldn't. */
const job = vi.hoisted(() => ({
  answer: undefined as (() => Promise<DiffedText[]>) | undefined,
}));

vi.mock(import('../../diff/window/shared.ts'), async (original) => ({
  ...(await original()),
  diffTexts: (files) =>
    job.answer?.() ?? Promise.resolve(files.map(() => ({ ok: false as const, why: 'No.' }))),
}));

/** What main answers for each file, by its path, or a promise the test settles. */
const texts = new Map<string, BlockText | Promise<BlockText>>();

const bridge = installBridge({
  'overview.texts': (input) => {
    const path: unknown = Reflect.get(Object(input), 'path');
    const found = typeof path === 'string' ? texts.get(path) : undefined;
    if (!found) throw new Error(`No text for ${String(path)}.`);
    return found;
  },
});

const COMMIT = 'c'.repeat(40);
let tabs = 0;

afterEach(() => {
  texts.clear();
  bridge.calls.length = 0;
  job.answer = undefined;
});

/** Holds the diff's job back until the returned function answers it, diffing `old` to `now`. */
function heldJob(old: string, now: string): () => void {
  let answer!: () => void;
  job.answer = () =>
    new Promise((resolve) => {
      answer = () =>
        resolve([
          {
            ok: true,
            diff: diffText(old, now),
            tokens: { new: Uint32Array.of(0, 1, 2) },
            changes: { deleted: [], added: [] },
          },
        ]);
    });
  return () => answer();
}

/** A tab of its own for each test. */
function tabOf(): string {
  tabs += 1;
  return `files${tabs}`;
}

const asked = () => bridge.calls.filter(([channel]) => channel === 'overview.texts').length;

describe('holdFile', () => {
  it('reads a file once for every block that holds it, and keeps it a while once none does', async () => {
    const tab = tabOf();
    texts.set('a.ts', { kind: 'text', text: 'a\n', base: { kind: 'same' } });
    const first = holdFile(tab, COMMIT, 'a.ts');
    const second = holdFile(tab, COMMIT, 'a.ts');
    const code = await first.code;
    expect(code).toMatchObject({ kind: 'code', lines: { old: [], new: ['a'] }, diff: undefined });
    expect(code.kind === 'code' && (await code.tokens)).toEqual({ new: undefined });
    expect(await second.code).toBe(code);
    first.release();
    second.release();
    const again = holdFile(tab, COMMIT, 'a.ts');
    await again.code;
    again.release();
    expect(asked()).toBe(1);
  });

  it('lets the files no block holds go, oldest first, past the bound on their text', async () => {
    const tab = tabOf();
    const big = 'x'.repeat(IDLE_LIMIT / 2 + 1);
    for (const path of ['one.ts', 'two.ts']) {
      texts.set(path, { kind: 'text', text: big, base: { kind: 'same' } });
      const hold = holdFile(tab, COMMIT, path);
      await hold.code;
      hold.release();
    }
    const before = asked();
    const two = holdFile(tab, COMMIT, 'two.ts');
    await two.code;
    two.release();
    expect(asked()).toBe(before);
    const one = holdFile(tab, COMMIT, 'one.ts');
    await one.code;
    one.release();
    expect(asked()).toBe(before + 1);
  });

  it('diffs a small file at once, and takes its highlighting from the diff’s job once it’s in', async () => {
    const tab = tabOf();
    const answer = heldJob('a\n', 'b\n');
    texts.set('c.ts', {
      kind: 'text',
      text: 'b\n',
      base: { kind: 'changed', path: 'c.ts', text: 'a\n' },
    });
    const hold = holdFile(tab, COMMIT, 'c.ts');
    const code = await hold.code;
    expect(code).toMatchObject({ kind: 'code', lines: { old: ['a'], new: ['b'] } });
    expect(code.kind === 'code' && code.diff).toEqual(diffText('a\n', 'b\n'));
    answer();
    expect(code.kind === 'code' && (await code.tokens)).toMatchObject({
      new: Uint32Array.of(0, 1, 2),
    });
    hold.release();
  });

  it('waits for the diff’s job to diff a larger file', async () => {
    const tab = tabOf();
    const large = 'x\n'.repeat(QUICK_LIMIT);
    const answer = heldJob('', large);
    texts.set('big.ts', { kind: 'text', text: large, base: { kind: 'added' } });
    const hold = holdFile(tab, COMMIT, 'big.ts');
    let code: unknown;
    void hold.code.then((found) => (code = found));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(code).toBeUndefined();
    answer();
    await hold.code;
    expect(code).toMatchObject({ kind: 'code', diff: diffText('', large) });
    hold.release();
  });

  it('never keeps a failed read, nor one let go before it’s in', async () => {
    const tab = tabOf();
    texts.set('gone.ts', { kind: 'unread', why: 'It isn’t text.' });
    const failed = holdFile(tab, COMMIT, 'gone.ts');
    expect(await failed.code).toEqual({ kind: 'unread', why: 'It isn’t text.' });
    const held = heldFiles();
    failed.release();
    expect(heldFiles()).toBe(held - 1);

    let answer!: (text: BlockText) => void;
    texts.set('slow.ts', new Promise((resolve) => (answer = resolve)));
    const slow = holdFile(tab, COMMIT, 'slow.ts');
    slow.release();
    expect(heldFiles()).toBe(held - 1);
    answer({ kind: 'text', text: 's\n', base: null });
    await slow.code;
    expect(heldFiles()).toBe(held - 1);
  });
});
