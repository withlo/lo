import { describe, expect, it } from 'vitest';

import {
  buildOf,
  buildText,
  checkFailedTitle,
  downloadingText,
  failureReason,
  failureWay,
  progressText,
} from './words.ts';

const MB = 1024 * 1024;

describe('progressText', () => {
  it('says how much of the download has come, with the unit said once when both share it', () => {
    expect(progressText(38 * MB, 112 * MB)).toBe('38 / 112 MB');
    expect(progressText(38.5 * MB, 112 * MB)).toBe('38.5 / 112 MB');
    expect(progressText(1.2 * 1024 * MB, 2 * 1024 * MB)).toBe('1.2 / 2 GB');
  });

  it('says both units when they differ', () => {
    expect(progressText(800 * 1024, 112 * MB)).toBe('800 KB / 112 MB');
    expect(progressText(100 * MB, 1.5 * 1024 * MB)).toBe('100 MB / 1.5 GB');
  });

  it('says only what has come while GitHub hasn’t said how large it is, and nothing before', () => {
    expect(progressText(38 * MB, 0)).toBe('38 MB');
    expect(progressText(0, 112 * MB)).toBeUndefined();
    expect(progressText(0, 0)).toBeUndefined();
  });
});

describe('downloadingText', () => {
  it('says a download is starting, then how far it has come', () => {
    expect(downloadingText('0.2.0', 0, 112 * MB)).toBe('Downloading Lo 0.2.0…');
    expect(downloadingText('0.2.0', 38 * MB, 112 * MB)).toBe('Downloading Lo 0.2.0 · 38 / 112 MB');
  });
});

describe('a build', () => {
  it('names a packaged Lo by the commit it was built from', () => {
    expect(buildOf({ packaged: true, commit: '0123456' })).toEqual({
      kind: 'commit',
      commit: '0123456',
    });
    expect(buildText({ kind: 'commit', commit: '0123456' })).toBe('Commit 0123456');
  });

  it('says a build run from source is, whatever commit it was built at', () => {
    expect(buildOf({ packaged: false, commit: '0123456' })).toEqual({ kind: 'source' });
    expect(buildOf({ packaged: false })).toEqual({ kind: 'source' });
    expect(buildText({ kind: 'source' })).toBe('Built from source');
  });

  it('says nothing for a packaged Lo built where no commit could be found', () => {
    expect(buildOf({ packaged: true })).toBeUndefined();
  });
});

describe('a failure', () => {
  it('says why, and what to do, for a copy that can’t check: get a newer one on GitHub', () => {
    for (const why of ['source', 'unreleased'] as const) {
      expect(checkFailedTitle(why)).toBe('Can’t check for updates');
      expect(failureWay(why)).toBe('github');
    }
    expect(failureReason('source')).toBe('This copy of Lo is built from source.');
    expect(failureReason('unreleased')).toBe('This copy of Lo isn’t a release.');
  });

  it('says a check that went wrong failed, and offers another try where one could help', () => {
    expect(checkFailedTitle('offline')).toBe('Couldn’t check for updates');
    expect(failureReason('offline')).toBe('Offline.');
    expect(failureWay('offline')).toBe('again');
    expect(failureWay('timeout')).toBe('again');
    expect(failureWay('unsigned')).toBeUndefined();
    expect(failureReason('unknown')).toBeUndefined();
  });
});
