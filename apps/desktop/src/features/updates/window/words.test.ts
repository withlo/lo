import { describe, expect, it } from 'vitest';

import { buildText, progressText } from './words.ts';

const MB = 1024 * 1024;

describe('progressText', () => {
  it('says how much of the download has come, with the unit said once when both share it', () => {
    expect(progressText(38 * MB, 112 * MB)).toBe('38 of 112 MB');
    expect(progressText(38.5 * MB, 112 * MB)).toBe('38.5 of 112 MB');
    expect(progressText(1.2 * 1024 * MB, 2 * 1024 * MB)).toBe('1.2 of 2 GB');
  });

  it('says both units when they differ', () => {
    expect(progressText(800 * 1024, 112 * MB)).toBe('800 KB of 112 MB');
    expect(progressText(100 * MB, 1.5 * 1024 * MB)).toBe('100 MB of 1.5 GB');
  });

  it('says only what has come while GitHub hasn’t said how large it is, and that it’s starting before', () => {
    expect(progressText(38 * MB, 0)).toBe('38 MB');
    expect(progressText(0, 112 * MB)).toBe('Starting');
    expect(progressText(0, 0)).toBe('Starting');
  });
});

describe('buildText', () => {
  it('names a packaged Lo by the commit it was built from', () => {
    expect(buildText({ packaged: true, commit: '0123456' })).toBe('Commit 0123456');
  });

  it('says a build run from source is, whatever commit it was built at', () => {
    expect(buildText({ packaged: false, commit: '0123456' })).toBe('Run from source');
    expect(buildText({ packaged: false })).toBe('Run from source');
  });

  it('says nothing for a packaged Lo built where no commit could be found', () => {
    expect(buildText({ packaged: true })).toBeUndefined();
  });
});
