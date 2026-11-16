import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { liveArgs, liveDataFolder, SYSTEM_KEYCHAIN } from './live.ts';

const mac = { platform: 'darwin', home: '/Users/me' } as const;
const linux = { platform: 'linux', home: '/home/me' } as const;

describe('liveDataFolder', () => {
  it('takes the folder LO_USER_DATA_DIR names', () => {
    expect(liveDataFolder({ ...mac, env: { LO_USER_DATA_DIR: '/tmp/lo-live/' } })).toBe(
      '/tmp/lo-live',
    );
  });

  it('refuses to start without LO_USER_DATA_DIR, or with a relative one', () => {
    expect(() => liveDataFolder({ ...mac, env: {} })).toThrow(
      /Set it to a folder of the run's own/,
    );
    expect(() => liveDataFolder({ ...mac, env: { LO_USER_DATA_DIR: '' } })).toThrow(
      /LO_USER_DATA_DIR names/,
    );
    expect(() => liveDataFolder({ ...mac, env: { LO_USER_DATA_DIR: 'lo-live' } })).toThrow(
      'LO_USER_DATA_DIR must be an absolute path, not "lo-live".',
    );
  });

  it("refuses the data of a Lo someone uses: the installed Lo's, a build run from source's, and the keymap's", () => {
    const support = '/Users/me/Library/Application Support';
    for (const folder of [
      `${support}/Lo`,
      `${support}/Lo Dev`,
      `${support}/Lo Dev/live`,
      `${support}/Lo/../Lo Dev`,
      // A Mac's disk takes names whatever their case.
      `${support}/lo dev`,
      '/Users/me/.config/lo',
    ]) {
      expect(() => liveDataFolder({ ...mac, env: { LO_USER_DATA_DIR: folder } })).toThrow(
        'A live run needs a folder of its own.',
      );
    }
    for (const folder of ['/home/me/.config/Lo Dev', '/home/me/.config/lo/x']) {
      expect(() => liveDataFolder({ ...linux, env: { LO_USER_DATA_DIR: folder } })).toThrow(
        'A live run needs a folder of its own.',
      );
    }
    for (const folder of ['/srv/config/Lo', '/srv/config/lo']) {
      expect(() =>
        liveDataFolder({
          ...linux,
          env: { LO_USER_DATA_DIR: folder, XDG_CONFIG_HOME: '/srv/config' },
        }),
      ).toThrow('A live run needs a folder of its own.');
    }
  });

  it('takes a folder beside them, or one that holds them', () => {
    const support = '/Users/me/Library/Application Support';
    for (const folder of [`${support}/Lo Live`, `${support}/Lo Dev live`, support]) {
      expect(liveDataFolder({ ...mac, env: { LO_USER_DATA_DIR: folder } })).toBe(folder);
    }
    // Linux's names keep their case.
    expect(liveDataFolder({ ...linux, env: { LO_USER_DATA_DIR: '/home/me/.config/lo dev' } })).toBe(
      '/home/me/.config/lo dev',
    );
  });
});

describe('liveArgs', () => {
  it("preloads what takes off Playwright's stand-ins for the keychain, before Lo", () => {
    expect(liveArgs(['/repo/apps/desktop'])).toEqual(['-r', SYSTEM_KEYCHAIN, '/repo/apps/desktop']);
  });

  it('refuses an argument that asks for a stand-in', () => {
    for (const arg of ['--use-mock-keychain', '--password-store=basic']) {
      expect(() => liveArgs(['/repo/apps/desktop', arg])).toThrow(`leave ${arg} out`);
    }
  });
});

describe('the preload', () => {
  it('takes off both of the switches Playwright adds for a stand-in keychain', () => {
    const removed: string[] = [];
    const app = { commandLine: { removeSwitch: (name: string) => removed.push(name) } };
    runInNewContext(readFileSync(SYSTEM_KEYCHAIN, 'utf8'), {
      require: (name: string) => (name === 'electron' ? { app } : undefined),
    });
    expect(removed).toEqual(['use-mock-keychain', 'password-store']);
  });
});
