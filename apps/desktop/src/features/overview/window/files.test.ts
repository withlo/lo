// @vitest-environment jsdom
// The files an overview's blocks show, held: read once for every block that holds one, kept a
// little while once none does, up to a bound on their text, and let go oldest first; a failed read
// is never kept, and one still being read when the last block lets it go is let go too.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { BlockText } from '../contract.ts';
import { heldFiles, holdFile, IDLE_LIMIT } from './files.ts';

vi.mock(import('../../diff/window/shared.ts'), async (original) => ({
  ...(await original()),
  diffTexts: (files) => Promise.resolve(files.map(() => ({ ok: false as const, why: 'No.' }))),
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
});

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
    expect(await first.code).toEqual({
      kind: 'code',
      lines: { old: [], new: ['a'] },
      diff: undefined,
      tokens: { new: undefined },
    });
    expect(await second.code).toBe(await first.code);
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
