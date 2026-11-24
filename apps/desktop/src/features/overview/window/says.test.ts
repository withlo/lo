// What the overview's view says: who wrote it and when, its findings by line, its sizes by kind,
// the format it's in, and why its ref couldn't be fetched, with when it's fetched again.

import { describe, expect, it } from 'vitest';

import {
  authorOf,
  findingPlace,
  invalidSummary,
  newerDetails,
  problemReason,
  shortId,
  sizeRows,
  tooLargeWords,
  writtenText,
} from './says.ts';

const DAY = 24 * 60 * 60_000;

/** Who wrote it, for a commit GitHub matched to no account that gives `name`. */
function named(name: string) {
  return authorOf({ login: null, name, at: 0 });
}

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

  it('takes from a name the marks that could close its quotes or pass for the byline’s own', () => {
    expect(named('”· describes r2 57cc4a6')).toEqual({
      kind: 'name',
      name: 'describes r2 57cc4a6',
    });
    expect(named('a "b" “c” ‘d’ \'e\' «f» ＂g＂ h • i\nj')).toEqual({
      kind: 'name',
      name: 'a b c d e f g h i j',
    });
    expect(named('Ravi O’Brien-K')).toEqual({ kind: 'name', name: 'Ravi O’Brien-K' });
    expect(named("Ravi O'Brien")).toEqual({ kind: 'name', name: "Ravi O'Brien" });
    expect(named('“ · ”')).toEqual({ kind: 'unknown' });
  });

  it('says the commit by its short ID', () => {
    expect(shortId('a91c4e2ffffffffffffffffffffffffffffffff')).toBe('a91c4e2');
  });

  it('starts Details with the commit, who wrote it and when', () => {
    const commit = {
      id: 'a91c4e2'.padEnd(40, 'f'),
      source: 'base' as const,
      repository: { owner: 'rozed-dev', name: 'e2e' },
      entries: [],
      truncated: false,
      read: true,
    };
    expect(writtenText({ ...commit, byline: { login: 'ravi-k', name: '', at: 0 } }, 2 * DAY)).toBe(
      'a91c4e2 · ravi-k · 2 d ago',
    );
    expect(
      writtenText({ ...commit, byline: { login: null, name: 'Ravi K', at: 0 } }, 2 * DAY),
    ).toBe('a91c4e2 · “Ravi K” · 2 d ago');
    expect(writtenText({ ...commit, byline: null }, 0)).toBe('a91c4e2');
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
    ).toBe('It has 2 problems.');
    expect(
      findingPlace({
        code: 'block-unknown',
        severity: 'error',
        file: 'artifact.md',
        line: 118,
        message: '',
      }),
    ).toBe('Line 118');
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

  it('gives its size against the limit it’s past', () => {
    expect(tooLargeWords('bytes', sizes)).toBe('It’s 74 MB, over the 50 MB limit.');
    expect(tooLargeWords('entries', sizes)).toBe('It has more than 500 files and folders.');
    expect(tooLargeWords('text', sizes)).toBe('Its text is over the 256 KB limit.');
  });

  it('lists the sizes of each kind of file', () => {
    expect(sizeRows(sizes)).toEqual([
      { kind: 'PNG figures', size: '31 files · 71 MB' },
      { kind: 'artifact.md', size: '1 file · 20 KB' },
      { kind: 'Other files', size: '1 file · 300 B' },
    ]);
  });
});

describe('an overview in a newer format', () => {
  it('names the format, and what this version reads, behind Details', () => {
    expect(newerDetails(3)).toBe('Format 3. This version reads format 1.');
  });
});

describe('a ref that couldn’t be fetched', () => {
  it('says why, and when it’s fetched again, to count down, with GitHub’s words left for Details', () => {
    const at = 1_000_000;
    const offline = { kind: 'offline', message: 'ECONNRESET', retryAt: at } as const;
    expect(problemReason({ ...offline, cause: { kind: 'offline' } })).toEqual({
      cause: 'Offline.',
      retryAt: at,
    });
    // GitHub out of reach says why, as the header's chip does: a hang isn't "Offline.".
    expect(problemReason({ ...offline, cause: { kind: 'timeout' } })).toEqual({
      cause: 'GitHub didn’t respond.',
      retryAt: at,
    });
    expect(problemReason({ ...offline, cause: { kind: 'unknown' } })).toEqual({
      cause: '',
      retryAt: at,
    });
    expect(problemReason({ kind: 'failed', message: 'GitHub answered 502.', retryAt: at })).toEqual(
      { cause: 'GitHub returned an error.', retryAt: at },
    );
    expect(problemReason({ kind: 'rateLimited', secondary: true, retryAt: at })).toEqual({
      cause: 'GitHub’s rate limit was reached.',
      retryAt: at,
    });
    // Signed out, nothing to count down: it takes a sign-in.
    expect(problemReason({ kind: 'signedOut', login: 'tess', retryAt: at })).toEqual({
      cause: 'tess is signed out.',
    });
    // An organization that blocks the account says which, and why.
    const blocked = { kind: 'blocked', org: 'rozed-dev', message: 'SAML.', links: [], retryAt: at };
    expect(problemReason({ ...blocked, kind: 'blocked', why: 'sso' })).toEqual({
      cause: 'rozed-dev requires single sign-on.',
      retryAt: at,
    });
    expect(problemReason({ ...blocked, kind: 'blocked', why: 'approval' })).toEqual({
      cause: 'rozed-dev hasn’t approved Lo.',
      retryAt: at,
    });
  });
});
