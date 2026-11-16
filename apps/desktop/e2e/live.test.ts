import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { liveArgs, liveDataFolder, realPath, SYSTEM_KEYCHAIN, type Where } from './live.ts';

const OWN = /A live run needs a folder of its own, apart from it\./;

let root: string;
let home: string;
let support: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lo-live-')));
  home = join(root, 'home');
  support = join(home, 'Library', 'Application Support');
  for (const folder of [
    join(support, 'Lo'),
    join(support, 'Lo Dev'),
    join(home, '.config', 'lo'),
    join(home, '.config', 'Lo Dev'),
  ]) {
    mkdirSync(folder, { recursive: true });
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function mac(folder: string | undefined, env: Where['env'] = {}): Where {
  return {
    platform: 'darwin',
    home,
    env: { ...env, LO_USER_DATA_DIR: folder },
    macCaches: () => join(root, 'caches'),
  };
}

function linux(folder: string | undefined, env: Where['env'] = {}): Where {
  return { platform: 'linux', home, env: { ...env, LO_USER_DATA_DIR: folder } };
}

/** The folder a live run is started on, with why it's refused, if it is. */
function refusal(where: Where): { folder: string | undefined; refused: string | undefined } {
  const folder = where.env.LO_USER_DATA_DIR;
  try {
    liveDataFolder(where);
    return { folder, refused: undefined };
  } catch (error) {
    return { folder, refused: error instanceof Error ? error.message : String(error) };
  }
}

/** What `refusal` says of a folder refused for being, being in or holding a Lo's own. */
function refusedAs(folder: string, why: RegExp = OWN) {
  return { folder, refused: expect.stringMatching(why) };
}

describe('realPath', () => {
  it('follows the links in the part that exists, and adds the rest by name', () => {
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'link'));
    expect(realPath(join(root, 'link', 'run', 'x', '..', '.', 'y'))).toBe(
      join(root, 'real', 'run', 'y'),
    );
    expect(realPath(`${root}/link/../home`)).toBe(home);
  });
});

describe('liveDataFolder', () => {
  it('takes the folder LO_USER_DATA_DIR names, by its real path', () => {
    expect(liveDataFolder(mac(`${root}/run/`))).toBe(join(root, 'run'));
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'link'));
    expect(liveDataFolder(mac(join(root, 'link', 'run')))).toBe(join(root, 'real', 'run'));
  });

  it('refuses to start without LO_USER_DATA_DIR, or with a relative one', () => {
    expect(() => liveDataFolder(mac(undefined))).toThrow(/Set it to a folder of the run's own/);
    expect(() => liveDataFolder(mac(''))).toThrow(/LO_USER_DATA_DIR names/);
    expect(() => liveDataFolder(mac('lo-live'))).toThrow(
      'LO_USER_DATA_DIR must be an absolute path, not "lo-live".',
    );
  });

  it("refuses the folders of a Lo someone uses: the installed Lo's, a build run from source's, the keymap's and the caches", () => {
    for (const folder of [
      join(support, 'Lo'),
      join(support, 'Lo Dev'),
      join(support, 'Lo Dev', 'live'),
      `${support}/Lo/../Lo Dev`,
      // A Mac's disk takes names whatever their case.
      join(support, 'lo dev'),
      join(home, '.config', 'lo'),
      join(root, 'caches', 'Lo'),
      join(home, 'Library', 'Caches', 'Lo Dev'),
    ]) {
      expect(refusal(mac(folder))).toEqual(refusedAs(folder));
    }
    for (const folder of [
      join(home, '.config', 'Lo Dev'),
      join(home, '.config', 'lo', 'x'),
      join(home, '.cache', 'Lo'),
    ]) {
      expect(refusal(linux(folder))).toEqual(refusedAs(folder));
    }
  });

  it('refuses them by the XDG folders the run names, and by those Lo finds without them', () => {
    const xdg = { XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache') };
    for (const folder of [
      join(root, 'config', 'Lo'),
      join(root, 'config', 'lo'),
      join(root, 'cache', 'Lo Dev'),
      join(home, '.config', 'Lo'),
      join(home, '.cache', 'Lo Dev'),
    ]) {
      expect(refusal(linux(folder, xdg))).toEqual(refusedAs(folder));
    }
  });

  it('refuses them through a link to one, or to a folder they are in', () => {
    symlinkSync(join(support, 'Lo'), join(root, 'to-lo'));
    for (const folder of [join(root, 'to-lo'), join(root, 'to-lo', 'run')]) {
      expect(refusal(mac(folder))).toEqual(refusedAs(folder));
    }
    // A home whose `Application Support` is a link: Lo's data is where it leads.
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(join(elsewhere, 'Lo Dev'), { recursive: true });
    home = join(root, 'other');
    mkdirSync(join(home, 'Library'), { recursive: true });
    symlinkSync(elsewhere, join(home, 'Library', 'Application Support'));
    expect(() => liveDataFolder(mac(join(elsewhere, 'Lo Dev')))).toThrow(OWN);
  });

  it('refuses a folder that holds them, which deleting the run would delete', () => {
    for (const folder of [support, home, join(home, 'Library'), join(home, '.config'), '/']) {
      expect(refusal(mac(folder))).toEqual(refusedAs(folder, /, which holds .*, where a Lo/));
    }
    expect(() => liveDataFolder(linux(join(home, '.config')))).toThrow(OWN);
  });

  it('takes a folder beside them', () => {
    for (const folder of [join(support, 'Lo Live'), join(support, 'Lo Dev live')]) {
      expect(liveDataFolder(mac(folder))).toBe(folder);
    }
    // Linux's names keep their case.
    const folder = join(home, '.config', 'lo dev');
    expect(liveDataFolder(linux(folder))).toBe(folder);
  });

  it("refuses a folder that holds files Lo didn't make, or that isn't a folder", () => {
    const folder = join(root, 'run');
    mkdirSync(folder);
    expect(liveDataFolder(mac(folder))).toBe(folder);
    for (const name of ['editor', 'browser', 'config', '.DS_Store']) {
      writeFileSync(join(folder, name), '');
    }
    expect(liveDataFolder(mac(folder))).toBe(folder);
    writeFileSync(join(folder, 'notes.txt'), '');
    expect(() => liveDataFolder(mac(folder))).toThrow(
      `LO_USER_DATA_DIR is ${folder}, which holds files Lo didn't make.`,
    );
    // Lo made it: a run signed in there before.
    writeFileSync(join(folder, 'lo.db'), '');
    expect(liveDataFolder(mac(folder))).toBe(folder);
    expect(() => liveDataFolder(mac(join(folder, 'notes.txt')))).toThrow(/can't keep its data in/);
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
