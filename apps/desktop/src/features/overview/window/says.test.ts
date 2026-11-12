// What the overview's view says: who wrote it and when, its findings by line, its sizes by kind,
// the format it's in, and why its ref couldn't be read, with when Lo tries again.

import { describe, expect, it } from 'vitest';

import {
  ago,
  authorOf,
  bytes,
  findingPlace,
  invalidSummary,
  newerWords,
  problemWords,
  shortId,
  sizeRows,
  tooLargeWords,
  until,
} from './says.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('the byline', () => {
  it('names the author by their login, else by the name the commit gives, else not at all', () => {
    expect(authorOf({ login: 'ravi-k', name: 'Ravi K', at: 0 })).toEqual({
      kind: 'login',
      login: 'ravi-k',
    });
    expect(authorOf({ login: null, name: '  Ravi K ', at: 0 })).toEqual({
      kind: 'name',
      name: 'Ravi K',
    });
    expect(authorOf({ login: null, name: ' ', at: 0 })).toEqual({ kind: 'unknown' });
  });

  it('says when, and the commit by its short ID', () => {
    expect(ago(0, 30_000)).toBe('just now');
    expect(ago(0, 5 * MINUTE)).toBe('5 minutes ago');
    expect(ago(0, 2 * DAY + MINUTE)).toBe('2 days ago');
    expect(ago(0, 60 * MINUTE)).toBe('an hour ago');
    expect(shortId('a91c4e2ffffffffffffffffffffffffffffffff')).toBe('a91c4e2');
  });
});

describe('an overview that can’t be read', () => {
  it('counts its problems, and puts each by its line, or its file', () => {
    expect(
      invalidSummary([
        { code: 'block-unknown', severity: 'error', file: 'artifact.md', line: 118, message: 'x' },
        { code: 'header-missing', severity: 'error', file: 'artifact.md', line: 1, message: 'y' },
        { code: 'term-unused', severity: 'warning', file: 'artifact.md', line: 3, message: 'z' },
      ]),
    ).toBe('Lo found 2 problems in the overview.');
    expect(
      findingPlace({
        code: 'block-unknown',
        severity: 'error',
        file: 'artifact.md',
        line: 118,
        message: '',
      }),
    ).toBe('line 118');
    expect(
      findingPlace({
        code: 'artifact-missing',
        severity: 'error',
        file: 'artifact.md',
        message: '',
      }),
    ).toBe('artifact.md');
    expect(
      findingPlace({ code: 'tree-extra', severity: 'error', file: 'notes.txt', message: '' }),
    ).toBe('notes.txt');
  });
});

describe('an overview too large to show', () => {
  const sizes = {
    bytes: 74 * 1024 * 1024,
    entries: 33,
    kinds: [
      { kind: 'png' as const, files: 31, bytes: 71 * 1024 * 1024 },
      { kind: 'artifact' as const, files: 1, bytes: 20 * 1024 },
      { kind: 'other' as const, files: 1, bytes: 300 },
    ],
  };

  it('gives its size against Lo’s limit, and what most of it is', () => {
    expect(tooLargeWords('bytes', sizes)).toBe(
      "It's 74 MB, and Lo shows overviews up to 50 MB. Most of it is PNG figures: 31 files, 71 MB in all.",
    );
    expect(tooLargeWords('entries', sizes)).toBe(
      'It holds more than 500 files and folders, and Lo shows overviews of up to 500.',
    );
    expect(tooLargeWords('text', sizes)).toBe(
      'Its artifact.md is larger than 256 KB, the most Lo reads.',
    );
  });

  it('lists the sizes of each kind of file', () => {
    expect(sizeRows(sizes)).toEqual([
      { kind: 'PNG figures', size: '31 files · 71 MB' },
      { kind: 'artifact.md', size: '1 file · 20 KB' },
      { kind: 'Other files', size: '1 file · 300 bytes' },
    ]);
    expect(bytes(1)).toBe('1 byte');
    expect(bytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('an overview in a newer format', () => {
  it('names the format, and what this Lo reads', () => {
    expect(newerWords(3)).toBe("It's written in format 3, and this Lo reads format 1.");
  });
});

describe('a ref that couldn’t be read', () => {
  it('says why, and when Lo tries again', () => {
    const now = 1_000_000;
    expect(until(now + 7_200, now)).toBe('in 8 s');
    expect(until(now + 2 * MINUTE, now)).toBe('in 2 minutes');
    expect(
      problemWords(
        { kind: 'offline', message: 'ECONNRESET', retryAt: now + 8_000 },
        'refs/lo/pr/80',
        now,
      ),
    ).toBe("GitHub couldn't be reached while Lo read refs/lo/pr/80. Trying again in 8 s.");
    expect(
      problemWords(
        { kind: 'failed', message: 'GitHub answered 502.', retryAt: now + 5_000 },
        'refs/lo/pr/80',
        now,
      ),
    ).toBe("Lo couldn't read refs/lo/pr/80: GitHub answered 502. Trying again in 5 s.");
    expect(
      problemWords(
        { kind: 'signedOut', login: 'tess', retryAt: now + 5_000 },
        'refs/lo/pr/80',
        now,
      ),
    ).toContain('tess is signed out');
  });
});
