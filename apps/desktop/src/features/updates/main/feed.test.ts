import { describe, expect, it, vi } from 'vitest';

import { feedFor, GITHUB_FEED } from './feed.ts';

const local = { LO_UPDATES_FEED: 'http://127.0.0.1:4100/' };

/** Where a packaged Lo's resources are, on a Mac. */
const RESOURCES = '/Applications/Lo.app/Contents/Resources';

/** A disk where `existing` exists, and nothing else. */
function disk(...existing: string[]) {
  return vi.fn<(path: string) => boolean>((path) => existing.includes(path));
}

/** A Lo, `packaged` or run from source, with `app-update.yml` among its resources (`configured`). */
function lo(
  packaged: boolean,
  configured: boolean,
  env: Readonly<Record<string, string | undefined>> = {},
) {
  const exists = configured ? disk(`${RESOURCES}/app-update.yml`) : disk();
  return { packaged, resources: RESOURCES, exists, env };
}

describe('a packaged Lo', () => {
  it('checks github.com’s releases of withlo/lo when it carries app-update.yml', () => {
    const configured = lo(true, true);
    expect(feedFor(configured)).toEqual({ feed: GITHUB_FEED });
    expect(configured.exists).toHaveBeenCalledWith(`${RESOURCES}/app-update.yml`);
  });

  it('checks nothing without it among its resources, as a zip made from a branch', () => {
    expect(feedFor(lo(true, false))).toEqual({ unchecked: 'unreleased' });
    for (const elsewhere of [
      `${RESOURCES}/app/app-update.yml`,
      '/Applications/Lo.app/Contents/app-update.yml',
      `${RESOURCES}/dev-app-update.yml`,
    ]) {
      const place = { ...lo(true, false), exists: disk(elsewhere) };
      expect(feedFor(place)).toEqual({ unchecked: 'unreleased' });
    }
  });

  it('ignores LO_UPDATES_FEED, however it’s written', () => {
    for (const LO_UPDATES_FEED of [local.LO_UPDATES_FEED, 'https://example.com/', 'nonsense']) {
      const env = { LO_UPDATES_FEED };
      expect(feedFor(lo(true, true, env))).toEqual({ feed: GITHUB_FEED });
      expect(feedFor(lo(true, false, env))).toEqual({ unchecked: 'unreleased' });
    }
  });
});

describe('a build run from source', () => {
  it('checks nothing without LO_UPDATES_FEED, whatever its resources hold', () => {
    for (const env of [{}, { LO_UPDATES_FEED: '' }]) {
      expect(feedFor(lo(false, true, env))).toEqual({ unchecked: 'source' });
    }
  });

  it('checks the feed LO_UPDATES_FEED names on this machine, by the same paths as GitHub’s', () => {
    expect(feedFor(lo(false, false, local))).toEqual({
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
      expect(() => feedFor(lo(false, true, { LO_UPDATES_FEED }))).toThrow(
        'LO_UPDATES_FEED must be a feed on this machine',
      );
    }
  });
});

it('is never private and has no token, so electron-updater sends none', () => {
  expect(GITHUB_FEED).toEqual({ provider: 'github', owner: 'withlo', repo: 'lo', private: false });
  expect(Object.isFrozen(GITHUB_FEED)).toBe(true);
});
