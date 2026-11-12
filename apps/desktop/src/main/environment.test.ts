import { describe, expect, it, vi } from 'vitest';

import { memoryCap } from '../background/pool.ts';
import {
  appName,
  backgroundEnvironment,
  browserProgram,
  commandFolder,
  backgroundSettings,
  configFolder,
  dataFolder,
  devServer,
  devTools,
  ghProgram,
  githubSettings,
  keymapEditor,
  compareWait,
  offlineAfter,
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

describe('configFolder', () => {
  const base = { home: '/home/me', appData: '/home/me/.config' };

  it('is ~/.config/lo in a packaged build on a Mac, whatever XDG_CONFIG_HOME says', () => {
    expect(configFolder({ ...base, packaged: true, platform: 'darwin', env: {} })).toBe(
      '/home/me/.config/lo',
    );
    expect(
      configFolder({
        ...base,
        packaged: true,
        platform: 'darwin',
        env: { XDG_CONFIG_HOME: '/elsewhere' },
      }),
    ).toBe('/home/me/.config/lo');
  });

  it('follows XDG_CONFIG_HOME on Linux, when it is an absolute path', () => {
    const linux = { ...base, packaged: true, platform: 'linux' } as const;
    expect(configFolder({ ...linux, env: {} })).toBe('/home/me/.config/lo');
    expect(configFolder({ ...linux, env: { XDG_CONFIG_HOME: '/srv/config' } })).toBe(
      '/srv/config/lo',
    );
    expect(configFolder({ ...linux, env: { XDG_CONFIG_HOME: 'config' } })).toBe(
      '/home/me/.config/lo',
    );
    expect(configFolder({ ...linux, env: { XDG_CONFIG_HOME: '' } })).toBe('/home/me/.config/lo');
  });

  it('joins the data folder in a build run from source', () => {
    const source = { ...base, packaged: false, platform: 'linux' } as const;
    expect(configFolder({ ...source, env: {} })).toBe('/home/me/.config/Lo Dev/config');
    expect(
      configFolder({
        ...source,
        env: { LO_USER_DATA_DIR: '/tmp/lo', XDG_CONFIG_HOME: '/srv/config' },
      }),
    ).toBe('/tmp/lo/config');
    expect(() => configFolder({ ...source, env: { LO_USER_DATA_DIR: 'lo' } })).toThrow(
      'absolute path',
    );
  });
});

describe('offlineAfter', () => {
  it('takes a shorter wait before saying offline in a build run from source, for tests', () => {
    expect(offlineAfter({ packaged: false, env: { LO_OFFLINE_AFTER_MS: '500' } })).toBe(500);
    expect(offlineAfter({ packaged: false, env: {} })).toBe(undefined);
  });

  it('is ignored in a packaged build', () => {
    expect(offlineAfter({ packaged: true, env: { LO_OFFLINE_AFTER_MS: '500' } })).toBe(undefined);
  });

  it('refuses anything but whole milliseconds', () => {
    for (const wait of ['', '1.5', '-1', 'soon']) {
      expect(() => offlineAfter({ packaged: false, env: { LO_OFFLINE_AFTER_MS: wait } })).toThrow(
        'LO_OFFLINE_AFTER_MS',
      );
    }
  });
});

describe('compareWait', () => {
  it('takes another wait for a comparison of revisions in a build run from source, for tests', () => {
    expect(compareWait({ packaged: false, env: { LO_COMPARE_WAIT_MS: '20000' } })).toBe(20_000);
    expect(compareWait({ packaged: false, env: {} })).toBe(undefined);
    expect(compareWait({ packaged: true, env: { LO_COMPARE_WAIT_MS: '20000' } })).toBe(undefined);
    expect(() => compareWait({ packaged: false, env: { LO_COMPARE_WAIT_MS: 'soon' } })).toThrow(
      'LO_COMPARE_WAIT_MS',
    );
  });
});

describe('keymapEditor', () => {
  it('names the program a build run from source opens the keymap file with', () => {
    const env = { LO_KEYMAP_EDITOR: '/tmp/editor' };
    expect(keymapEditor({ packaged: false, env })).toBe('/tmp/editor');
    expect(keymapEditor({ packaged: false, env: {} })).toBeUndefined();
    expect(keymapEditor({ packaged: false, env: { LO_KEYMAP_EDITOR: '' } })).toBeUndefined();
  });

  it('is ignored in a packaged build, so nothing the environment says picks what Lo runs', () => {
    expect(keymapEditor({ packaged: true, env: { LO_KEYMAP_EDITOR: '/tmp/editor' } })).toBe(
      undefined,
    );
    expect(keymapEditor({ packaged: true, env: { LO_KEYMAP_EDITOR: 'relative' } })).toBe(undefined);
  });

  it('refuses a relative path', () => {
    expect(() => keymapEditor({ packaged: false, env: { LO_KEYMAP_EDITOR: 'editor' } })).toThrow(
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

  it.each(['0', '-5', '1.5', 'lots', '', '010', '1e3', '12345678901234567890', '9007199254740992'])(
    'refuses a cap of %j, warning, and keeps 2 GB',
    (cap) => {
      const warn = vi.fn<(message: string) => void>();
      expect(
        backgroundSettings({ packaged: false, env: { LO_BACKGROUND_MEMORY_CAP_MB: cap }, warn }),
      ).toEqual({ testJobs: false, memoryCap: 2 * 1024 ** 3 });
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          `whole number of megabytes, up to 9007199254740991, not ${JSON.stringify(cap)}`,
        ),
      );
    },
  );

  it('hands the process only a cap it takes back as it was', () => {
    // The process reads its cap from the environment main builds, and stops at start on one it
    // can't read, to be started again forever.
    const warn = vi.fn<(message: string) => void>();
    for (const cap of ['1', '200', '2048', '9007199254740991', '12345678901234567890']) {
      const settings = backgroundSettings({
        packaged: false,
        env: { LO_BACKGROUND_MEMORY_CAP_MB: cap },
        warn,
      });
      const handed = backgroundEnvironment(settings).LO_BACKGROUND_MEMORY_CAP_MB;
      expect(memoryCap(handed)).toBe(settings.memoryCap);
    }
    // Only the last was refused.
    expect(warn).toHaveBeenCalledOnce();
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

/** The gh a build run from source runs with `env`. */
const run = (env: Record<string, string>, testRun = false) =>
  ghProgram({ packaged: false, env, testRun });

describe('ghProgram', () => {
  it('names the gh a build run from source runs, or none', () => {
    expect(run({ LO_GH: '/tmp/gh' })).toBe('/tmp/gh');
    expect(run({ LO_GH: 'none' })).toBe('none');
    expect(run({})).toBeUndefined();
    expect(run({ LO_GH: '' })).toBeUndefined();
  });

  it('runs no gh in a test run unless one is named, so no real token reaches its GitHub', () => {
    expect(ghProgram({ packaged: false, env: {}, testRun: true })).toBe('none');
    expect(ghProgram({ packaged: false, env: { LO_GH: '' }, testRun: true })).toBe('none');
    expect(ghProgram({ packaged: false, env: { LO_GH: '/tmp/gh' }, testRun: true })).toBe(
      '/tmp/gh',
    );
  });

  it('is ignored in a packaged build, which always finds gh itself', () => {
    expect(
      ghProgram({ packaged: true, env: { LO_GH: '/tmp/gh' }, testRun: false }),
    ).toBeUndefined();
    expect(
      ghProgram({ packaged: true, env: { LO_GH: 'relative' }, testRun: false }),
    ).toBeUndefined();
  });

  it('refuses a relative path', () => {
    expect(() => ghProgram({ packaged: false, env: { LO_GH: 'gh' }, testRun: false })).toThrow(
      'absolute path',
    );
  });
});

describe('browserProgram', () => {
  it('names the program a build run from source opens web pages with', () => {
    expect(browserProgram({ packaged: false, env: { LO_BROWSER: '/tmp/open' } })).toBe('/tmp/open');
    expect(browserProgram({ packaged: false, env: {} })).toBeUndefined();
  });

  it('is ignored in a packaged build, so nothing the environment says picks what Lo runs', () => {
    expect(browserProgram({ packaged: true, env: { LO_BROWSER: '/tmp/open' } })).toBeUndefined();
  });

  it('refuses a relative path', () => {
    expect(() => browserProgram({ packaged: false, env: { LO_BROWSER: 'open' } })).toThrow(
      'absolute path',
    );
  });
});

describe('commandFolder', () => {
  it('names the folder a build run from source installs the lo command in', () => {
    expect(commandFolder({ packaged: false, env: { LO_COMMAND_FOLDER: '/tmp/bin' } })).toBe(
      '/tmp/bin',
    );
    expect(commandFolder({ packaged: false, env: {} })).toBeUndefined();
  });

  it('is ignored in a packaged build, which installs where the system keeps commands', () => {
    expect(
      commandFolder({ packaged: true, env: { LO_COMMAND_FOLDER: '/tmp/bin' } }),
    ).toBeUndefined();
  });

  it('refuses a relative path', () => {
    expect(() => commandFolder({ packaged: false, env: { LO_COMMAND_FOLDER: 'bin' } })).toThrow(
      'absolute path',
    );
  });
});
