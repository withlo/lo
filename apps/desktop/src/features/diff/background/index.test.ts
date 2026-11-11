import { describe, expect, it } from 'vitest';

import runner, { diffFile } from './index.ts';

const lines = (...each: string[]) => `${each.join('\n')}\n`;

describe('the diff’s jobs', () => {
  it('diffs a file’s texts, and finds the lines moves are looked for among', () => {
    const result = diffFile(
      {
        kind: 'texts',
        path: 'a.ts',
        old: lines('one', 'two', 'three'),
        new: lines('one', '2', 'three'),
      },
      { whitespace: true, budget: 1000 },
    );
    if (!result.ok) throw new Error(result.why);
    expect(result.diff.changes.map(({ old, new: added }) => ({ old, new: added }))).toEqual([
      { old: { start: 2, end: 3 }, new: { start: 2, end: 3 } },
    ]);
    expect(result.lines).toBe(undefined);
    expect(result.changes).toEqual({
      deleted: [{ start: 2, text: 'two' }],
      added: [{ start: 2, text: '2' }],
    });
  });

  it('hides changes to whitespace alone on request, keeping the lines’ numbers', () => {
    const old = lines('function f() {', 'return 1;', '}', 'const a = 1;');
    const added = lines('function f() {', '  return 1;', '}', 'const a = 2;');
    const shown = diffFile(
      { kind: 'texts', path: 'a.ts', old, new: added },
      { whitespace: true, budget: 1000 },
    );
    const hidden = diffFile(
      { kind: 'texts', path: 'a.ts', old, new: added },
      { whitespace: false, budget: 1000 },
    );
    if (!shown.ok || !hidden.ok) throw new Error('no diff');

    expect(shown.diff.changes).toHaveLength(2);
    expect(hidden.diff.changes.map(({ old: from }) => from)).toEqual([{ start: 4, end: 5 }]);
    expect(hidden.diff.oldLineCount).toBe(4);
  });

  it('draws GitHub’s patch with its lines and gaps', () => {
    const result = diffFile(
      { kind: 'patch', path: 'a.ts', patch: ['@@ -3,1 +3,1 @@', '-x', '+y'].join('\n') },
      { whitespace: false, budget: 1000 },
    );
    if (!result.ok) throw new Error(result.why);
    expect(result.lines).toEqual({ old: ['', '', 'x'], new: ['', '', 'y'] });
    expect(result.gaps).toHaveLength(2);
    expect(result.changes.deleted).toEqual([{ start: 3, text: 'x' }]);
  });

  it('says which files of a batch it couldn’t diff, and diffs the rest', async () => {
    const results = await runner.jobs.files!.run({
      files: [
        { kind: 'patch', path: 'bad.ts', patch: 'not a patch' },
        { kind: 'texts', path: 'a.ts', old: null, new: lines('new') },
      ],
      whitespace: true,
      highlight: false,
      budget: 1000,
    });
    expect(results).toEqual([
      { ok: false, why: expect.any(String) },
      expect.objectContaining({ ok: true }),
    ]);
  });

  it('finds code moved from one file to another', async () => {
    const block = [
      'export function wrap(text: string) {',
      '  const lines = [];',
      '  return lines;',
      '}',
    ];
    const moves = await runner.jobs.moves!.run({
      files: [
        { deleted: [{ start: 10, text: block.join('\n') }], added: [] },
        { deleted: [], added: [{ start: 1, text: block.join('\n') }] },
      ],
    });
    expect(moves).toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ file: 0, first: 10 }),
        to: expect.objectContaining({ file: 1, first: 1 }),
      }),
    ]);
  });
});
