import { describe, expect, it } from 'vitest';

import { checkAnswer, isVersion, LINE_LIMIT, releasePage, updateState } from './contract.ts';

describe('versions', () => {
  it('are SemVer, with a prerelease part or none', () => {
    for (const version of ['0.1.0', '0.10.2', '1.0.0-rc.1', '1.0.0-alpha.beta.11', '1.0.0-x-y']) {
      expect(isVersion(version)).toBe(true);
    }
  });

  it('are nothing else: no `v`, build metadata, leading zeros, paths or queries', () => {
    for (const text of [
      'v0.2.0',
      '0.2',
      '0.2.0+build.1',
      '01.2.0',
      '0.2.0-01',
      '0.2.0-',
      '0.2.0/../../evil',
      '0.2.0?x=1',
      '0.2.0#x',
      '0.2.0 ',
      ' 0.2.0',
      '0.2.0\n',
      '../../withlo',
      `0.2.0-${'a'.repeat(64)}`,
    ]) {
      expect(isVersion(text)).toBe(false);
    }
  });
});

describe("a release's page", () => {
  it('is built from the version alone', () => {
    expect(releasePage('0.2.0')).toBe('https://github.com/withlo/lo/releases/tag/v0.2.0');
    expect(releasePage('1.0.0-rc.2')).toBe('https://github.com/withlo/lo/releases/tag/v1.0.0-rc.2');
  });

  it('is never built from a version Lo isn’t released as', () => {
    for (const text of [
      '0.2.0/../../../evil/repo',
      '0.2.0?ref=x',
      'v0.2.0',
      'https://example.com',
    ]) {
      expect(() => releasePage(text)).toThrow('isn’t a version Lo is released as');
    }
  });
});

describe('the state the window hears', () => {
  const offer = {
    status: 'available',
    version: '0.2.0',
    line: 'Faster diffs.',
    how: 'install',
    page: 'https://github.com/withlo/lo/releases/tag/v0.2.0',
  } as const;

  it('takes an offer of a version with its own page', () => {
    expect(updateState.parse(offer)).toEqual(offer);
    const failed = { why: 'github', details: '503' } as const;
    expect(checkAnswer.parse({ ...offer, failed })).toEqual({ ...offer, failed });
    expect(checkAnswer.safeParse({ ...offer, failed: 'GitHub answered 503.' }).success).toBe(false);
  });

  it('refuses a page that isn’t its version’s, and a version Lo isn’t released as', () => {
    expect(
      updateState.safeParse({ ...offer, page: 'https://example.com/lo/releases/tag/v0.2.0' })
        .success,
    ).toBe(false);
    expect(
      updateState.safeParse({ ...offer, page: 'https://github.com/withlo/lo/releases/tag/v0.3.0' })
        .success,
    ).toBe(false);
    expect(updateState.safeParse({ ...offer, version: 'v0.2.0' }).success).toBe(false);
    expect(updateState.safeParse({ status: 'ready', version: '0.2.0/../x' }).success).toBe(false);
  });

  it('takes a line of up to 140 characters as a person counts them', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(updateState.safeParse({ ...offer, line: family.repeat(LINE_LIMIT) }).success).toBe(true);
    expect(updateState.safeParse({ ...offer, line: 'a'.repeat(LINE_LIMIT + 1) }).success).toBe(
      false,
    );
  });

  it('refuses keys it doesn’t name', () => {
    expect(updateState.safeParse({ status: 'idle', url: 'https://example.com' }).success).toBe(
      false,
    );
  });
});
