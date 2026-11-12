import { describe, expect, test } from 'vitest';

import { Layout } from './layout.ts';

describe('Layout', () => {
  test('gives each side a header line and then the file’s lines there', () => {
    const layout = new Layout([
      { path: 'a.ts', old: ['1', '2'], new: ['1'] },
      { path: 'b.ts', old: [], new: ['1', '2', '3'] },
    ]);

    expect(layout.text).toEqual({ old: 'a.ts\n1\n2\nb.ts', new: 'a.ts\n1\nb.ts\n1\n2\n3' });
    expect(layout.files[1]).toEqual({ old: { header: 4, count: 0 }, new: { header: 3, count: 3 } });
    expect(layout.fileAt('new', 5)).toBe(1);
    expect(layout.fileLine('new', 5)).toBe(2);
    expect(layout.fileLine('old', 1)).toBe(0);
  });

  test('moves the files after one whose lines are loaded', () => {
    const layout = new Layout([
      { path: 'big', old: [], new: [] },
      { path: 'next', old: ['1'], new: ['1'] },
    ]);

    layout.setCount('old', 0, 5000);

    expect(layout.files[1]!.old).toEqual({ header: 5002, count: 1 });
    expect(layout.files[1]!.new).toEqual({ header: 2, count: 1 });
    expect(layout.fileAt('old', 5003)).toBe(1);
  });
});
