import { expect, test } from 'vitest';

import { describeProgress, parseProgressLine, percent, type Progress } from './progress.ts';

function parse(line: string): Progress | undefined {
  return parseProgressLine(line)?.progress;
}

function progress(stage: string, done: number, total?: number): Progress {
  return { stage, done, total };
}

test('parses gits progress lines', () => {
  expect(parse('remote: Counting objects:  25% (1/4)        ')).toEqual(
    progress('Counting objects', 1, 4),
  );
  expect(parse('Receiving objects:  45% (555/1234), 1.20 MiB | 2.40 MiB/s')).toEqual(
    progress('Receiving objects', 555, 1234),
  );
  expect(parse('Resolving deltas: 100% (10/10), done.')).toEqual(
    progress('Resolving deltas', 10, 10),
  );
  expect(parse('remote: Enumerating objects: 4, done.        ')).toEqual(
    progress('Enumerating objects', 4),
  );
  expect(parse('remote: Enumerating objects: 1234')).toEqual(progress('Enumerating objects', 1234));
});

const source = (line: string) => parseProgressLine(line)?.source;

test('says whether github or git wrote a line', () => {
  expect(source('remote: Counting objects:  25% (1/4)')).toBe('remote');
  expect(source('Receiving objects:  45% (555/1234)')).toBe('local');
  expect(source('From https://github.com/sharkdp/fd')).toBeUndefined();
});

test('other lines arent progress', () => {
  expect(
    [
      '',
      'remote: Total 4 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)',
      'From https://github.com/sharkdp/fd',
      ' * [new ref]         refs/pull/1/head -> refs/lo/pull/1/head',
      "fatal: couldn't find remote ref refs/pull/2/head",
      'remote: Repository not found.',
      'error: RPC failed; curl 56 Recv failure: Connection reset by peer',
      // Counts no number holds exactly aren't counts.
      'Receiving objects:  45% (1/99999999999999999999)',
    ].filter((line) => parse(line) !== undefined),
  ).toEqual([]);
});

const of = (done: number, total?: number) => percent(progress('Receiving objects', done, total));

test('percent is done over total', () => {
  expect(of(555, 1234)).toBe(44);
  expect(of(4, 4)).toBe(100);
  expect(of(4)).toBeUndefined();
  expect(of(0, 0)).toBeUndefined();
  // However large the counts a line claims.
  const most = Number.MAX_SAFE_INTEGER;
  expect(of(most, most)).toBe(100);
  expect(of(Math.floor(most / 2), most)).toBe(49);
});

test('describes how far git is', () => {
  expect(describeProgress(progress('Receiving objects', 555, 1234))).toBe(
    'receiving objects, 44% of 1234',
  );
  expect(describeProgress(progress('Enumerating objects', 12))).toBe('enumerating objects, 12');
});
