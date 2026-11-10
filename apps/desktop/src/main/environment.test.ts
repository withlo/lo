import { describe, expect, it } from 'vitest';

import { backgroundEnvironment, backgroundSettings, dataFolder, devServer } from './environment.ts';

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
