import { describe, expect, it } from 'vitest';

import { CHUNK, find, match, type Searched } from './find.ts';

const paths = (texts: readonly string[], changed: readonly string[] = []): Searched[] =>
  texts.map((text) => ({ path: { text }, changed: changed.includes(text) }));

describe('match', () => {
  it('finds the query’s characters in order, ignoring case', () => {
    expect(match('prs', 'src/Parser.ts')?.matched).toBeDefined();
    expect(match('xyz', 'src/parser.ts')).toBeUndefined();
    // In order only.
    expect(match('sp', 'ps')).toBeUndefined();
  });

  it('marks where it matched, preferring a run in the file’s name', () => {
    expect(match('parser', 'src/parser.ts')?.matched).toEqual([4, 5, 6, 7, 8, 9]);
    expect(match('wrap', 'src/text/wrap.ts')?.matched).toEqual([9, 10, 11, 12]);
  });

  it('scores a name that starts with the query over one that only holds it', () => {
    const starts = match('wrap', 'src/wrap.ts')?.score ?? 0;
    const holds = match('wrap', 'src/unwrapped.ts')?.score ?? 0;
    const folder = match('wrap', 'wrap/index.ts')?.score ?? 0;
    expect(starts).toBeGreaterThan(holds);
    expect(starts).toBeGreaterThan(folder);
  });

  it('matches everything with an empty query', () => {
    expect(match('', 'a.ts')).toEqual({ score: 0, matched: [] });
  });
});

const never = () => undefined;

describe('find', () => {
  it('lists changed files first, then the best matches, then path order', async () => {
    const results = await find(
      'ts',
      paths(['b.ts', 'a.ts', 'src/ts/x.md', 'c.ts'], ['c.ts']),
      never,
    );
    expect(results.found.map((file) => file.path.text)).toEqual([
      'c.ts',
      'a.ts',
      'b.ts',
      'src/ts/x.md',
    ]);
    expect(results.total).toBe(4);
  });

  it('gives no more than its limit, and counts every match', async () => {
    const many = paths(Array.from({ length: 250 }, (_, index) => `f${index}.ts`));
    const results = await find('f', many, never);
    expect(results.found).toHaveLength(100);
    expect(results.total).toBe(250);
  });

  it('gives way between chunks, and stops once told to', async () => {
    const many = paths(Array.from({ length: CHUNK * 3 }, (_, index) => `file${index}.ts`));
    let checks = 0;
    const stop = new Error('superseded');
    const stopped = () => (++checks >= 2 ? stop : undefined);
    await expect(find('file', many, stopped)).rejects.toBe(stop);
    expect(checks).toBe(2);
  });
});
