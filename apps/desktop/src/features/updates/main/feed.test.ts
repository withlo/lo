import { describe, expect, it } from 'vitest';

import { feedFor, GITHUB_FEED, UNCHECKED } from './feed.ts';

const local = { LO_UPDATES_FEED: 'http://127.0.0.1:4100/' };

describe('a packaged Lo', () => {
  it('checks github.com’s releases of withlo/lo when it carries app-update.yml', () => {
    expect(feedFor({ packaged: true, configured: true, env: {} })).toEqual({ feed: GITHUB_FEED });
  });

  it('checks nothing without it, as a zip made from a branch', () => {
    expect(feedFor({ packaged: true, configured: false, env: {} })).toEqual({
      unchecked: UNCHECKED.unreleased,
    });
  });

  it('ignores LO_UPDATES_FEED, however it’s written', () => {
    for (const LO_UPDATES_FEED of [local.LO_UPDATES_FEED, 'https://example.com/', 'nonsense']) {
      const env = { LO_UPDATES_FEED };
      expect(feedFor({ packaged: true, configured: true, env })).toEqual({ feed: GITHUB_FEED });
      expect(feedFor({ packaged: true, configured: false, env })).toEqual({
        unchecked: UNCHECKED.unreleased,
      });
    }
  });
});

describe('a build run from source', () => {
  it('checks nothing without LO_UPDATES_FEED', () => {
    for (const env of [{}, { LO_UPDATES_FEED: '' }]) {
      expect(feedFor({ packaged: false, configured: false, env })).toEqual({
        unchecked: UNCHECKED.source,
      });
    }
  });

  it('checks the feed LO_UPDATES_FEED names on this machine, by the same paths as GitHub’s', () => {
    expect(feedFor({ packaged: false, configured: false, env: local })).toEqual({
      feed: { ...GITHUB_FEED, host: '127.0.0.1:4100', protocol: 'http' },
    });
  });

  it('refuses a feed anywhere but http://127.0.0.1:<port>/', () => {
    for (const LO_UPDATES_FEED of [
      'http://localhost:4100/',
      'http://127.0.0.2:4100/',
      'http://[::1]:4100/',
      'https://127.0.0.1:4100/',
      'http://127.0.0.1/',
      'http://127.0.0.1:80/',
      'http://127.0.0.1:4100',
      'http://127.0.0.1:4100/withlo/',
      'http://127.0.0.1:4100/?x=1',
      'http://127.0.0.1:4100/#x',
      'http://user:pass@127.0.0.1:4100/',
      'http://127.0.0.1:04100/',
      'https://github.com/',
      '127.0.0.1:4100',
    ]) {
      expect(() =>
        feedFor({ packaged: false, configured: true, env: { LO_UPDATES_FEED } }),
      ).toThrow('LO_UPDATES_FEED must be a feed on this machine');
    }
  });
});

it('is never private and has no token, so electron-updater sends none', () => {
  expect(GITHUB_FEED).toEqual({ provider: 'github', owner: 'withlo', repo: 'lo', private: false });
  expect(Object.isFrozen(GITHUB_FEED)).toBe(true);
});
