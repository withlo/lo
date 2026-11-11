import { describe, expect, it } from 'vitest';

import {
  appName,
  backgroundEnvironment,
  backgroundSettings,
  dataFolder,
  devServer,
  devTools,
  githubSettings,
} from './environment.ts';

describe('appName', () => {
  it("keeps a packaged build's own name, and gives one run from source its own", () => {
    expect(appName({ packaged: true })).toBeUndefined();
    expect(appName({ packaged: false })).toBe('Lo Dev');
  });
});

describe('dataFolder', () => {
  const appData = '/home/me/.config';

  it("keeps Electron's default in a packaged build, whatever the environment says", () => {
    expect(dataFolder({ packaged: true, appData, env: { LO_USER_DATA_DIR: '/tmp/lo' } })).toBe(
      undefined,
    );
  });

  it('gives an unpackaged build its own folder', () => {
    expect(dataFolder({ packaged: false, appData, env: {} })).toBe('/home/me/.config/Lo Dev');
  });

  it('takes LO_USER_DATA_DIR in an unpackaged build', () => {
    expect(dataFolder({ packaged: false, appData, env: { LO_USER_DATA_DIR: '/tmp/lo' } })).toBe(
      '/tmp/lo',
    );
  });

  it('refuses a relative LO_USER_DATA_DIR', () => {
    expect(() => dataFolder({ packaged: false, appData, env: { LO_USER_DATA_DIR: 'lo' } })).toThrow(
      'absolute path',
    );
  });
});

describe('devServer', () => {
  const env = { ELECTRON_RENDERER_URL: 'http://localhost:5173' };

  it('reads the dev server in an unpackaged build', () => {
    expect(devServer({ packaged: false, env })?.origin).toBe('http://localhost:5173');
  });

  it('ignores it in a packaged build', () => {
    expect(devServer({ packaged: true, env })).toBe(undefined);
  });

  it('is absent when nothing sets it', () => {
    expect(devServer({ packaged: false, env: {} })).toBe(undefined);
  });

  it('refuses a server on another machine or another scheme', () => {
    for (const address of ['http://example.com:5173', 'https://localhost:5173', 'file:///tmp']) {
      expect(() => devServer({ packaged: false, env: { ELECTRON_RENDERER_URL: address } })).toThrow(
        'on this machine',
      );
    }
  });
});

describe('backgroundSettings', () => {
  const env = { LO_TEST_JOBS: '1', LO_BACKGROUND_MEMORY_CAP_MB: '300' };

  it('caps the process at 2 GB, with no test jobs, by default', () => {
    expect(backgroundSettings({ packaged: false, env: {} })).toEqual({
      testJobs: false,
      memoryCap: 2 * 1024 ** 3,
    });
  });

  it('takes test jobs and another cap in an unpackaged build', () => {
    expect(backgroundSettings({ packaged: false, env })).toEqual({
      testJobs: true,
      memoryCap: 300 * 1024 ** 2,
    });
  });

  it('ignores both in a packaged build', () => {
    expect(backgroundSettings({ packaged: true, env })).toEqual({
      testJobs: false,
      memoryCap: 2 * 1024 ** 3,
    });
  });

  it.each(['0', '-5', '1.5', 'lots'])('refuses a cap of %s', (cap) => {
    expect(() =>
      backgroundSettings({ packaged: false, env: { LO_BACKGROUND_MEMORY_CAP_MB: cap } }),
    ).toThrow('whole number of megabytes');
  });
});

describe('backgroundEnvironment', () => {
  it('is never empty, which would hand the process all of main’s', () => {
    expect(backgroundEnvironment({ testJobs: false, memoryCap: 2 * 1024 ** 3 })).toEqual({
      LO_BACKGROUND: '1',
      LO_BACKGROUND_MEMORY_CAP_MB: '2048',
    });
  });

  it('turns the test jobs on only when the settings do', () => {
    expect(backgroundEnvironment({ testJobs: true, memoryCap: 300 * 1024 ** 2 })).toEqual({
      LO_BACKGROUND: '1',
      LO_BACKGROUND_MEMORY_CAP_MB: '300',
      LO_TEST_JOBS: '1',
    });
  });

  it('keeps a packaged build’s test jobs off, whatever main’s environment says', () => {
    const settings = backgroundSettings({ packaged: true, env: { LO_TEST_JOBS: '1' } });
    expect(backgroundEnvironment(settings)).not.toHaveProperty('LO_TEST_JOBS');
  });
});

describe('devTools', () => {
  const server = { ELECTRON_RENDERER_URL: 'http://localhost:5173/' };

  it('offers them only on the dev server, in a build run from source', () => {
    expect(devTools({ packaged: false, env: server })).toBe(true);
    expect(devTools({ packaged: false, env: {} })).toBe(false);
    expect(devTools({ packaged: true, env: server })).toBe(false);
  });
});

describe('githubSettings', () => {
  const github = {
    api: 'https://api.github.com',
    web: 'https://github.com',
    uploads: 'https://uploads.github.com',
  };

  it("talks to github.com unless it's told otherwise", () => {
    expect(githubSettings({ packaged: false, env: {} })).toEqual({
      urls: github,
      testRun: false,
      tokenFile: undefined,
    });
  });

  it('talks to a server on this machine in an unpackaged build, as a test run', () => {
    const env = { LO_GITHUB: 'http://127.0.0.1:4567', LO_TEST_TOKEN_FILE: '/tmp/token' };
    expect(githubSettings({ packaged: false, env })).toEqual({
      urls: {
        api: 'http://127.0.0.1:4567/api',
        web: 'http://127.0.0.1:4567/web',
        uploads: 'http://127.0.0.1:4567/uploads',
      },
      testRun: true,
      tokenFile: '/tmp/token',
    });
  });

  it('ignores both switches in a packaged build', () => {
    const env = { LO_GITHUB: 'http://127.0.0.1:4567', LO_TEST_TOKEN_FILE: '/tmp/token' };
    expect(githubSettings({ packaged: true, env })).toEqual({
      urls: github,
      testRun: false,
      tokenFile: undefined,
    });
  });

  it('takes a token file without a local GitHub, which is no test run', () => {
    const env = { LO_TEST_TOKEN_FILE: '/tmp/token' };
    expect(githubSettings({ packaged: false, env })).toMatchObject({
      urls: github,
      testRun: false,
      tokenFile: '/tmp/token',
    });
  });

  it('refuses a GitHub anywhere but on this machine, or anything but its address', () => {
    for (const address of [
      'https://api.github.com',
      'http://example.com:4567',
      'http://127.0.0.1.example.com',
      'http://127.0.0.1:4567/api',
      'http://me:secret@127.0.0.1:4567',
      'http://127.0.0.1:4567/?x=1',
      'ftp://127.0.0.1',
      'nothing',
    ]) {
      expect(() => githubSettings({ packaged: false, env: { LO_GITHUB: address } })).toThrow(
        'LO_GITHUB must be an http address on this machine',
      );
    }
  });

  it('refuses a relative token file', () => {
    expect(() => githubSettings({ packaged: false, env: { LO_TEST_TOKEN_FILE: 'token' } })).toThrow(
      'absolute path',
    );
  });
});
